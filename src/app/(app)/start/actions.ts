"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb, type Db } from "@/db";
import { mayBuild } from "@/lib/billing/quota";
import { getAnthropic } from "@/lib/ai/client";
import { logCall } from "@/lib/ai/runlog";
import { resolvePack } from "@/lib/content/resolve";
import { cookieName } from "@/lib/check/session";
import { runAnalyzer } from "@/lib/goals/analyzer";
import { INTAKE_AT_LATEST } from "@/lib/goals/anchors";
import { catalogueFor, matchChosen, specFrom } from "@/lib/goals/match";
import { clearIntake, loadIntake, saveIntake } from "@/lib/goals/intake-store";
import {
  askedWith,
  contextFor,
  MAX_REPLY,
  recordTurn,
} from "@/lib/goals/turn";
import {
  customSubjectFrom,
  masteryFromCheck,
  parseCustomGoalForm,
  parseGoalForm,
} from "@/lib/goals/intake";
import { slugify } from "@/lib/packs/generate/derive";
import { createGoal } from "@/lib/goals/store";
import { PACK_FIELD, projectStartHref } from "@/lib/goals/project-start";
import type { DomainPack } from "@/lib/packs/types";
import { finishBuild, startBuild } from "@/lib/packs/build";
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

async function requireUser(): Promise<string> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session.user.id;
}

/**
 * The course this conversation is committed to.
 *
 * Whatever the intake already holds wins: the lock is set on the turn that
 * opens the conversation and every later turn comes from the composer, which
 * has no course to name. Reading the field on those turns would let an empty
 * one unlock a conversation halfway through.
 *
 * A newly claimed one is *resolved before it is trusted*. This arrives in a
 * form field, so it is a string a signed-in learner can put anything in — and
 * an unchecked one would ride all the way to `createGoal`'s `packId`, which is
 * a foreign key to a pack that need not exist. Anything that does not name a
 * real pack is dropped rather than rejected: the conversation still works, and
 * `matchSubject` decides at the end exactly as it did before.
 */
async function chosenPack(
  db: Db,
  intake: { packSlug: string | null },
  formData: FormData,
): Promise<string | null> {
  if (intake.packSlug) return intake.packSlug;

  const claimed = String(formData.get(PACK_FIELD) ?? "").trim();
  if (claimed.length === 0) return null;

  const pack = await resolvePack(db, claimed);
  return pack?.slug ?? null;
}

/**
 * Hands the claimed build to the worker, and releases the claim if it cannot.
 *
 * `startBuild` writes the row *before* this runs, which is deliberate — the
 * claim is what stops a refresh of the wait screen starting a second build. The
 * consequence is that a failed dispatch leaves a row nobody will ever pick up:
 * the wait screen polls a subject that is not being built, and it polls until
 * `BUILD_TIMEOUT_MINUTES` makes the row stale, showing "writing it now" the
 * whole time.
 *
 * It is worse than a wedged screen on a plan with a lifetime quota. The quota
 * counts build rows, so a queue that was down for ten seconds would have spent
 * a free account's one custom subject on a build that never ran — and lifetime
 * means never getting it back. That is the bug this function exists to prevent.
 *
 * So a dispatch failure marks the row `failed` with a truthful reason. The wait
 * screen already renders that state, with the "Try again" button that reuses
 * this same slug and therefore the same row: the quota is untouched, the
 * learner is told what happened, and the recovery is one press. §24 E8's
 * "queued, retried, and the user is told — never a silent loss", applied to the
 * step before the queue.
 *
 * The most likely cause in development is the Inngest dev server not running
 * (`pnpm inngest:dev`); in production it is the event API being briefly
 * unreachable. Both look the same from here and both want the same answer.
 */
async function dispatchBuild(
  db: Db,
  input: { slug: string; subject: string; userId: string },
): Promise<boolean> {
  try {
    await inngest.send({
      name: EVENTS.buildPack,
      data: { slug: input.slug, subject: input.subject, userId: input.userId },
    });
    return true;
  } catch (error) {
    /*
     * Logged as well as recorded, because the two readers need different
     * things. The learner gets the sentence below — true, and useless for
     * debugging. Whoever is running the server gets the cause, which is the
     * half that was missing when this first happened: the action threw
     * `fetch failed` with no indication that the thing it could not reach was
     * the Inngest dev server nobody had started.
     */
    console.error("[packs] could not queue a build for", input.slug, error);

    await finishBuild(db, input.slug, {
      status: "failed",
      detail:
        "We couldn't get this into the queue. Nothing is lost — try again and it will pick up from here.",
    });
    return false;
  }
}

