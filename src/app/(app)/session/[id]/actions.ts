"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getAnthropic } from "@/lib/ai/client";
import { requireUser } from "@/lib/account/session";
import { todayFor } from "@/lib/goals/today";
import { entitlementsForUser } from "@/lib/billing/store";
import { capture } from "@/lib/observability";
import { toEngineGraph } from "@/lib/packs/validate";
import { resolvePack } from "@/lib/content/resolve";
import { initialMastery } from "@/lib/engine/bkt";
import { activeGoal, masteryFor } from "@/lib/goals/store";
import { gradeCheck } from "@/lib/session/grade";
import { answerCheck } from "@/lib/session/run";
import {
  advance,
  appendBlocks,
  completeSession,
  isAnswered,
  recentSignals,
  recordResponse,
  sessionById,
  openSession,
  sessionsThisPeriod,
  startSession,
} from "@/lib/session/store";
import { proveBlocks, proveItems, proveOffer } from "@/lib/session/prove";

/**
 * The session runner's transitions, as Server Actions.
 *
 * Every one is a plain form POST ending in a redirect, so the screen needs no
 * client JavaScript to run a session — a refresh after answering shows the next
 * block instead of resubmitting the last answer. The tutor panel is the one
 * piece that ships script, and the session works without it.
 */

/**
 * §8 screen 6's primary action: start today's session, or return to it.
 *
 * The order below is the whole of it, and it is ordered by cost. Asking whether
 * a session is already open takes one indexed row; planning a day takes the
 * skill graph, a projection over it, six more reads and the planner itself. So
 * the cheap question is asked first, and the expensive work only happens on the
 * branch that has something to write.
 */
export async function startSessionAction(): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const now = new Date();

  const goal = await activeGoal(db, user.id);
  if (!goal) redirect("/today");

  /*
   * "Carry on" — a session is already under way, so hand it back.
   *
   * This is the press that was doing the most pointless work in the product.
   * It used to run the full `todayFor` first, re-planning the entire day over
   * the skill graph, and then hand the plan to `startSession`, which saw the
   * open session and threw the plan away unread. Every one of those reads and
   * the planning pass on top of them bought nothing: resuming writes nothing,
   * so there is nothing to plan for.
   *
   * The allowance is not checked here either, for the reason it never was:
   * somebody three blocks into today's work is not starting anything, and
   * refusing them would strand them mid-session — the one outcome worse than
   * not letting them begin.
   */
  const open = await openSession(db, user.id, goal.id);
  if (open) redirect(`/session/${open.id}`);

  /*
   * A new session, so now the plan is worth paying for.
   *
   * Re-planned here rather than accepted from the form that posted, and that is
   * not a redundancy to optimise away later: a session spec arriving over the
   * wire is a request, and honouring one would let anybody choose their own
   * blocks — including an `apply` block against a skill they have never
   * unlocked. The goal is threaded through because it was just read above; the
   * planning is not, because it cannot be.
   */
  const view = await todayFor(db, user.id, now, { goal });
  if (!view) redirect("/today");

  const { entitlements } = await entitlementsForUser(db, user.id, user.plan);
  const limit = entitlements.sessionsPerMonth;

  if (limit !== null && (await sessionsThisPeriod(db, user.id, now)) >= limit) {
    capture("quota_reached", { quota_type: "session", limit }, user.id);
    redirect("/today?error=sessions");
  }

  /*
   * `startSession` asks for an open session once more before it inserts. That
   * is not the check above repeated — this one closes the gap between the read
   * and the write, where a second press can land.
   */
  const session = await startSession(db, {
    userId: user.id,
    goalId: goal.id,
    planned: view.session,
    now,
  });

  redirect(`/session/${session.id}`);
}

