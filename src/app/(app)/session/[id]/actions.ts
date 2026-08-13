"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getAnthropic } from "@/lib/ai/client";
import { requireUser } from "@/lib/account/session";
import { todayFor } from "@/lib/goals/today";
import { toEngineGraph } from "@/lib/packs/validate";
import { findPack } from "@/lib/content";
import { initialMastery } from "@/lib/engine/bkt";
import { activeGoal, masteryFor } from "@/lib/goals/store";
import { gradeCheck } from "@/lib/session/grade";
import { answerCheck } from "@/lib/session/run";
import {
  advance,
  completeSession,
  recordResponse,
  sessionById,
  startSession,
} from "@/lib/session/store";

/**
 * The session runner's transitions, as Server Actions.
 *
 * Every one is a plain form POST ending in a redirect, so the screen needs no
 * client JavaScript to run a session — a refresh after answering shows the next
 * block instead of resubmitting the last answer. The tutor panel is the one
 * piece that ships script, and the session works without it.
 */

/** §8 screen 6's primary action: start today's session, or return to it. */
export async function startSessionAction(): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const now = new Date();

  const view = await todayFor(db, user.id, now);
  if (!view) redirect("/today");

  const session = await startSession(db, {
    userId: user.id,
    goalId: view.goal.id,
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
  if (blockIndex !== session.blockIndex || block?.type !== "check") {
    redirect(`/session/${sessionId}`);
  }

  const goal = await activeGoal(db, user.id);
  const pack = goal ? findPack(goal.packSlug) : undefined;
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
  if (blockIndex === session.blockIndex) {
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
