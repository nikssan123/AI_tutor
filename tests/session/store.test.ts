import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createClient } from "@/db";
import {
  interaction,
  learnerSkillMastery,
  lesson as lessonTable,
  learningPlan,
  learningSession as learningSessionTable,
  masteryUpdate,
  retrievalQueueItem,
  spendLedger,
  user,
} from "@/db/schema";
import { findPack } from "@/lib/content";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { itemId as packItemId, skillId } from "@/lib/packs/ids";
import { toEngineGraph } from "@/lib/packs/validate";
import { createGoal, masteryFor, upsertMastery } from "@/lib/goals/store";
import { todayFor } from "@/lib/goals/today";
import {
  advance,
  completeSession,
  dueRetrieval,
  nextSessionIndex,
  openMisconceptions,
  openSession,
  recentAttempts,
  recentOutcomes,
  recordMasteryUpdate,
  recordMisconception,
  recordResponse,
  resolveMisconceptions,
  scheduleRetrieval,
  sessionById,
  sessionsThisPeriod,
  startSession,
} from "@/lib/session/store";
import { answerCheck, checkBlockAt, isBlank } from "@/lib/session/run";
import { lessonForBlock, sessionView, supportFor } from "@/lib/session/view";
import {
  appendBlocks,
  recentSignals,
  recordTutorSignal,
  SIGNAL_WINDOW_DAYS,
} from "@/lib/session/store";
import {
  cachedLesson,
  saveLesson,
  styleHashFor,
  type LessonRequest,
} from "@/lib/session/lesson";
import { logTurn, transcriptFor, turnsTaken } from "@/lib/session/tutor";
import { initialMastery } from "@/lib/engine/bkt";
import { periodOf } from "@/lib/ai/runlog";
import type { GoalSpec } from "@/lib/contracts/goal";
import type { BlockResponse, LessonContent } from "@/lib/contracts/session";
import type { CallResult } from "@/lib/ai/call";
import type { CheckGrade } from "@/lib/session/grade";
import type { PlannedSession, SessionBlock } from "@/lib/engine";