/**
 * §7.1's Generated tier, and the quota that lets the free tier have one.
 *
 * Authoring a pack costs ~78¢ — six times what is left of a free month's
 * allowance once onboarding, a session and an evaluation are paid for. It used
 * to be refused outright on free, which made the free tier "the seven subjects
 * we happen to have"; it is now allowed exactly once per account, ever, and
 * charged to the catalogue rather than to the learner (`subsidisesPackBuilds`).
 *
 * The subject is part of the question, not just the learner — see `mayBuild`,
 * which is where the count and the ownership meet. Asking with the learner
 * alone is what made "Try again" refuse the retry of the subject the quota had
 * already been spent on.
 *
 * Checked before `startBuild`, not after: `startBuild` claims the slug, and a
 * claim we then refuse to honour would lock the subject behind a build that
 * never runs.
 */
async function requireBuildAllowance(
  db: Db,
  userId: string,
  slug: string,
): Promise<void> {
  if (!(await mayBuild(db, userId, slug))) {
    redirect("/start?error=generated");
  }
}

/**
 * §7.1's Generated tier, from the point where the subject is settled.
 *
 * Shared by the conversation and the form for the reason `finish` is: they are
 * two ways of saying what to build, not two things to build. The build is
 * claimed here rather than on the wait screen so that a refresh of that screen
 * cannot start a second one.
 */
async function beginBuild(
  db: Db,
  userId: string,
  input: { slug: string; subject: string },
): Promise<never> {
  await requireBuildAllowance(db, userId, input.slug);

  const started = await startBuild(db, { ...input, userId });

  if (started.kind === "rate-limited") redirect("/start?error=busy");
  if (started.kind === "started") await dispatchBuild(db, { ...input, userId });

  // The wait screen either way: a dispatch that failed has marked the row, and
  // that screen is where a stopped build is explained.
  redirect(`/start/building?subject=${encodeURIComponent(input.slug)}`);
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

  const stored = await loadIntake(db, userId);
  if (stored.done) redirect("/start");

  // The course they chose, folded in before the model is asked anything — so
  // the very first question is about them rather than about a subject they
  // have already picked, and so the lock is saved even if this turn fails.
  const intake = {
    ...stored,
    packSlug: await chosenPack(db, stored, formData),
  };

  const messages = askedWith(intake, said);

  const result = await logCall(
    db,
    userId,
    await runAnalyzer(getAnthropic(), contextFor(intake, messages)),
  );

  const ok = await recordTurn(db, userId, intake, messages, result);
  /*
   * Back to the brief, when that is where they came from.
   *
   * The analyzer failing is the one path that returns somebody to `/start`
   * rather than moving them along it, and a bare `/start?error=analyzer` drops
   * the project — so a reader who had read a rubric end to end, pressed the
   * button, and hit a bad minute from the model landed on an empty intake with
   * no sign of the work they turned up for. The brief screen carries its slug
   * in a hidden field precisely so this redirect can put them back on it.
   *
   * Only the opening turn has one. Every later turn comes from the composer,
   * which has no brief to name — by then the project is in the conversation
   * itself, and the generic screen is the right place to land.
   */
  const brief = String(formData.get("project") ?? "");
  if (!ok) {
    redirect(brief ? projectStartHref(brief, "analyzer") : "/start?error=analyzer");
  }

  // To the new question rather than the top of the page — the pinned composer
  // covers the tail of the conversation otherwise.
  redirect(INTAKE_AT_LATEST);
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
    // The bare `/start` button, which is the one way in that names no course:
    // a learner who arrived from a brief or a subject page is seeded with
    // something to say, and goes through `replyAction` instead.
    packSlug: null,
  });

  redirect(INTAKE_AT_LATEST);
}

/** Throws the conversation away and starts again. */
export async function restartAction(): Promise<void> {
  const userId = await requireUser();
  await clearIntake(getDb(), userId);
  redirect("/start");
}

/**
 * Puts an unfinished conversation aside and opens a new one on a subject they
 * arrived holding.
 *
 * Someone who searches for a subject we do not cover, is told we will build it,
 * and clicks through, is asking for that subject — but they may already have an
 * abandoned conversation about something else, and `/start` would render that
 * one and drop the subject on the floor. That is exactly what it did: arriving
 * at `/start?topic=javascript` showed a half-finished conversation about
 * Japanese, with no sign the topic had been read at all.
 *
 * Clearing is safe: an intake that produced a goal is already deleted, so
 * anything still sitting here never became a plan. It is still not done without
 * asking — the screen offers this and the old conversation side by side.
 */
export async function startFreshAction(formData: FormData): Promise<void> {
  const userId = await requireUser();
  await clearIntake(getDb(), userId);

  // Straight into the conversation rather than back to a Start button: they
  // have already said what they want, twice.
  await replyAction(formData);
}

