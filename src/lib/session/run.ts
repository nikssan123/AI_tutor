import type { Db } from "@/db";
import type { CallResult } from "@/lib/ai/call";
import { applyObservation } from "@/lib/engine/bkt";
import type { EngineSkill, MasteryState, SessionBlock } from "@/lib/engine";
import type { BlockResponse } from "@/lib/contracts/session";
import { upsertMastery } from "@/lib/goals/store";
import {
  CHECK_CONFIDENCE,
  evidenceTierFor,
  type CheckGrade,
  type GradeRequest,
} from "./grade";
import {
  recordMasteryUpdate,
  recordMisconception,
  recordResponse,
  resolveMisconceptions,
  scheduleRetrieval,
  type StoredSession,
} from "./store";

/**
 * One answered block, from the learner's text to every row it touches.
 *
 * The order below is deliberate and is the reason this is a function rather
 * than five calls at a route handler: mastery moves through `applyObservation`
 * (never a hand-rolled update), the audit row is written whether or not the
 * number moved, and the retrieval schedule is read *from* the mastery model
 * rather than computed beside it. A caller that got that order wrong would
 * produce a plausible-looking session with an inconsistent record underneath.
 */

/** The grader, injected — so the whole loop is testable with no network. */
export type Grader = (request: GradeRequest) => Promise<CallResult<CheckGrade>>;

export interface AnswerInput {
  db: Db;
  userId: string;
  packSlug: string;
  session: StoredSession;
  blockIndex: number;
  answer: string;
  skill: EngineSkill;
  mastery: MasteryState;
  grade: Grader;
  now: Date;
}

export interface AnswerOutcome {
  session: StoredSession;
  response: BlockResponse;
  /** The new mastery row, or undefined when nothing moved it. */
  mastery: MasteryState | undefined;
}

export function checkBlockAt(
  session: StoredSession,
  index: number,
): Extract<SessionBlock, { type: "check" }> | undefined {
  const block = session.blocks[index];
  return block?.type === "check" ? block : undefined;
}

/**
 * Blank answers never reach the model.
 *
 * Not an optimisation: "nothing" is not an answer a grader has to judge, and
 * sending it would spend a call to be told so. It is recorded as wrong, because
 * it is, and the feedback says what was being asked for.
 */
export function isBlank(answer: string): boolean {
  return answer.trim().length === 0;
}

export async function answerCheck(input: AnswerInput): Promise<AnswerOutcome> {
  const block = checkBlockAt(input.session, input.blockIndex);
  if (!block) {
    // A form posted against a block that is not a check — a stale page, or a
    // hand-written request. Dropped rather than recorded against the wrong
    // block, the same way the Skill Check drops a stale item.
    return {
      session: input.session,
      response: skipped(input.blockIndex, input.now),
      mastery: undefined,
    };
  }

  const at = input.now.toISOString();

  if (isBlank(input.answer)) {
    const response: BlockResponse = {
      blockIndex: input.blockIndex,
      answer: "",
      correct: false,
      gradedBy: "self",
      feedback: `Nothing to mark. This one was about: ${block.expected}`,
      evidenceTier: null,
      at,
    };
    return {
      session: await recordResponse(input.db, input.session, response),
      response,
      mastery: undefined,
    };
  }

  const graded = await input.grade({
    question: block.prompt,
    expected: block.expected,
    answer: input.answer,
  });

  // §4.2 law 1 — a grader that could not run has not established anything. The
  // answer is kept, the session moves on, and mastery does not.
  if (graded.status !== "ok") {
    const response: BlockResponse = {
      blockIndex: input.blockIndex,
      answer: input.answer,
      correct: null,
      gradedBy: "ungraded",
      feedback:
        "We couldn't mark this one just now, so it hasn't been counted either way. Your answer is saved.",
      evidenceTier: null,
      at,
    };
    return {
      session: await recordResponse(input.db, input.session, response),
      response,
      mastery: undefined,
    };
  }

  const evidenceTier = evidenceTierFor(input.skill.evalTier);
  const { state, update } = applyObservation(
    input.mastery,
    input.skill.bktPriors,
    {
      correct: graded.value.correct,
      confidence: CHECK_CONFIDENCE,
      evidenceTier,
    },
    at,
  );

  await upsertMastery(input.db, input.userId, input.packSlug, state, input.now);

  await recordMasteryUpdate(input.db, {
    userId: input.userId,
    packSlug: input.packSlug,
    skillSlug: input.skill.id,
    prior: update.prior,
    posterior: update.posterior,
    observationConfidence: CHECK_CONFIDENCE,
    evidenceTier,
    reason: graded.value.correct
      ? `Answered a recall question on ${input.skill.name} correctly.`
      : `Missed a recall question on ${input.skill.name}.`,
    now: input.now,
  });

  if (graded.value.correct) {
    await resolveMisconceptions(input.db, {
      userId: input.userId,
      packSlug: input.packSlug,
      skillSlug: input.skill.id,
      now: input.now,
    });
  } else if (graded.value.misconception !== null) {
    await recordMisconception(input.db, {
      userId: input.userId,
      packSlug: input.packSlug,
      skillSlug: input.skill.id,
      description: graded.value.misconception,
      now: input.now,
    });
  }

  // The next sighting is due at the half-life the model just recomputed — §16.2
  // owns the doubling, and this reads it rather than keeping a second clock.
  if (block.itemId !== null) {
    await scheduleRetrieval(input.db, {
      userId: input.userId,
      packSlug: input.packSlug,
      skillSlug: input.skill.id,
      itemSlug: block.itemId,
      succeeded: graded.value.correct,
      halfLifeDays: state.decayHalfLifeDays,
      now: input.now,
    });
  }

  const response: BlockResponse = {
    blockIndex: input.blockIndex,
    answer: input.answer,
    correct: graded.value.correct,
    gradedBy: "model",
    feedback: graded.value.feedback,
    evidenceTier,
    at,
  };

  return {
    session: await recordResponse(input.db, input.session, response),
    response,
    mastery: state,
  };
}

function skipped(blockIndex: number, now: Date): BlockResponse {
  return {
    blockIndex,
    answer: "",
    correct: null,
    gradedBy: "ungraded",
    feedback: "",
    evidenceTier: null,
    at: now.toISOString(),
  };
}