/**
 * §24 E7 — the session, end to end, against the real database.
 *
 * These are live tests for the same reason the goal store's are: the thing
 * worth checking is the slug/UUID seam and the rows that actually land, and a
 * mocked `db` would assert that the code calls itself.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

const PACK = "sql-data-analysis";
const NOW = new Date("2026-08-13T09:00:00.000Z");

const spec = (overrides: Partial<GoalSpec> = {}): GoalSpec => ({
  rawGoal: "stop being scared of window functions",
  domain: PACK,
  targetOutcome: "SQL for data analysis",
  outcomeType: "personal",
  statedLevel: "beginner",
  weeklyHours: 4,
  deadline: null,
  motivation: "",
  constraints: [],
  existingAssets: [],
  priorDomain: "none",
  depth: "standard",
  clarity: 1,
  ...overrides,
});

const okGrade = (
  over: Partial<CheckGrade> = {},
): CallResult<CheckGrade> => ({
  status: "ok",
  value: { correct: true, feedback: "That's it.", misconception: null, ...over },
  model: "claude-haiku-4-5",
  promptName: "check_grader",
  promptVersion: 1,
  attempts: 1,
  usage: {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
  costCents: 0.01,
  uncachedCostCents: 0.01,
  latencyMs: 100,
});

live("the session store", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const pack = findPack(PACK)!;
  const graph = toEngineGraph(pack);
  const skill = graph.skills[0]!;
  const packItem = pack.items.find((i) => i.skill === skill.id) ?? pack.items[0]!;
  const users: string[] = [];

  async function newUser(): Promise<string> {
    const id = `test-${crypto.randomUUID()}`;
    users.push(id);
    await db.insert(user).values({ id, name: "Test", email: `${id}@example.test` });
    return id;
  }

  async function newGoal(userId: string): Promise<string> {
    return createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [],
      now: NOW,
    });
  }

  function blocks(): SessionBlock[] {
    return [
      { type: "explain", skillId: skill.id, content: "c", estMinutes: 10 },
      {
        type: "check",
        skillId: skill.id,
        prompt: "In your own words?",
        expected: skill.canDoStatement,
        isRetrieval: false,
        itemId: null,
        estMinutes: 5,
      },
      {
        type: "apply",
        skillId: skill.id,
        brief: "b",
        rubricId: null,
        evidenceType: skill.area,
        estMinutes: 15,
      },
    ];
  }

  function planned(goalId: string, over: Partial<PlannedSession> = {}): PlannedSession {
    return {
      goalId,
      plannedFor: "2026-08-13",
      sessionIndex: 1,
      blocks: blocks(),
      totalMinutes: 30,
      targetSkillIds: [skill.id],
      backingOff: false,
      reason: "Because.",
      compression: null,
      ranked: [],
      ...over,
    };
  }

  beforeAll(async () => {
    await seedPack(db, loadPack(`packs/${PACK}`));
  }, 60_000);

  afterAll(async () => {
    for (const id of users) await db.delete(user).where(eq(user.id, id));
    await close();
  });

  it("starts a session and writes the plan it came from", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);

    const session = await startSession(db, {
      userId,
      goalId,
      planned: planned(goalId),
      now: NOW,
    });

    expect(session.blocks).toHaveLength(3);
    expect(session.blockIndex).toBe(0);

    const plans = await db
      .select()
      .from(learningPlan)
      .where(eq(learningPlan.goalId, goalId));
    expect(plans).toHaveLength(1);
    expect(plans[0]!.reason).toBe("Because.");
    expect(plans[0]!.status).toBe("started");
  });

  /** A `CallMeta` shaped like a real tutor turn — only the cost columns matter. */
  const META = {
    model: "claude-sonnet-5",
    promptName: "tutor",
    promptVersion: 1,
    attempts: 1,
    usage: {
      inputTokens: 1_200,
      outputTokens: 30,
      cacheReadInputTokens: 1_150,
      cacheCreationInputTokens: 0,
    },
    costCents: 0.2,
    uncachedCostCents: 0.9,
    latencyMs: 700,
  };

  describe("turnsTaken", () => {
    it("counts only the learner's own questions", async () => {
      // §14.9.7 limit 4 counts questions asked, not messages exchanged — the
      // assistant's replies are in the same table and must not be doubled in.
      const userId = await newUser();
      const goalId = await newGoal(userId);
      const session = await startSession(db, {
        userId,
        goalId,
        planned: planned(goalId),
        now: NOW,
      });

      expect(await turnsTaken(db, session.id, userId)).toBe(0);

      await logTurn(db, {
        userId,
        sessionId: session.id,
        question: "why?",
        answer: "because",
        meta: META,
        now: NOW,
      });

      expect(await turnsTaken(db, session.id, userId)).toBe(1);
    });

    it("does not count another learner's questions", async () => {
      const userId = await newUser();
      const other = await newUser();
      const goalId = await newGoal(userId);
      const session = await startSession(db, {
        userId,
        goalId,
        planned: planned(goalId),
        now: NOW,
      });

      await logTurn(db, {
        userId,
        sessionId: session.id,
        question: "why?",
        answer: "because",
        meta: META,
        now: NOW,
      });

      expect(await turnsTaken(db, session.id, other)).toBe(0);
    });
  });

  describe("a lesson when the month's ceiling is reached", () => {
    it("declines to generate, and says so distinctly from a failure", async () => {
      // §14.9.7 limit 1. The lesson generator runs on Sonnet (§14.9.3), so
      // there is no cheaper tier to fall to — over the cap it declines rather
      // than generating something worse. `capped` is separate from a plain
      // absent lesson because the screen says different things: a failure is
      // ours to apologise for, a ceiling is something the learner can act on.
      const userId = await newUser();
      const pack = findPack("photography")!;
      const skill = toEngineGraph(pack).skills[0]!;

      await db.insert(spendLedger).values({
        userId,
        period: periodOf(NOW),
        costCents: 9_999,
        updatedAt: NOW,
      });

      const explode = {
        messages: {
          create: async () => {
            throw new Error("must not be called");
          },
        },
      } as never;

      const outcome = await lessonForBlock(db, explode, {
        userId,
        packSlug: pack.slug,
        skill,
        mastery: initialMastery(skill.id, skill.bktPriors),
        minutes: 12,
        now: NOW,
        plan: "free",
      });

      expect(outcome.content).toBeUndefined();
      expect(outcome.capped).toBe(true);
      expect(outcome.cached).toBe(false);
    });

    it("generates as normal for the same plan under the ceiling", async () => {
      // The other side of the same `if`. A plan being present is not itself a
      // refusal — only a plan that has spent its month is.
      const userId = await newUser();
      const pack = findPack("photography")!;
      const skill = toEngineGraph(pack).skills[0]!;

      const explode = {
        messages: {
          create: async () => {
            throw new Error("must not be called");
          },
        },
      } as never;

      // Nothing spent, so the cap does not bite and the model is reached for —
      // which this client makes loudly observable.
      await expect(
        lessonForBlock(db, explode, {
          userId,
          packSlug: pack.slug,
          skill,
          mastery: initialMastery(skill.id, skill.bktPriors),
          minutes: 12,
          now: NOW,
          plan: "free",
        }),
      ).rejects.toThrow("must not be called");
    });
  });

  describe("sessionsThisPeriod", () => {
    it("counts nothing for a learner who has started nothing", async () => {
      const userId = await newUser();
      expect(await sessionsThisPeriod(db, userId, NOW)).toBe(0);
    });

    it("counts this calendar month and not the last one", async () => {
      // The period is the one `spend_ledger` uses — a UTC calendar month — so
      // "3 a month" means the same thing here as everywhere else the product
      // counts.
      const userId = await newUser();
      const goalId = await newGoal(userId);
      const lastMonth = new Date("2026-07-20T09:00:00.000Z");

      await startSession(db, {
        userId,
        goalId,
        planned: planned(goalId, { plannedFor: "2026-07-20" }),
        now: lastMonth,
      });

      expect(await sessionsThisPeriod(db, userId, NOW)).toBe(0);
      expect(await sessionsThisPeriod(db, userId, lastMonth)).toBe(1);
    });

    it("counts a session started this month", async () => {
      const userId = await newUser();
      const goalId = await newGoal(userId);

      await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });
      expect(await sessionsThisPeriod(db, userId, NOW)).toBe(1);
    });

    it("does not count another learner's sessions", async () => {
      const userId = await newUser();
      const goalId = await newGoal(userId);
      const other = await newUser();

      await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });
      expect(await sessionsThisPeriod(db, other, NOW)).toBe(0);
    });
  });

  it("hands back the open session rather than starting a second one", async () => {
    // A button gets double-clicked. Two sessions for one day would each hold
    // half the answers, and neither would be the record.
    const userId = await newUser();
    const goalId = await newGoal(userId);

    const first = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });
    const again = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });

    expect(again.id).toBe(first.id);
  });

  it("starts a fresh session the day after one was finished", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);

    const first = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });
    await completeSession(db, first, new Date(NOW.getTime() + 1_800_000));

    const second = await startSession(db, {
      userId,
      goalId,
      planned: planned(goalId, { plannedFor: "2026-08-14" }),
      now: new Date("2026-08-14T09:00:00.000Z"),
    });

    expect(second.id).not.toBe(first.id);
    expect(await nextSessionIndex(db, userId, goalId)).toBe(2);
  });

  it("attaches a second session on the same day to the same plan", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);

    const first = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });
    await completeSession(db, first, new Date(NOW.getTime() + 60_000));
    const second = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });

    const plans = await db
      .select()
      .from(learningPlan)
      .where(eq(learningPlan.goalId, goalId));
    expect(plans).toHaveLength(1);
    // Both sessions point at the plan that exists, not at an id one of them
    // generated and then discarded.
    expect(second.planId).toBe(first.planId);
  });

  it("scopes a session to its owner", async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const goalId = await newGoal(owner);
    const session = await startSession(db, { userId: owner, goalId, planned: planned(goalId), now: NOW });

    expect(await sessionById(db, session.id, stranger)).toBeUndefined();
    expect(await sessionById(db, session.id, owner)).toBeDefined();
  });

  it("records an answer and advances in one write", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);
    const session = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });

    const response: BlockResponse = {
      blockIndex: 0,
      answer: "read",
      correct: null,
      gradedBy: "self",
      feedback: "",
      evidenceTier: null,
      at: NOW.toISOString(),
    };

    const next = await recordResponse(db, session, response);
    expect(next.blockIndex).toBe(1);

    const reloaded = await sessionById(db, session.id, userId);
    expect(reloaded?.responses).toHaveLength(1);
    expect(reloaded?.blockIndex).toBe(1);
  });

  it("replaces rather than duplicates an answer to the same block", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);
    let session = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });

    const response = (answer: string): BlockResponse => ({
      blockIndex: 0,
      answer,
      correct: null,
      gradedBy: "self",
      feedback: "",
      evidenceTier: null,
      at: NOW.toISOString(),
    });

    session = await recordResponse(db, session, response("first"));
    session = await recordResponse(db, session, response("second"));

    expect(session.responses).toHaveLength(1);
    expect(session.responses[0]!.answer).toBe("second");
  });

  it("clamps the cursor to the blocks that exist", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);
    const session = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });

    expect((await advance(db, session, 99)).blockIndex).toBe(3);
    expect((await advance(db, session, -4)).blockIndex).toBe(0);
  });

  it("completes a session, timing it and closing its plan", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);
    const session = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });

    await completeSession(db, session, new Date(NOW.getTime() + 25 * 60_000));

    const done = await sessionById(db, session.id, userId);
    expect(done?.completedAt).not.toBeNull();
    expect(await openSession(db, userId, goalId)).toBeUndefined();

    const plans = await db
      .select()
      .from(learningPlan)
      .where(eq(learningPlan.goalId, goalId));
    expect(plans[0]!.status).toBe("completed");
  });

  it("times a session that somehow never recorded a start", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);
    const session = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });

    await completeSession(db, { ...session, startedAt: null, planId: null }, NOW);
    expect((await sessionById(db, session.id, userId))?.completedAt).not.toBeNull();
  });

  it("reports history newest first, with the areas the interleaving bonus reads", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);

    const first = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });
    await completeSession(db, first, new Date(NOW.getTime() + 60_000));

    const outcomes = await recentOutcomes(db, userId, goalId, () => "analytics");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.skillIds).toEqual([skill.id]);
    expect(outcomes[0]!.areas).toEqual(["analytics"]);
    expect(outcomes[0]!.producedArtifact).toBe(true);
  });

  it("drops an area the pack no longer names", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);
    const session = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });
    await completeSession(db, session, new Date(NOW.getTime() + 60_000));

    expect((await recentOutcomes(db, userId, goalId, () => undefined))[0]!.areas).toEqual([]);
  });

  it("counts only completed sessions towards the session index", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);
    await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });

    // §16.1 step 4 makes every fourth session an apply session. An abandoned
    // session must not consume one of those slots.
    expect(await nextSessionIndex(db, userId, goalId)).toBe(1);
  });

  it("schedules retrieval at the half-life the mastery model computed", async () => {
    const userId = await newUser();

    await scheduleRetrieval(db, {
      userId,
      packSlug: PACK,
      skillSlug: skill.id,
      itemSlug: packItem.slug,
      succeeded: true,
      halfLifeDays: 14,
      now: NOW,
    });

    const [row] = await db
      .select()
      .from(retrievalQueueItem)
      .where(eq(retrievalQueueItem.userId, userId));

    expect(row!.intervalDays).toBe(14);
    expect(row!.successStreak).toBe(1);
    expect(row!.dueAt.toISOString()).toBe("2026-08-27T09:00:00.000Z");
  });

  it("extends a streak on success and resets it on a miss", async () => {
    const userId = await newUser();
    const schedule = (succeeded: boolean, halfLifeDays: number) =>
      scheduleRetrieval(db, {
        userId,
        packSlug: PACK,
        skillSlug: skill.id,
        itemSlug: packItem.slug,
        succeeded,
        halfLifeDays,
        now: NOW,
      });

    await schedule(true, 7);
    await schedule(true, 14);

    let [row] = await db
      .select()
      .from(retrievalQueueItem)
      .where(eq(retrievalQueueItem.userId, userId));
    expect(row!.successStreak).toBe(2);

    await schedule(false, 7);
    [row] = await db
      .select()
      .from(retrievalQueueItem)
      .where(eq(retrievalQueueItem.userId, userId));
    expect(row!.successStreak).toBe(0);
  });

  it("returns queued items in slug space, nearest due first", async () => {
    const userId = await newUser();
    const second = pack.items.find((i) => i.slug !== packItem.slug)!;

    await scheduleRetrieval(db, {
      userId, packSlug: PACK, skillSlug: skill.id, itemSlug: packItem.slug,
      succeeded: true, halfLifeDays: 30, now: NOW,
    });
    await scheduleRetrieval(db, {
      userId, packSlug: PACK, skillSlug: second.skill, itemSlug: second.slug,
      succeeded: true, halfLifeDays: 1, now: NOW,
    });

    const due = await dueRetrieval(db, userId, PACK);
    expect(due.map((d) => d.itemId)).toEqual([second.slug, packItem.slug]);
    expect(due[0]!.skillId).toBe(second.skill);
  });

  it("leaves a queued row with no item behind it out of the queue", async () => {
    // Pass 6 named the item bank as the thin part. A skill with nothing to ask
    // shows up as fewer recall questions, never as an empty question.
    const userId = await newUser();
    await db.insert(retrievalQueueItem).values({
      userId,
      skillId: skillId(PACK, skill.id),
      itemId: null,
      dueAt: NOW,
    });

    expect(await dueRetrieval(db, userId, PACK)).toEqual([]);
  });

  it("writes a mastery audit row even when nothing moved", async () => {
    const userId = await newUser();

    await recordMasteryUpdate(db, {
      userId,
      packSlug: PACK,
      skillSlug: skill.id,
      prior: 0.4,
      posterior: 0.4,
      observationConfidence: 0.45,
      evidenceTier: 5,
      reason: "Self-reported.",
      now: NOW,
    });

    const [row] = await db
      .select()
      .from(masteryUpdate)
      .where(eq(masteryUpdate.userId, userId));
    expect(row!.delta).toBe(0);
    expect(row!.evidenceTier).toBe(5);
  });

  it("tracks misconceptions until they are answered correctly", async () => {
    const userId = await newUser();

    await recordMisconception(db, {
      userId, packSlug: PACK, skillSlug: skill.id,
      description: "thinks a join filters rows", now: NOW,
    });
    expect(await openMisconceptions(db, userId, PACK)).toEqual([
      "thinks a join filters rows",
    ]);

    await resolveMisconceptions(db, { userId, packSlug: PACK, skillSlug: skill.id, now: NOW });
    expect(await openMisconceptions(db, userId, PACK)).toEqual([]);
  });

  it("derives attempts from answers, ignoring the ones nothing could mark", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);
    let session = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });

    session = await recordResponse(db, session, {
      blockIndex: 1, answer: "a", correct: false, gradedBy: "model",
      feedback: "no", evidenceTier: 2, at: NOW.toISOString(),
    });
    await recordResponse(db, session, {
      blockIndex: 2, answer: "b", correct: null, gradedBy: "ungraded",
      feedback: "", evidenceTier: null, at: NOW.toISOString(),
    });

    const attempts = await recentAttempts(db, userId, goalId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ skillId: skill.id, succeeded: false });
  });

  it("survives a session row whose blocks or answers no longer parse", async () => {
    // A row written by an older shape of the code, or edited by hand. It
    // degrades to a session with nothing left to do rather than taking down
    // the page a learner is halfway through.
    const userId = await newUser();
    const goalId = await newGoal(userId);
    const id = crypto.randomUUID();

    await db.insert(learningSessionTable).values({
      id, userId, goalId, startedAt: NOW,
      blocks: { not: "an array" },
      responses: "nonsense",
    });

    const session = await sessionById(db, id, userId);
    expect(session?.blocks).toEqual([]);
    expect(session?.responses).toEqual([]);
    expect(await recentAttempts(db, userId, goalId)).toEqual([]);

    await completeSession(db, session!, NOW);
    const outcomes = await recentOutcomes(db, userId, goalId, () => "area");
    expect(outcomes[0]!.skillIds).toEqual([]);
  });

  it("records a blank answer as an attempt at the weakest tier", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);
    const session = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });

    await recordResponse(db, session, {
      blockIndex: 1, answer: "", correct: false, gradedBy: "self",
      feedback: "nothing to mark", evidenceTier: null, at: NOW.toISOString(),
    });

    const [attempt] = await recentAttempts(db, userId, goalId);
    expect(attempt!.evidenceTier).toBe(5);
    expect(attempt!.succeeded).toBe(false);
  });

  it("feeds the planner real history instead of an empty array", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);
    const session = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });
    await completeSession(db, session, new Date(NOW.getTime() + 60_000));

    const view = await todayFor(db, userId, new Date("2026-08-14T09:00:00.000Z"));
    // The whole point of the epic: a learner's second session is planned as a
    // second session, not as their first.
    expect(view?.session.sessionIndex).toBe(2);
  });

  it("offers to resume an open session", async () => {
    const userId = await newUser();
    const goalId = await newGoal(userId);
    const session = await startSession(db, { userId, goalId, planned: planned(goalId), now: NOW });

    expect((await todayFor(db, userId, NOW))?.openSessionId).toBe(session.id);
  });
});