/**
 * Turns a finished conversation into a goal.
 *
 * A course the learner chose on the way in is the course they get. Otherwise a
 * subject the catalogue covers goes straight to a plan, and one it does not is
 * handed to §7.1's Generated tier, which is the whole point of the screen
 * accepting anything in the first place.
 */
export async function buildFromConversationAction(): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  const intake = await loadIntake(db, userId);
  if (!intake.captured) redirect("/start");

  const match = await matchChosen(db, intake.captured, intake.packSlug);

  if (match.kind === "gap") {
    if (match.slug.length === 0) redirect("/start?error=subject");

    return beginBuild(db, userId, { slug: match.slug, subject: match.subject });
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
 * Back to the form, saying what went wrong and holding on to what they typed.
 *
 * The subject rides along because the box is the one field on this form that
 * cannot be refilled from the list: a rejected form used to come back with
 * "Rust" gone and Photography selected, which is the same small betrayal
 * `/start` carries a typed topic through sign-in to avoid.
 */
function backToForm(error: string, subject: string): string {
  const params = new URLSearchParams({ error });
  if (subject.length > 0) params.set("subject", subject);

  return `/start/form?${params.toString()}`;
}

/**
 * A subject the form asked for and the catalogue does not have.
 *
 * The same Generated tier the conversation reaches, from the intake that has no
 * model behind it. What it does first is write down the answers: from here on
 * the pack does not exist yet, so a `GoalSpec` cannot, and everything they told
 * us has to survive a wait of some minutes, a queue that might refuse it, and a
 * build that might stop. The wait screen adopts from exactly this intake when
 * the pack lands — the same one the conversation would have left.
 */
async function buildCustomSubject(
  db: Db,
  userId: string,
  subject: string,
  formData: FormData,
): Promise<never> {
  const parsed = parseCustomGoalForm(formData, subject);
  if (!parsed.ok) redirect(backToForm(parsed.error, subject));

  /*
   * Whatever conversation was held is replaced, without asking.
   *
   * `finish` has always done this — a form submitted for a subject we cover
   * clears the intake on its way to `/today` — so the form has never been the
   * screen that preserves a half-finished chat. Doing it here keeps the two
   * halves of the same form consistent, rather than making a custom subject
   * the one submission that can fail because of something you typed elsewhere.
   */
  await saveIntake(db, userId, parsed.intake);

  return beginBuild(db, userId, { slug: slugify(subject), subject });
}

/**
 * The no-conversation path.
 *
 * Kept rather than deleted: it is the fallback when the analyzer is unavailable,
 * and it is the only intake that works with JavaScript and a model both out of
 * the picture. It fills the same `GoalSpec` — and, since the list can never be
 * the whole answer, it reaches the same builder for a subject that is not on it.
 */
export async function createGoalAction(formData: FormData): Promise<void> {
  const userId = await requireUser();
  const db = getDb();

  /*
   * What they typed, and what that resolves to.
   *
   * A typed subject is looked up the same way the conversation looks up the
   * analyzer's: slugified against the catalogue. Someone who types "Photography"
   * into the box has picked Photography, and building a second pack for it
   * would be a worse answer to a better-spelled question.
   */
  const typed = customSubjectFrom(formData);
  const chosen = typed.length > 0 ? slugify(typed) : String(formData.get("topic") ?? "");

  const pack = await resolvePack(db, chosen);
  if (!pack) {
    // Nothing typed and nothing matched: either the radio named a pack that is
    // no longer there, or "Something else" was chosen with an empty box.
    if (typed.length === 0) {
      redirect(backToForm("Pick a subject, or tell us what you want to learn.", ""));
    }

    return buildCustomSubject(db, userId, typed, formData);
  }

  const parsed = parseGoalForm(formData, pack);
  if (!parsed.ok) redirect(backToForm(parsed.error, typed));

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

/**
 * Leaves a stopped build behind and goes back to choosing.
 *
 * What is left of the old retry action, and the deletion is the change. A
 * learner used to be able to press "Try again", which spent four model calls
 * and about a pound on a guess — on the free tier, the catalogue's pound — made
 * by the one person with no way to tell a subject that cannot be built from an
 * afternoon when Anthropic was slow. Worse, it made a failure their problem to
 * solve by pressing a button repeatedly.
 *
 * A stopped build is now ours: the team is emailed when the row is written, and
 * retrying lives behind `requireAdmin` at `/admin/packs`. All this does is let
 * somebody stop waiting.
 *
 * The row is left exactly as it is. It is the operator's queue now, and
 * `mayBuild` already treats a subject this learner owns as retryable without
 * spending their allowance again — so deleting it here would cost them the
 * subject as well as the wait.
 */
export async function abandonBuildAction(): Promise<void> {
  await requireUser();
  redirect("/start");
}
