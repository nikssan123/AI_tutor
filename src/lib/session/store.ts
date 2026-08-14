import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  assessmentItem,
  learningPlan,
  learningSession,
  masteryUpdate,
  misconception,
  retrievalQueueItem,
  skill as skillTable,
  tutorSignal,
} from "@/db/schema";
import { itemId as packItemId, packId, skillId } from "@/lib/packs/ids";
import { BlockResponse, SessionResponses } from "@/lib/contracts/session";
import type {
  PlannedSession,
  RetrievalCandidate,
  SessionBlock,
  SessionOutcome,
  SkillAttempt,
} from "@/lib/engine";

/**
 * §24 E7 — where a planned session becomes a session that happened.
 *
 * Everything the planner treated as an empty array in pass 7 is written here:
 * session history, the session index, and the spaced-retrieval queue. That is
 * the whole point of the epic — §16.1's scoring has nine terms and four of them
 * read history, so until sessions were stored the planner was permanently
 * planning someone's first day.
 *
 * The slug/UUID seam is the same one `goals/store.ts` defends, and for the same
 * reason: the engine works in slug space, the database in UUID space, and the
 * translation happens in exactly one place per direction.
 */

/** Retrieval items are short by construction — §16.4's "2–4 quick questions". */
export const RETRIEVAL_MINUTES = 2;

/**
 * The composer opens with at most four items, and reads the nearest-due first.
 * Reading a few more than that leaves room for its minutes cap to choose between
 * them; reading the whole queue would be paying to sort rows nobody will see.
 */
export const QUEUE_READ_LIMIT = 20;

/** Blocks a learner is offered per session are bounded by the planner, not here. */
export interface StoredSession {
  id: string;
  userId: string;
  goalId: string;
  planId: string | null;
  blocks: SessionBlock[];
  blockIndex: number;
  responses: BlockResponse[];
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface StartInput {
  userId: string;
  goalId: string;
  planned: PlannedSession;
  now: Date;
}

/**
 * Starts today's session, or hands back the one already open.
 *
 * Idempotent on purpose: `/today` has a button, buttons get double-clicked, and
 * two sessions for one day would each hold half the answers. The open session
 * wins over the plan — a learner three blocks in does not want a fresh one
 * because the planner has since changed its mind.
 */
export async function startSession(
  db: Db,
  input: StartInput,
): Promise<StoredSession> {
  const open = await openSession(db, input.userId, input.goalId);
  if (open) return open;

  const id = crypto.randomUUID();
  // The plan a second session on the same day attaches to may already exist, so
  // the id that comes back from the upsert is the one to record — not this one.
  let planId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    const [plan] = await tx
      .insert(learningPlan)
      .values({
        id: planId,
        userId: input.userId,
        goalId: input.goalId,
        plannedFor: input.planned.plannedFor,
        sessionSpec: input.planned,
        reason: input.planned.reason,
        status: "started",
        createdAt: input.now,
      })
      // One plan per learner per goal per day (§15's unique index). A second
      // session on the same day attaches to the same plan rather than failing.
      .onConflictDoUpdate({
        target: [learningPlan.userId, learningPlan.goalId, learningPlan.plannedFor],
        set: { sessionSpec: input.planned, reason: input.planned.reason, status: "started" },
      })
      // Returned rather than selected back: an upsert returns the row it landed
      // on either way, so there is no "did it insert or update" to ask about
      // and no absent case to write a fallback for.
      .returning({ id: learningPlan.id });

    planId = plan!.id;

    await tx.insert(learningSession).values({
      id,
      userId: input.userId,
      goalId: input.goalId,
      planId,
      startedAt: input.now,
      blocks: input.planned.blocks,
      blockIndex: 0,
      responses: [],
    });
  });

  return {
    id,
    userId: input.userId,
    goalId: input.goalId,
    planId,
    blocks: input.planned.blocks,
    blockIndex: 0,
    responses: [],
    startedAt: input.now,
    completedAt: null,
  };
}