export async function answerAction(
  sessionId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const now = new Date();

  const session = await sessionById(db, sessionId, user.id);
  if (!session) redirect("/today");

  const blockIndex = Number(formData.get("block"));
  const block = session.blocks[blockIndex];

  // A form posted against a block the learner is not on — a stale tab, or the
  // back button after answering. Dropped rather than recorded twice.
  //
  // `isAnswered` is the half the cursor used to cover on its own: answering no
  // longer moves the learner off the block, so a resubmitted form now lands on
  // a block that still matches. Marking it again would spend a second model
  // call and move mastery twice on one answer.
  if (
    blockIndex !== session.blockIndex ||
    block?.type !== "check" ||
    isAnswered(session, blockIndex)
  ) {
    redirect(`/session/${sessionId}`);
  }

  const goal = await activeGoal(db, user.id);
  const pack = goal ? await resolvePack(db, goal.packSlug) : undefined;
  if (!pack) redirect("/today");

  const graph = toEngineGraph(pack);
  const skill = graph.skills.find((s) => s.id === block.skillId);
  if (!skill) redirect(`/session/${sessionId}`);

  const mastery = await masteryFor(db, user.id, pack.slug);

  await answerCheck({
    db,
    userId: user.id,
    packSlug: pack.slug,
    session,
    blockIndex,
    answer: String(formData.get("answer") ?? ""),
    skill,
    mastery:
      mastery.find((m) => m.skillId === skill.id) ??
      initialMastery(skill.id, skill.bktPriors),
    grade: (request) => gradeCheck(getAnthropic(), request),
    now,
  });

  revalidatePath(`/session/${sessionId}`);
  redirect(`/session/${sessionId}`);
}

/**
 * Accept the prove-it offer (PLAN-ADAPTATION step 4).
 *
 * It appends questions and nothing else. No mastery moves here, no skill is
 * skipped, no verdict is recorded — the learner answers the appended blocks
 * through `answerAction` like any other check, and whatever the grader makes of
 * them is what counts. That is the entire point: the tutor's impression buys an
 * assessment, never a result.
 *
 * The offer is re-derived server-side rather than trusted from the form. A
 * posted skill slug is a request, and one that no longer has a signal behind it
 * — or has already been answered — must not be able to conjure free questions
 * on any skill the learner names.
 */
export async function proveAction(sessionId: string): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const now = new Date();

  const session = await sessionById(db, sessionId, user.id);
  if (!session) redirect("/today");

  const goal = await activeGoal(db, user.id);
  const pack = goal ? await resolvePack(db, goal.packSlug) : undefined;
  if (!pack) redirect("/today");

  const signals = await recentSignals(db, user.id, pack.slug, now);
  const offer = proveOffer({
    signals,
    block: session.blocks[session.blockIndex],
    blocks: session.blocks,
    pack,
  });
  if (!offer) redirect(`/session/${sessionId}`);

  // Total by construction: `proveOffer` only returns a skill it found items
  // for, and the pack validator rejects a pack whose item names a skill that
  // does not exist. A guard here would be a branch nothing can reach.
  const skill = toEngineGraph(pack).skills.find(
    (s) => s.id === offer.skillSlug,
  )!;

  await appendBlocks(
    db,
    session,
    proveBlocks(
      proveItems(pack, offer.skillSlug),
      offer.skillSlug,
      skill.canDoStatement,
    ),
  );

  revalidatePath(`/session/${sessionId}`);
  redirect(`/session/${sessionId}`);
}

/** Move past a block that has nothing to submit — a lesson, a brief, a prompt. */
export async function continueAction(
  sessionId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const db = getDb();

  const session = await sessionById(db, sessionId, user.id);
  if (!session) redirect("/today");

  await advance(db, session, Number(formData.get("to")));

  revalidatePath(`/session/${sessionId}`);
  redirect(`/session/${sessionId}`);
}

/**
 * A reflection, saved. §16.4 puts reflection in the session for a reason, and a
 * prompt with a box under it that throws the answer away is worse than no box.
 * It is stored, never marked: §7.2 puts self-report at Tier 5, and Tier 5 never
 * moves the record.
 */
export async function noteAction(
  sessionId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const now = new Date();

  const session = await sessionById(db, sessionId, user.id);
  if (!session) redirect("/today");

  const blockIndex = Number(formData.get("block"));
  if (blockIndex === session.blockIndex && !isAnswered(session, blockIndex)) {
    await recordResponse(db, session, {
      blockIndex,
      answer: String(formData.get("answer") ?? "").slice(0, 10_000),
      correct: null,
      gradedBy: "self",
      feedback: "",
      evidenceTier: null,
      at: now.toISOString(),
    });
  }

  revalidatePath(`/session/${sessionId}`);
  redirect(`/session/${sessionId}`);
}

export async function finishAction(sessionId: string): Promise<void> {
  const user = await requireUser();
  const db = getDb();

  const session = await sessionById(db, sessionId, user.id);
  if (!session) redirect("/today");

  await completeSession(db, session, new Date());

  revalidatePath("/today");
  redirect("/today");
}