live("answering a check", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const pack = findPack(PACK)!;
  const graph = toEngineGraph(pack);
  const skill = graph.skills[0]!;
  const packItem = pack.items.find((i) => i.skill === skill.id) ?? pack.items[0]!;
  const users: string[] = [];

  async function newUser(): Promise<string> {
    const id = `test-${crypto.randomUUID()}`;
    users.push(id);
    await db.insert(user).values({ id, name: "Test", email: `${id}@example.test` });
    return id;
  }

  async function session(userId: string, itemId: string | null = null) {
    const goalId = await createGoal(db, {
      userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
    });

    return startSession(db, {
      userId,
      goalId,
      planned: {
        goalId,
        plannedFor: "2026-08-13",
        sessionIndex: 1,
        blocks: [
          {
            type: "check",
            skillId: skill.id,
            prompt: "In your own words?",
            expected: skill.canDoStatement,
            isRetrieval: itemId !== null,
            itemId,
            estMinutes: 5,
          },
          { type: "reflect", prompt: "How was it?", estMinutes: 5 },
        ],
        totalMinutes: 10,
        targetSkillIds: [skill.id],
        backingOff: false,
        reason: "r",
        compression: null,
        ranked: [],
      },
      now: NOW,
    });
  }

  const base = (userId: string, stored: Awaited<ReturnType<typeof session>>) => ({
    db,
    userId,
    packSlug: PACK,
    session: stored,
    blockIndex: 0,
    skill,
    mastery: initialMastery(skill.id, skill.bktPriors),
    now: NOW,
  });

  beforeAll(async () => {
    await seedPack(db, loadPack(`packs/${PACK}`));
  }, 60_000);

  afterAll(async () => {
    for (const id of users) await db.delete(user).where(eq(user.id, id));
    await close();
  });

  it("moves mastery, writes the audit row, and queues the next sighting", async () => {
    const userId = await newUser();
    const stored = await session(userId, packItem.slug);

    const outcome = await answerCheck({
      ...base(userId, stored),
      answer: "a real answer",
      grade: async () => okGrade(),
    });

    expect(outcome.response.correct).toBe(true);
    expect(outcome.response.gradedBy).toBe("model");
    // §7.2 — a written answer is never Tier 1, whatever the skill's own tier.
    expect(outcome.response.evidenceTier).toBe(2);
    expect(outcome.mastery!.mastery).toBeGreaterThan(0);

    const stateRows = await masteryFor(db, userId, PACK);
    expect(stateRows.find((s) => s.skillId === skill.id)!.evidenceCount).toBe(1);

    const [audit] = await db
      .select()
      .from(masteryUpdate)
      .where(eq(masteryUpdate.userId, userId));
    expect(audit!.delta).toBeGreaterThan(0);

    const [queued] = await db
      .select()
      .from(retrievalQueueItem)
      .where(eq(retrievalQueueItem.userId, userId));
    expect(queued!.itemId).toBe(packItemId(PACK, packItem.slug));
  });

  it("marks a blank answer wrong without spending a call", async () => {
    const userId = await newUser();
    const stored = await session(userId);
    let called = false;

    const outcome = await answerCheck({
      ...base(userId, stored),
      answer: "   ",
      grade: async () => {
        called = true;
        return okGrade();
      },
    });

    expect(called).toBe(false);
    expect(outcome.response.correct).toBe(false);
    expect(outcome.response.feedback).toContain(skill.canDoStatement);
    expect(outcome.mastery).toBeUndefined();
  });

  it("counts nothing when the grader could not run", async () => {
    // §4.2 law 1 — an unreachable model has not established anything, and a
    // failure recorded as a wrong answer would back the learner off a skill
    // because our grader was down.
    const userId = await newUser();
    const stored = await session(userId);

    const outcome = await answerCheck({
      ...base(userId, stored),
      answer: "an answer",
      grade: async () => ({
        status: "invalid",
        detail: "schema",
        model: "claude-haiku-4-5",
        promptName: "check_grader",
        promptVersion: 1,
        attempts: 2,
        usage: {
          inputTokens: 1, outputTokens: 1,
          cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        },
        costCents: 0, uncachedCostCents: 0, latencyMs: 1,
      }),
    });

    expect(outcome.response.correct).toBeNull();
    expect(outcome.response.gradedBy).toBe("ungraded");
    expect(outcome.mastery).toBeUndefined();
    expect(
      await db.select().from(masteryUpdate).where(eq(masteryUpdate.userId, userId)),
    ).toEqual([]);
  });

  it("records a misconception on a wrong answer and clears it on a right one", async () => {
    const userId = await newUser();
    const stored = await session(userId);

    await answerCheck({
      ...base(userId, stored),
      answer: "joins remove rows",
      grade: async () =>
        okGrade({ correct: false, misconception: "believes a join filters" }),
    });
    expect(await openMisconceptions(db, userId, PACK)).toEqual([
      "believes a join filters",
    ]);

    await answerCheck({
      ...base(userId, stored),
      answer: "the grain decides it",
      grade: async () => okGrade(),
    });
    expect(await openMisconceptions(db, userId, PACK)).toEqual([]);
  });

  it("records no misconception when the answer was merely incomplete", async () => {
    const userId = await newUser();
    const stored = await session(userId);

    await answerCheck({
      ...base(userId, stored),
      answer: "not sure",
      grade: async () => okGrade({ correct: false, misconception: null }),
    });

    expect(await openMisconceptions(db, userId, PACK)).toEqual([]);
  });

  it("drops a post against a block that is not a check", async () => {
    const userId = await newUser();
    const stored = await session(userId);

    const outcome = await answerCheck({
      ...base(userId, stored),
      blockIndex: 1,
      answer: "x",
      grade: async () => okGrade(),
    });

    expect(outcome.session.responses).toHaveLength(0);
    expect(outcome.mastery).toBeUndefined();
  });
});