/** The learner's unfinished session for this goal, if there is one. */
export async function openSession(
  db: Db,
  userId: string,
  goalId: string,
): Promise<StoredSession | undefined> {
  const rows = await db
    .select()
    .from(learningSession)
    .where(
      and(
        eq(learningSession.userId, userId),
        eq(learningSession.goalId, goalId),
        isNull(learningSession.completedAt),
      ),
    )
    .orderBy(desc(learningSession.startedAt))
    .limit(1);

  return rows[0] ? hydrate(rows[0]) : undefined;
}

/**
 * One session by id, scoped to its owner.
 *
 * The `userId` predicate is the authorisation check, not a filter: without it a
 * learner who guesses a UUID reads someone else's answers. It lives in the query
 * so no caller can forget it.
 */
export async function sessionById(
  db: Db,
  id: string,
  userId: string,
): Promise<StoredSession | undefined> {
  const rows = await db
    .select()
    .from(learningSession)
    .where(and(eq(learningSession.id, id), eq(learningSession.userId, userId)))
    .limit(1);

  return rows[0] ? hydrate(rows[0]) : undefined;
}

type SessionRow = typeof learningSession.$inferSelect;

function hydrate(row: SessionRow): StoredSession {
  const responses = SessionResponses.safeParse(row.responses);

  return {
    id: row.id,
    userId: row.userId,
    goalId: row.goalId,
    planId: row.planId,
    // Blocks are whatever the planner wrote. They are rendered, not trusted for
    // anything privileged, so an unparseable value degrades to a session with
    // nothing left to do rather than taking the page down.
    blocks: Array.isArray(row.blocks) ? (row.blocks as SessionBlock[]) : [],
    blockIndex: row.blockIndex,
    responses: responses.success ? responses.data : [],
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

/**
 * Records an answer and moves to the next block, in one write.
 *
 * Two statements would let a crash between them lose the answer while advancing
 * the cursor, which is the one failure a learner would actually notice.
 */
export async function recordResponse(
  db: Db,
  session: StoredSession,
  response: BlockResponse,
): Promise<StoredSession> {
  const responses = [
    ...session.responses.filter((r) => r.blockIndex !== response.blockIndex),
    response,
  ].sort((a, b) => a.blockIndex - b.blockIndex);

  const blockIndex = Math.min(response.blockIndex + 1, session.blocks.length);

  await db
    .update(learningSession)
    .set({ responses, blockIndex })
    .where(eq(learningSession.id, session.id));

  return { ...session, responses, blockIndex };
}

/** Skipping a block is a real answer to "I don't want to do this one". */
export async function advance(
  db: Db,
  session: StoredSession,
  toIndex: number,
): Promise<StoredSession> {
  const blockIndex = Math.max(0, Math.min(toIndex, session.blocks.length));
  await db
    .update(learningSession)
    .set({ blockIndex })
    .where(eq(learningSession.id, session.id));
  return { ...session, blockIndex };
}

export async function completeSession(
  db: Db,
  session: StoredSession,
  now: Date,
): Promise<void> {
  const startedAt = session.startedAt ?? now;
  const durationMinutes = Math.max(
    0,
    Math.round((now.getTime() - startedAt.getTime()) / 60_000),
  );

  await db.transaction(async (tx) => {
    await tx
      .update(learningSession)
      .set({ completedAt: now, blockIndex: session.blocks.length, durationMinutes })
      .where(eq(learningSession.id, session.id));

    if (session.planId !== null) {
      await tx
        .update(learningPlan)
        .set({ status: "completed" })
        .where(eq(learningPlan.id, session.planId));
    }
  });
}

/**
 * §16.1's `history` — the last few completed sessions, newest first.
 *
 * Three is what §14.3 puts in the Learner Context Block and more than the
 * scoring terms read (momentum looks at the last one, interleaving at the last
 * one's areas), so reading more would be paying for rows nothing consults.
 */
export const HISTORY_DEPTH = 3;

export async function recentOutcomes(
  db: Db,
  userId: string,
  goalId: string,
  areaOf: (skillSlug: string) => string | undefined,
  depth = HISTORY_DEPTH,
): Promise<SessionOutcome[]> {
  const rows = await db
    .select({
      completedAt: learningSession.completedAt,
      blocks: learningSession.blocks,
    })
    .from(learningSession)
    .where(
      and(
        eq(learningSession.userId, userId),
        eq(learningSession.goalId, goalId),
        isNotNull(learningSession.completedAt),
      ),
    )
    .orderBy(desc(learningSession.completedAt))
    .limit(depth);

  return rows.map((row) => {
    const blocks = Array.isArray(row.blocks) ? (row.blocks as SessionBlock[]) : [];
    const skillIds = [
      ...new Set(
        blocks.flatMap((b) =>
          b.type === "explain" || b.type === "apply" ? [b.skillId] : [],
        ),
      ),
    ];

    return {
      // The query filters on `completedAt is not null`, so the column is only
      // nullable to the type system.
      completedAt: row.completedAt!.toISOString(),
      skillIds,
      areas: [
        ...new Set(skillIds.flatMap((id) => {
          const area = areaOf(id);
          return area === undefined ? [] : [area];
        })),
      ],
      producedArtifact: blocks.some((b) => b.type === "apply"),
    };
  });
}

/**
 * §16.1's `attempts` — what the frustration damper reads.
 *
 * Derived from the answers themselves rather than from `mastery_update`, where
 * success would have to be inferred from the sign of a delta. A wrong answer on
 * a skill already at zero moves nothing, and inferring "succeeded" from that
 * would tell the damper the opposite of what happened.
 *
 * Ungraded answers are excluded: an answer nothing could mark is not evidence of
 * failure, and counting it as one would back the learner off a skill because our
 * grader was unavailable.
 */
export async function recentAttempts(
  db: Db,
  userId: string,
  goalId: string,
  depth = ATTEMPT_SESSION_DEPTH,
): Promise<SkillAttempt[]> {
  const rows = await db
    .select({ blocks: learningSession.blocks, responses: learningSession.responses })
    .from(learningSession)
    .where(
      and(eq(learningSession.userId, userId), eq(learningSession.goalId, goalId)),
    )
    .orderBy(desc(learningSession.startedAt))
    .limit(depth);

  return rows.flatMap((row) => {
    const blocks = Array.isArray(row.blocks) ? (row.blocks as SessionBlock[]) : [];
    const responses = SessionResponses.safeParse(row.responses);
    if (!responses.success) return [];

    return responses.data.flatMap((response) => {
      const block = blocks[response.blockIndex];
      if (block?.type !== "check" || response.correct === null) return [];
      return [
        {
          skillId: block.skillId,
          at: response.at,
          succeeded: response.correct,
          evidenceTier: (response.evidenceTier ?? 5) as SkillAttempt["evidenceTier"],
        },
      ];
    });
  });
}

/** Far enough back for "failed twice running" to be visible, and no further. */
export const ATTEMPT_SESSION_DEPTH = 6;

/** §16.1 step 4 — 1-based, and the reason every 4th session is an apply session. */
export async function nextSessionIndex(
  db: Db,
  userId: string,
  goalId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(learningSession)
    .where(
      and(
        eq(learningSession.userId, userId),
        eq(learningSession.goalId, goalId),
        isNotNull(learningSession.completedAt),
      ),
    );

  // An aggregate with no group by returns exactly one row, zero included, so
  // there is no absent case to default — a fallback here would be a branch
  // nothing can reach.
  return row!.count + 1;
}

/**
 * §16.1 step 4 — the spaced-retrieval queue, in slug space.
 *
 * Only rows pointing at a real item bank entry come back. A queued skill with no
 * item behind it would render as a question with no question in it, and pass 6
 * already named the item bank as the thing that is thin — this makes that
 * shortage visible as fewer recall questions rather than as an empty block.
 */
export async function dueRetrieval(
  db: Db,
  userId: string,
  packSlug: string,
  limit = QUEUE_READ_LIMIT,
): Promise<RetrievalCandidate[]> {
  const rows = await db
    .select({
      skillSlug: skillTable.slug,
      itemSlug: assessmentItem.slug,
      dueAt: retrievalQueueItem.dueAt,
    })
    .from(retrievalQueueItem)
    .innerJoin(skillTable, eq(skillTable.id, retrievalQueueItem.skillId))
    .innerJoin(
      assessmentItem,
      eq(assessmentItem.id, retrievalQueueItem.itemId),
    )
    .where(
      and(
        eq(retrievalQueueItem.userId, userId),
        eq(skillTable.packId, packId(packSlug)),
      ),
    )
    .orderBy(retrievalQueueItem.dueAt, assessmentItem.slug)
    .limit(limit);

  return rows.map((row) => ({
    skillId: row.skillSlug,
    itemId: row.itemSlug,
    dueAt: row.dueAt.toISOString(),
    estMinutes: RETRIEVAL_MINUTES,
  }));
}

export interface ScheduleInput {
  userId: string;
  packSlug: string;
  skillSlug: string;
  itemSlug: string;
  succeeded: boolean;
  /** The learner's half-life *after* this observation — §16.2 owns the doubling. */
  halfLifeDays: number;
  now: Date;
}

/**
 * Queues the next sighting of an item.
 *
 * `dueAt` is the half-life the mastery model just computed, not a second
 * schedule sitting beside it. §15 says as much on the table itself — "dueAt is
 * derived from the decay half-life, so spaced repetition falls out of the
 * mastery model rather than being a separate scheduler" — and two schedules that
 * disagree would show a learner a card the model thinks they still remember.
 */
export async function scheduleRetrieval(
  db: Db,
  input: ScheduleInput,
): Promise<void> {
  const id = skillId(input.packSlug, input.skillSlug);
  const item = packItemId(input.packSlug, input.itemSlug);
  const dueAt = new Date(
    input.now.getTime() + input.halfLifeDays * 86_400_000,
  );

  const existing = await db
    .select({ id: retrievalQueueItem.id, streak: retrievalQueueItem.successStreak })
    .from(retrievalQueueItem)
    .where(
      and(
        eq(retrievalQueueItem.userId, input.userId),
        eq(retrievalQueueItem.skillId, id),
        eq(retrievalQueueItem.itemId, item),
      ),
    )
    .limit(1);

  const streak = input.succeeded ? (existing[0]?.streak ?? 0) + 1 : 0;
  const row = {
    dueAt,
    lastServedAt: input.now,
    successStreak: streak,
    intervalDays: input.halfLifeDays,
  };

  if (existing[0]) {
    await db
      .update(retrievalQueueItem)
      .set(row)
      .where(eq(retrievalQueueItem.id, existing[0].id));
    return;
  }

  await db.insert(retrievalQueueItem).values({
    userId: input.userId,
    skillId: id,
    itemId: item,
    ...row,
  });
}

/**
 * §15 — "Misconception: phase 2, high value." Fed by the grader's own field.
 *
 * Open ones only. A resolved misconception is history, and putting it in front
 * of the tutor would have it correcting a belief the learner has already
 * dropped.
 */
export async function openMisconceptions(
  db: Db,
  userId: string,
  packSlug: string,
  limit = 5,
): Promise<string[]> {
  const rows = await db
    .select({ description: misconception.description })
    .from(misconception)
    .innerJoin(skillTable, eq(skillTable.id, misconception.skillId))
    .where(
      and(
        eq(misconception.userId, userId),
        eq(skillTable.packId, packId(packSlug)),
        isNull(misconception.resolvedAt),
      ),
    )
    .orderBy(desc(misconception.firstSeenAt))
    .limit(limit);

  return rows.map((row) => row.description);
}

/**
 * How long a tutor signal stays relevant.
 *
 * Short on purpose. A signal is an impression of one moment in one conversation,
 * and a learner who was confused a fortnight ago and has passed two checks since
 * is not still confused. Attempts decay through the mastery model; these do not,
 * so the window is the only thing stopping an old bad afternoon damping a skill
 * forever.
 */
export const SIGNAL_WINDOW_DAYS = 7;

/**
 * Recent signals for one learner, newest first, in slug space.
 *
 * Joined through `skill` for the same reason `openMisconceptions` is: the engine
 * reads slugs and the table stores UUIDs, and this file is where that seam is
 * crossed. Rows with no skill — a signal raised on a reflect block — are not
 * returned, because every receptor is per-skill.
 */
export async function recentSignals(
  db: Db,
  userId: string,
  packSlug: string,
  now: Date,
  windowDays = SIGNAL_WINDOW_DAYS,
): Promise<Array<{ skillSlug: string; signal: string; at: Date }>> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      skillSlug: skillTable.slug,
      signal: tutorSignal.signal,
      at: tutorSignal.createdAt,
    })
    .from(tutorSignal)
    .innerJoin(skillTable, eq(skillTable.id, tutorSignal.skillId))
    .where(
      and(
        eq(tutorSignal.userId, userId),
        eq(skillTable.packId, packId(packSlug)),
        gte(tutorSignal.createdAt, since),
      ),
    )
    .orderBy(desc(tutorSignal.createdAt));

  return rows;
}

