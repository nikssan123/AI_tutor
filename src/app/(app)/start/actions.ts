"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { getAnthropic } from "@/lib/ai/client";
import { logCall } from "@/lib/ai/runlog";
import { resolvePack } from "@/lib/content/resolve";
import { cookieName } from "@/lib/check/session";
import {
  isComplete,
  runAnalyzer,
  shouldFinishNext,
  type Message,
} from "@/lib/goals/analyzer";
import { catalogueFor, matchSubject, specFrom } from "@/lib/goals/match";
import { clearIntake, loadIntake, saveIntake } from "@/lib/goals/intake-store";
import { masteryFromCheck, parseGoalForm } from "@/lib/goals/intake";
import { createGoal } from "@/lib/goals/store";
import type { DomainPack } from "@/lib/packs/types";
import { startBuild } from "@/lib/packs/build";
import { EVENTS, inngest } from "@/lib/inngest/client";

/**
 * §8 screen 3 as Server Actions — the conversation, and the form that is still
 * behind it.
 *
 * No client JavaScript, for the same reason the Skill Check has none: this is
 * the screen between signing up and having a plan, and a screen that needs a
 * bundle to download before it works is one some people never get through.
 * Every transition is a POST that ends in a redirect, so a refresh re-renders
 * the conversation instead of re-sending the last answer.
 */

/** Bounds what one person can type into one turn. */
const MAX_REPLY = 500;

async function requireUser(): Promise<string> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session.user.id;
}

/**
 * Creates the goal and sends the learner to their path.
 *
 * Shared by both intakes, so the conversation and the form cannot drift into
 * creating subtly different goals — which was the reason `GoalSpec` was written
 * before either of them existed.
 */
async function finish(
  userId: string,
  // The pack itself, not its slug: every caller has already resolved one, and
  // resolving it again here only added a branch that cannot be reached.
  pack: DomainPack,
  spec: Parameters<typeof createGoal>[1]["spec"],
): Promise<never> {
  const db = getDb();
  const jar = await cookies();
  const now = new Date();

  // §24 E11 — whatever they already answered anonymously comes with them.
  // Replayed through the engine rather than trusted (see intake.ts).
  const mastery = masteryFromCheck(
    pack,
    jar.get(cookieName(pack.slug))?.value,
    now.toISOString(),
  );

  const goalId = await createGoal(db, {
    userId,
    packSlug: pack.slug,
    spec,
    mastery,
    now,
  });

  // The conversation has done its job; leaving it behind would greet them with
  // their old answers the next time they set a goal.
  await clearIntake(db, userId);

  // `/today` rather than the path screen, which is where the form has always
  // landed. Both intakes end in the same place on purpose — the conversation is
  // a different way to fill the same spec, not a different product.
  void goalId;
  redirect("/today");
}

/* ── The conversation ─────────────────────────────────────────────────────── */

/**
 * One exchange: the learner says something, the analyzer replies.
 *
 * The turn cap is enforced here rather than in the prompt (§24 E3), and it is
 * enforced twice — once by telling the model this is its last turn, and once by
 * ending the conversation whatever the model returns.
 */
export async function replyAction(formData: FormData): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  const said = String(formData.get("reply") ?? "").trim().slice(0, MAX_REPLY);
  if (said.length === 0) redirect("/start");

  const intake = await loadIntake(db, userId);
  if (intake.done) redirect("/start");

  const messages: Message[] = [...intake.messages, { r: "l", t: said }];

  const result = await logCall(
    db,
    userId,
    await runAnalyzer(getAnthropic(), {
      messages,
      catalogue: catalogueFor(),
      today: new Date().toISOString().slice(0, 10),
      // Told to close either because the last turn showed it has enough, or
      // because this is the last turn it gets. Without this the conversation
      // ends on an unanswered question.
      finalTurn: shouldFinishNext(intake.clarity, messages),
    }),
  );

  if (result.status !== "ok") {
    // A model that could not answer is not a reason to lose what they typed.
    await saveIntake(db, userId, { ...intake, messages });
    redirect("/start?error=analyzer");
  }

  const turn = result.value;
  const withReply: Message[] = [...messages, { r: "a", t: turn.reply }];

  await saveIntake(db, userId, {
    messages: withReply,
    captured: turn.captured,
    chips: turn.chips,
    clarity: turn.clarity,
    done: isComplete(turn, withReply),
  });

  redirect("/start");
}