live("the session view and its lesson", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const pack = findPack(PACK)!;
  const graph = toEngineGraph(pack);
  const skill = graph.skills[0]!;
  const users: string[] = [];

  const lesson: LessonContent = {
    objective: "o",
    sections: [{ heading: "h", body: "b" }],
    workedExample: "w",
    commonMistake: "m",
  };

  const request: LessonRequest = {
    packSlug: PACK,
    skillSlug: skill.id,
    skillName: skill.name,
    canDoStatement: skill.canDoStatement,
    level: "shaky",
    minutes: 12,
    support: "worked_example",
    priorDomain: "none",
  };

  async function newUser(): Promise<string> {
    const id = `test-${crypto.randomUUID()}`;
    users.push(id);
    await db.insert(user).values({ id, name: "Test", email: `${id}@example.test` });
    return id;
  }

  beforeAll(async () => {
    await seedPack(db, loadPack(`packs/${PACK}`));
  }, 60_000);

  afterAll(async () => {
    for (const id of users) await db.delete(user).where(eq(user.id, id));
    // Lesson rows key on the skill, not on a user, so they outlive the users
    // that caused them and would leak into the next run's cache.
    await db.delete(lessonTable).where(eq(lessonTable.skillId, skillId(PACK, skill.id)));
    await close();
  });

  it("assembles the block, the skill and the tutor's context", async () => {
    const userId = await newUser();
    const goalId = await createGoal(db, {
      userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
    });
    // A finished session first, so the view's history — and the area lookup it
    // hands to the context block — run against real rows rather than none.
    const earlier = await startSession(db, {
      userId,
      goalId,
      planned: {
        goalId, plannedFor: "2026-08-12", sessionIndex: 1,
        blocks: [{ type: "explain", skillId: skill.id, content: "c", estMinutes: 5 }],
        totalMinutes: 5, targetSkillIds: [skill.id], backingOff: false,
        reason: "r", compression: null, ranked: [],
      },
      now: new Date(NOW.getTime() - 86_400_000),
    });
    await completeSession(db, earlier, new Date(NOW.getTime() - 86_000_000));
    await upsertMastery(
      db, userId, PACK,
      { ...initialMastery(skill.id, skill.bktPriors), mastery: 0.6, evidenceCount: 2 },
      NOW,
    );

    const stored = await startSession(db, {
      userId,
      goalId,
      planned: {
        goalId, plannedFor: "2026-08-13", sessionIndex: 2,
        blocks: [
          { type: "explain", skillId: skill.id, content: "c", estMinutes: 10 },
          { type: "reflect", prompt: "How was it?", estMinutes: 5 },
        ],
        totalMinutes: 15, targetSkillIds: [skill.id], backingOff: false,
        reason: "r", compression: null, ranked: [],
      },
      now: NOW,
    });

    const view = await sessionView(db, userId, stored.id, NOW);
    expect(view?.mastery?.evidenceCount).toBe(2);
    expect(view?.block?.type).toBe("explain");
    expect(view?.skill?.id).toBe(skill.id);
    expect(view?.learnerContext).toContain(pack.name);
    expect(view?.finished).toBe(false);
  });

  it("has no skill on a block that is not about one", async () => {
    const userId = await newUser();
    const goalId = await createGoal(db, {
      userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
    });
    const stored = await startSession(db, {
      userId,
      goalId,
      planned: {
        goalId, plannedFor: "2026-08-13", sessionIndex: 1,
        blocks: [{ type: "reflect", prompt: "How was it?", estMinutes: 5 }],
        totalMinutes: 5, targetSkillIds: [], backingOff: false,
        reason: "r", compression: null, ranked: [],
      },
      now: NOW,
    });

    const view = await sessionView(db, userId, stored.id, NOW);
    expect(view?.skill).toBeUndefined();
    expect(view?.mastery).toBeUndefined();
  });

  it("seeds mastery from the pack's priors for a skill never observed", async () => {
    // A session can target a skill the diagnostic never asked about, and the
    // lesson's level has to come from somewhere. The pack's prior is that
    // somewhere — never a made-up zero.
    const userId = await newUser();
    const goalId = await createGoal(db, {
      userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
    });
    const stored = await startSession(db, {
      userId, goalId,
      planned: {
        goalId, plannedFor: "2026-08-13", sessionIndex: 1,
        blocks: [{ type: "explain", skillId: skill.id, content: "c", estMinutes: 10 }],
        totalMinutes: 10, targetSkillIds: [skill.id], backingOff: false,
        reason: "r", compression: null, ranked: [],
      },
      now: NOW,
    });

    const view = await sessionView(db, userId, stored.id, NOW);
    expect(view?.mastery?.evidenceCount).toBe(0);
    expect(view?.mastery?.mastery).toBe(skill.bktPriors.pInit);
  });

  it("shows the answer already given to the block on screen", async () => {
    const userId = await newUser();
    const goalId = await createGoal(db, {
      userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
    });
    const stored = await startSession(db, {
      userId, goalId,
      planned: {
        goalId, plannedFor: "2026-08-13", sessionIndex: 1,
        blocks: [
          {
            type: "check", skillId: skill.id, prompt: "why?",
            expected: skill.canDoStatement, isRetrieval: false,
            itemId: null, estMinutes: 5,
          },
        ],
        totalMinutes: 5, targetSkillIds: [skill.id], backingOff: false,
        reason: "r", compression: null, ranked: [],
      },
      now: NOW,
    });

    // Answered, then the cursor pushed back — a refresh after answering must
    // show the verdict rather than an empty box asking again.
    const answered = await recordResponse(db, stored, {
      blockIndex: 0, answer: "the grain", correct: true, gradedBy: "model",
      feedback: "That's it.", evidenceTier: 2, at: NOW.toISOString(),
    });
    await advance(db, answered, 0);

    const view = await sessionView(db, userId, stored.id, NOW);
    expect(view?.response?.answer).toBe("the grain");
  });

  it("degrades to no session when the goal's pack has left the build", async () => {
    const userId = await newUser();
    const goalId = await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec({ domain: "a-pack-that-was-deleted" }),
      mastery: [],
      now: NOW,
    });
    const stored = await startSession(db, {
      userId, goalId,
      planned: {
        goalId, plannedFor: "2026-08-13", sessionIndex: 1,
        blocks: [{ type: "reflect", prompt: "p", estMinutes: 5 }],
        totalMinutes: 5, targetSkillIds: [], backingOff: false,
        reason: "r", compression: null, ranked: [],
      },
      now: NOW,
    });

    expect(await sessionView(db, userId, stored.id, NOW)).toBeUndefined();
  });

  it("is absent for a session that is not the learner's", async () => {
    expect(await sessionView(db, await newUser(), crypto.randomUUID(), NOW)).toBeUndefined();
  });

  it("is absent when the session outlived its goal", async () => {
    const userId = await newUser();
    const goalId = await createGoal(db, {
      userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
    });
    const stored = await startSession(db, {
      userId, goalId,
      planned: {
        goalId, plannedFor: "2026-08-13", sessionIndex: 1,
        blocks: [{ type: "reflect", prompt: "p", estMinutes: 5 }],
        totalMinutes: 5, targetSkillIds: [], backingOff: false,
        reason: "r", compression: null, ranked: [],
      },
      now: NOW,
    });

    // A newer goal makes the older one inactive, so its session no longer has
    // a path to render against.
    await createGoal(db, {
      userId, packSlug: PACK, spec: spec(), mastery: [],
      now: new Date(NOW.getTime() + 1_000),
    });

    expect(await sessionView(db, userId, stored.id, NOW)).toBeUndefined();
  });

  /**
   * PLAN-ADAPTATION step 3 — a `stuck` signal reaching the lesson.
   *
   * On its own, a "solid" band asks for the standard lesson. The signal
   * escalates it to the worked example, which changes the cache key — so the
   * row saved under the escalated key is a *hit* only for the learner who said
   * they were lost, and a miss for the one who did not.
   *
   * Deliberately on a second skill: the shared `skill` above is the one every
   * other lesson test keys on, and a row written here under a common band would
   * turn one of their cache misses into a hit.
   */
  it("escalates a learner's lesson after they said they were lost", async () => {
    const other = graph.skills[1]!;
    const userId = await newUser();
    const goalId = await createGoal(db, {
      userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
    });
    const sessionId = (
      await startSession(db, {
        userId,
        goalId,
        planned: {
          goalId, plannedFor: "2026-08-13", sessionIndex: 1,
          blocks: [{ type: "explain", skillId: other.id, content: "c", estMinutes: 5 }],
          totalMinutes: 5, targetSkillIds: [other.id], backingOff: false,
          reason: "r", compression: null, ranked: [],
        },
        now: NOW,
      })
    ).id;

    const solid = {
      ...initialMastery(other.id, other.bktPriors),
      mastery: 0.9,
      evidenceCount: 3,
    };
    const escalated: LessonRequest = {
      packSlug: PACK,
      skillSlug: other.id,
      skillName: other.name,
      canDoStatement: other.canDoStatement,
      level: "solid",
      minutes: 12,
      support: "worked_example",
      priorDomain: "none",
    };
    await saveLesson(db, escalated, lesson, NOW);

    const explode = {
      messages: { create: async () => { throw new Error("must not be called"); } },
    } as never;

    // No signal yet: a solid learner wants the standard lesson, which is not
    // the row that was saved, so the cache misses and the model is reached for.
    await expect(
      lessonForBlock(db, explode, {
        userId, packSlug: PACK, skill: other, mastery: solid, minutes: 12, now: NOW,
      }),
    ).rejects.toThrow("must not be called");

    await recordTutorSignal(db, {
      userId, sessionId, packSlug: PACK, skillSlug: other.id,
      signal: "stuck", now: NOW,
    });

    // Same learner, same band, same skill — now a hit, because the signal moved
    // the support level that the key includes.
    const after = await lessonForBlock(db, explode, {
      userId, packSlug: PACK, skill: other, mastery: solid, minutes: 12, now: NOW,
    });
    expect(after.cached).toBe(true);

    await db
      .delete(lessonTable)
      .where(eq(lessonTable.skillId, skillId(PACK, other.id)));
  });

  it("serves a cached lesson without calling a model", async () => {
    const userId = await newUser();
    await saveLesson(db, request, lesson, NOW);

    const outcome = await lessonForBlock(
      db,
      { messages: { create: async () => { throw new Error("must not be called"); } } } as never,
      {
        userId, packSlug: PACK, skill,
        // Band "shaky", which is what the cached row was written under: the
        // level is part of the key, so a learner elsewhere on the scale is a
        // miss by design rather than by accident.
        mastery: {
          ...initialMastery(skill.id, skill.bktPriors),
          mastery: 0.4,
          evidenceCount: 2,
        },
        minutes: 12, now: NOW,
      },
    );

    expect(outcome.cached).toBe(true);
    expect(outcome.content?.objective).toBe("o");
  });

  it("generates, logs and caches a lesson on a miss", async () => {
    const userId = await newUser();
    const create = async () => ({
      id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5",
      stop_reason: "tool_use", stop_sequence: null,
      usage: {
        input_tokens: 10, output_tokens: 5,
        cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
      },
      content: [{ type: "tool_use", id: "t1", name: "submit", input: lesson }],
    });

    const first = await lessonForBlock(
      db,
      { messages: { create } } as never,
      {
        userId, packSlug: PACK, skill,
        mastery: { ...initialMastery(skill.id, skill.bktPriors), mastery: 0.7, evidenceCount: 2 },
        minutes: 12, now: NOW,
      },
    );

    expect(first.cached).toBe(false);
    expect(first.content?.objective).toBe("o");

    // The second learner at the same band pays a database read, not a model
    // call — §14.9.4 layer 2, which is the point of the whole key.
    const second = await lessonForBlock(
      db,
      { messages: { create: async () => { throw new Error("must not be called"); } } } as never,
      {
        userId, packSlug: PACK, skill,
        mastery: { ...initialMastery(skill.id, skill.bktPriors), mastery: 0.7, evidenceCount: 2 },
        minutes: 12, now: NOW,
      },
    );
    expect(second.cached).toBe(true);
  });

  it("returns no lesson when the model could not produce one", async () => {
    const userId = await newUser();
    const create = async () => ({
      id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5",
      stop_reason: "tool_use", stop_sequence: null,
      usage: {
        input_tokens: 10, output_tokens: 5,
        cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
      },
      content: [{ type: "tool_use", id: "t1", name: "submit", input: { objective: "half" } }],
    });

    const outcome = await lessonForBlock(
      db,
      { messages: { create } } as never,
      {
        userId, packSlug: PACK, skill,
        mastery: { ...initialMastery(skill.id, skill.bktPriors), mastery: 0.95, evidenceCount: 4 },
        minutes: 12, now: NOW,
      },
    );

    expect(outcome.content).toBeUndefined();
  });

  it("treats a cached row written under an older contract as a miss", async () => {
    await db.execute(
      // A row whose content no longer parses: regenerating costs cents, and
      // serving half a lesson costs a learner their session.
      `insert into lesson (skill_id, level, style_hash, content) values ('${skillId(PACK, skill.id)}', 'ancient', '${styleHashFor({ ...request, level: "ancient" })}', '{"objective":"only this"}'::jsonb) on conflict do nothing`,
    );

    expect(
      await cachedLesson(db, { ...request, level: "ancient" }),
    ).toBeUndefined();
  });

  it("chooses the worked example for a learner who has not got there yet", () => {
    expect(supportFor("no evidence yet")).toBe("worked_example");
    expect(supportFor("shaky")).toBe("worked_example");
    expect(supportFor("getting there")).toBe("standard");
    expect(supportFor("solid")).toBe("standard");
  });

  /**
   * PLAN-ADAPTATION step 3. The escalation is one-way on purpose: a learner who
   * has said out loud that they do not follow it gets the worked example
   * whatever their band says, and nothing can take it away from someone the
   * band already gives it to.
   */
  it("escalates support for a learner who said they were lost", () => {
    expect(supportFor("solid", true)).toBe("worked_example");
    expect(supportFor("getting there", true)).toBe("worked_example");
  });

  it("never de-escalates on a signal", () => {
    for (const level of ["no evidence yet", "shaky", "getting there", "solid"]) {
      const withSignal = supportFor(level, true);
      const without = supportFor(level, false);
      // worked_example is the higher support level, so a signal can only move
      // towards it, never away.
      if (without === "worked_example") expect(withSignal).toBe(without);
    }
  });

  it("keeps the cache to two buckets per band, not one per learner", () => {
    // The whole reason support is a small closed set: `styleHashFor` keys on it,
    // and an unbounded value here would give every learner their own lesson.
    const reachable = new Set(
      ["no evidence yet", "shaky", "getting there", "solid"].flatMap((level) => [
        supportFor(level, false),
        supportFor(level, true),
      ]),
    );
    expect(reachable.size).toBe(2);
  });

  describe("appendBlocks", () => {
    async function openSessionFor(userId: string) {
      const goalId = await createGoal(db, {
        userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
      });
      return startSession(db, {
        userId,
        goalId,
        planned: {
          goalId, plannedFor: "2026-08-13", sessionIndex: 1,
          blocks: [
            { type: "explain", skillId: skill.id, content: "c", estMinutes: 5 },
          ],
          totalMinutes: 5, targetSkillIds: [skill.id], backingOff: false,
          reason: "r", compression: null, ranked: [],
        },
        now: NOW,
      });
    }

    it("adds blocks and moves the learner onto the first of them", async () => {
      const userId = await newUser();
      const session = await openSessionFor(userId);
      const before = session.blocks.length;

      const after = await appendBlocks(db, session, [
        {
          type: "check", skillId: skill.id, prompt: "hard one",
          expected: "concepts", isRetrieval: false, itemId: "i1", estMinutes: 4,
        },
      ]);

      expect(after.blocks).toHaveLength(before + 1);
      expect(after.blockIndex).toBe(before);

      // And it is on the row, not only in the returned object.
      const reread = await sessionById(db, session.id, userId);
      expect(reread?.blocks).toHaveLength(before + 1);
      expect(reread?.blockIndex).toBe(before);
    });

    /**
     * Appending rather than inserting is what keeps every recorded response
     * pointing at the block it was actually about.
     */
    it("leaves the existing blocks and their indices alone", async () => {
      const userId = await newUser();
      const session = await openSessionFor(userId);

      const after = await appendBlocks(db, session, [
        { type: "reflect", prompt: "later", estMinutes: 2 },
      ]);

      expect(after.blocks.slice(0, session.blocks.length)).toEqual(
        session.blocks,
      );
    });

    it("writes nothing when there is nothing to add", async () => {
      const userId = await newUser();
      const session = await openSessionFor(userId);
      expect(await appendBlocks(db, session, [])).toEqual(session);
    });
  });

  describe("tutor signals", () => {
    it("records a signal against the skill and reads it back in slug space", async () => {
      const userId = await newUser();
      const goalId = await createGoal(db, {
        userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
      });
      const sessionId = (
        await startSession(db, {
          userId: userId,
          goalId,
          planned: {
            goalId, plannedFor: "2026-08-13", sessionIndex: 1,
            blocks: [{ type: "explain", skillId: skill.id, content: "c", estMinutes: 5 }],
            totalMinutes: 5, targetSkillIds: [skill.id], backingOff: false,
            reason: "r", compression: null, ranked: [],
          },
          now: NOW,
        })
      ).id;

      await recordTutorSignal(db, {
        userId,
        sessionId,
        packSlug: PACK,
        skillSlug: skill.id,
        signal: "stuck",
        now: NOW,
      });

      const rows = await recentSignals(db, userId, PACK, NOW);
      expect(rows).toEqual([
        { skillSlug: skill.id, signal: "stuck", at: NOW },
      ]);
    });

    it("keeps a signal with no skill out of the per-skill read", async () => {
      const userId = await newUser();
      const goalId = await createGoal(db, {
        userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
      });
      const sessionId = (
        await startSession(db, {
          userId: userId,
          goalId,
          planned: {
            goalId, plannedFor: "2026-08-13", sessionIndex: 1,
            blocks: [{ type: "explain", skillId: skill.id, content: "c", estMinutes: 5 }],
            totalMinutes: 5, targetSkillIds: [skill.id], backingOff: false,
            reason: "r", compression: null, ranked: [],
          },
          now: NOW,
        })
      ).id;

      await recordTutorSignal(db, {
        userId,
        sessionId,
        packSlug: PACK,
        skillSlug: null,
        signal: "stuck",
        now: NOW,
      });

      // The row exists; every receptor is per-skill, so nothing reads it.
      expect(await recentSignals(db, userId, PACK, NOW)).toEqual([]);
    });

    /**
     * A signal is an impression of one moment. A learner confused a fortnight
     * ago who has passed two checks since is not still confused, and nothing
     * else expires these — the window is the only thing stopping one bad
     * afternoon damping a skill forever.
     */
    it("forgets a signal older than the window", async () => {
      const userId = await newUser();
      const goalId = await createGoal(db, {
        userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
      });
      const sessionId = (
        await startSession(db, {
          userId: userId,
          goalId,
          planned: {
            goalId, plannedFor: "2026-08-13", sessionIndex: 1,
            blocks: [{ type: "explain", skillId: skill.id, content: "c", estMinutes: 5 }],
            totalMinutes: 5, targetSkillIds: [skill.id], backingOff: false,
            reason: "r", compression: null, ranked: [],
          },
          now: NOW,
        })
      ).id;

      const old = new Date(NOW.getTime() - (SIGNAL_WINDOW_DAYS + 1) * 86_400_000);
      await recordTutorSignal(db, {
        userId, sessionId, packSlug: PACK, skillSlug: skill.id,
        signal: "stuck", now: old,
      });

      expect(await recentSignals(db, userId, PACK, NOW)).toEqual([]);
    });

    it("does not leak one learner's signals to another", async () => {
      const mine = await newUser();
      const theirs = await newUser();
      const goalId = await createGoal(db, {
        userId: mine, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
      });
      const sessionId = (
        await startSession(db, {
          userId: mine,
          goalId,
          planned: {
            goalId, plannedFor: "2026-08-13", sessionIndex: 1,
            blocks: [{ type: "explain", skillId: skill.id, content: "c", estMinutes: 5 }],
            totalMinutes: 5, targetSkillIds: [skill.id], backingOff: false,
            reason: "r", compression: null, ranked: [],
          },
          now: NOW,
        })
      ).id;

      await recordTutorSignal(db, {
        userId: mine, sessionId, packSlug: PACK, skillSlug: skill.id,
        signal: "stuck", now: NOW,
      });

      expect(await recentSignals(db, theirs, PACK, NOW)).toEqual([]);
    });
  });

  it("logs both halves of a tutor turn, costing only the answer", async () => {
    const userId = await newUser();
    const goalId = await createGoal(db, {
      userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
    });
    const stored = await startSession(db, {
      userId, goalId,
      planned: {
        goalId, plannedFor: "2026-08-13", sessionIndex: 1,
        blocks: [{ type: "reflect", prompt: "p", estMinutes: 5 }],
        totalMinutes: 5, targetSkillIds: [], backingOff: false,
        reason: "r", compression: null, ranked: [],
      },
      now: NOW,
    });

    await logTurn(db, {
      userId,
      sessionId: stored.id,
      question: "why?",
      answer: "because",
      meta: {
        model: "claude-sonnet-5",
        promptName: "tutor",
        promptVersion: 1,
        attempts: 1,
        usage: {
          inputTokens: 1_200, outputTokens: 40,
          cacheReadInputTokens: 1_150, cacheCreationInputTokens: 0,
        },
        costCents: 0.2,
        uncachedCostCents: 0.9,
        latencyMs: 800,
      },
      now: NOW,
    });

    const rows = await db
      .select()
      .from(interaction)
      .where(and(eq(interaction.userId, userId), eq(interaction.sessionId, stored.id)));

    expect(rows).toHaveLength(2);
    const answer = rows.find((r) => r.role === "assistant")!;
    // §14.9.4 — the cache read is recorded, because a silent miss triples the
    // bill with no error and no log line.
    expect(answer.cacheReadTokens).toBe(1_150);
    expect(rows.find((r) => r.role === "user")!.costCents).toBeNull();

    const transcript = await transcriptFor(db, stored.id, userId);
    expect(transcript.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("drops a transcript row whose role it cannot replay", async () => {
    const userId = await newUser();
    const goalId = await createGoal(db, {
      userId, packSlug: PACK, spec: spec(), mastery: [], now: NOW,
    });
    const stored = await startSession(db, {
      userId, goalId,
      planned: {
        goalId, plannedFor: "2026-08-13", sessionIndex: 1,
        blocks: [{ type: "reflect", prompt: "p", estMinutes: 5 }],
        totalMinutes: 5, targetSkillIds: [], backingOff: false,
        reason: "r", compression: null, ranked: [],
      },
      now: NOW,
    });

    await db.insert(interaction).values({
      userId, sessionId: stored.id, role: "system", content: "not a turn",
    });

    expect(await transcriptFor(db, stored.id, userId)).toEqual([]);
  });

  it("upserts mastery for a skill that has never been observed", async () => {
    const userId = await newUser();
    await upsertMastery(db, userId, PACK, initialMastery(skill.id, skill.bktPriors), NOW);

    const [row] = await db
      .select()
      .from(learnerSkillMastery)
      .where(
        and(
          eq(learnerSkillMastery.userId, userId),
          eq(learnerSkillMastery.skillId, skillId(PACK, skill.id)),
        ),
      );
    expect(row).toBeDefined();
  });
});

describe("pure session helpers", () => {
  it("treats whitespace as blank", () => {
    expect(isBlank("  \n ")).toBe(true);
    expect(isBlank(" a ")).toBe(false);
  });

  it("finds only check blocks", () => {
    const session = {
      id: "s", userId: "u", goalId: "g", planId: null,
      blocks: [{ type: "reflect", prompt: "p", estMinutes: 1 }] as SessionBlock[],
      blockIndex: 0, responses: [], startedAt: null, completedAt: null,
    };
    expect(checkBlockAt(session, 0)).toBeUndefined();
    expect(checkBlockAt(session, 9)).toBeUndefined();
  });
});