/**
 * One labelled turn.
 *
 * `none` never reaches here — the caller drops it — so every row is a signal
 * somebody meant. A signal with no skill still writes a row: it costs nothing,
 * and a null `skill_id` is the honest record of "noticed, not attributable".
 */
export async function recordTutorSignal(
  db: Db,
  input: {
    userId: string;
    sessionId: string;
    packSlug: string;
    skillSlug: string | null;
    signal: string;
    now: Date;
  },
): Promise<void> {
  await db.insert(tutorSignal).values({
    userId: input.userId,
    sessionId: input.sessionId,
    skillId: input.skillSlug
      ? skillId(input.packSlug, input.skillSlug)
      : null,
    signal: input.signal,
    createdAt: input.now,
  });
}

export async function recordMisconception(
  db: Db,
  input: {
    userId: string;
    packSlug: string;
    skillSlug: string;
    description: string;
    now: Date;
  },
): Promise<void> {
  await db.insert(misconception).values({
    userId: input.userId,
    skillId: skillId(input.packSlug, input.skillSlug),
    description: input.description,
    firstSeenAt: input.now,
  });
}

/**
 * A skill answered correctly is a belief no longer held. Closing them here means
 * the list the tutor sees shrinks as the learner improves, which is the only
 * thing that stops it growing forever.
 */