/** Opens the conversation, so the first question comes from the analyzer. */
export async function openAction(): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  const result = await logCall(
    db,
    userId,
    await runAnalyzer(getAnthropic(), {
      messages: [],
      catalogue: catalogueFor(),
      today: new Date().toISOString().slice(0, 10),
      finalTurn: false,
    }),
  );

  if (result.status !== "ok") redirect("/start?error=analyzer");

  await saveIntake(db, userId, {
    messages: [{ r: "a", t: result.value.reply }],
    captured: result.value.captured,
    chips: result.value.chips,
    clarity: result.value.clarity,
    done: false,
  });

  redirect("/start");
}

/** Throws the conversation away and starts again. */
export async function restartAction(): Promise<void> {
  const userId = await requireUser();
  await clearIntake(getDb(), userId);
  redirect("/start");
}

/**
 * Turns a finished conversation into a goal.
 *
 * A subject the catalogue covers goes straight to a plan. One it does not is
 * handed to §7.1's Generated tier, which is the whole point of the screen
 * accepting anything in the first place.
 */
export async function buildFromConversationAction(): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  const intake = await loadIntake(db, userId);
  if (!intake.captured) redirect("/start");

  const match = await matchSubject(db, intake.captured);

  if (match.kind === "gap") {
    if (match.slug.length === 0) redirect("/start?error=subject");

    // §7.1's Generated tier. The build is claimed here rather than on the wait
    // screen so that a refresh of that screen cannot start a second one.
    const started = await startBuild(db, {
      slug: match.slug,
      subject: match.subject,
      userId,
    });

    if (started.kind === "rate-limited") redirect("/start?error=busy");
    if (started.kind === "started") {
      await inngest.send({
        name: EVENTS.buildPack,
        data: { slug: match.slug, subject: match.subject, userId },
      });
    }

    redirect(`/start/building?subject=${encodeURIComponent(match.slug)}`);
  }

  const spec = specFrom(
    intake.captured,
    intake.messages,
    match.pack.slug,
    match.pack.name,
    intake.clarity,
  );
  if (!spec) redirect("/start?error=subject");

  await finish(userId, match.pack, spec);
}

/* ── The form, still here ─────────────────────────────────────────────────── */

/**
 * The no-conversation path, unchanged.
 *
 * Kept rather than deleted: it is the fallback when the analyzer is unavailable,
 * and it is the only intake that works with JavaScript and a model both out of
 * the picture. It fills the same `GoalSpec`.
 */
export async function createGoalAction(formData: FormData): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  const topic = String(formData.get("topic") ?? "");
  const pack = await resolvePack(db, topic);
  if (!pack) redirect("/start/form?error=subject");

  const parsed = parseGoalForm(formData, pack);
  if (!parsed.ok) {
    redirect(`/start/form?error=${encodeURIComponent(parsed.error)}`);
  }

  await finish(userId, pack, parsed.spec);
}

/* ── The wait screen's two buttons ────────────────────────────────────────── */

/**
 * Turns a pack that finished building into this learner's goal.
 *
 * The conversation is still stored, so the spec is built from the same captured
 * fields a covered subject would have used — the two paths differ only in
 * whether the pack existed when they started.
 */
export async function adoptBuiltPackAction(formData: FormData): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  const slug = String(formData.get("slug") ?? "");
  const pack = await resolvePack(db, slug);
  if (!pack) redirect("/start?error=subject");

  const intake = await loadIntake(db, userId);
  if (!intake.captured) redirect("/start");

  const spec = specFrom(
    intake.captured,
    intake.messages,
    pack.slug,
    pack.name,
    intake.clarity,
  );
  if (!spec) redirect("/start?error=subject");

  await finish(userId, pack, spec);
}

/** Retries a failed build, or abandons it and goes back to the conversation. */
export async function requestBuildAction(formData: FormData): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  if (formData.get("cancel")) redirect("/start");

  const slug = String(formData.get("slug") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  if (slug.length === 0 || subject.length === 0) redirect("/start");

  const started = await startBuild(db, { slug, subject, userId });
  if (started.kind === "rate-limited") redirect("/start?error=busy");

  if (started.kind === "started") {
    await inngest.send({
      name: EVENTS.buildPack,
      data: { slug, subject, userId },
    });
  }

  redirect(`/start/building?subject=${encodeURIComponent(slug)}`);
}