export async function resolveMisconceptions(
  db: Db,
  input: { userId: string; packSlug: string; skillSlug: string; now: Date },
): Promise<void> {
  await db
    .update(misconception)
    .set({ resolvedAt: input.now })
    .where(
      and(
        eq(misconception.userId, input.userId),
        eq(misconception.skillId, skillId(input.packSlug, input.skillSlug)),
        isNull(misconception.resolvedAt),
      ),
    );
}

export interface MasteryAudit {
  userId: string;
  packSlug: string;
  skillSlug: string;
  prior: number;
  posterior: number;
  observationConfidence: number;
  evidenceTier: number;
  reason: string;
  now: Date;
}

/**
 * §15 — "every mastery change is traceable to evidence."
 *
 * Written for observations that did *not* move the number as well as ones that
 * did: a Tier 5 self-mark with a delta of zero is exactly the row that proves
 * §7.2's hard rule was applied rather than merely believed.
 */
export async function recordMasteryUpdate(
  db: Db,
  audit: MasteryAudit,
): Promise<void> {
  await db.insert(masteryUpdate).values({
    userId: audit.userId,
    skillId: skillId(audit.packSlug, audit.skillSlug),
    priorMastery: audit.prior,
    posteriorMastery: audit.posterior,
    delta: audit.posterior - audit.prior,
    observationConfidence: audit.observationConfidence,
    evidenceTier: audit.evidenceTier,
    reason: audit.reason,
    createdAt: audit.now,
  });
}
