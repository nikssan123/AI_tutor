import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClient } from "@/db";
import { learningSession, user } from "@/db/schema";
import { findPack } from "@/lib/content";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { createGoal, upsertMastery } from "@/lib/goals/store";
import { recordMasteryUpdate } from "@/lib/session/store";
import { createSubmission, recordEvaluation } from "@/lib/submissions/store";
import { artefactEvidence, weekActivity } from "@/lib/mastery/store";
import { digestFor, ledgerFor } from "@/lib/mastery/view";
import { windowStart } from "@/lib/mastery/digest";
import type { GoalSpec } from "@/lib/contracts/goal";
import type { MasteryState } from "@/lib/engine";
import type { GradedResult } from "@/lib/evaluation";

/**
 * §15's audit trail, read back out: "every mastery change is traceable to
 * evidence."
 *
 * These run against the local Postgres and are skipped without DATABASE_URL —
 * see AGENTS.md, which is also why a run without it reports ~96.5% coverage
 * rather than a regression.
 *
 * The property under test is the one §24 E9 accepts on: what reaches the claim
 * list is exactly what has a marked hand-in behind it, and the link goes to
 * that hand-in. Everything else here is the arithmetic `/progress` shows.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

const PACK = "photography";
const NOW = new Date("2026-08-13T12:00:00.000Z");
const IN_WINDOW = new Date("2026-08-10T12:00:00.000Z");
const BEFORE_WINDOW = new Date("2026-08-01T12:00:00.000Z");

const spec = (overrides: Partial<GoalSpec> = {}): GoalSpec => ({
  rawGoal: "take photographs worth printing",
  domain: PACK,
  targetOutcome: "a portfolio of ten",
  outcomeType: "personal",
  statedLevel: "beginner",
  weeklyHours: 3,
  deadline: null,
  motivation: "a show in spring",
  constraints: [],
  existingAssets: [],
  clarity: 1,
  ...overrides,
});

/** A prior strong enough that one good hand-in leaves a standing claim. */
const held = (slug: string, overrides: Partial<MasteryState> = {}): MasteryState => ({
  skillId: slug,
  mastery: 0.9,
  confidence: 0.8,
  evidenceCount: 2,
  lastSuccessAt: NOW.toISOString(),
  lastPracticedAt: NOW.toISOString(),
  // Long enough that the claim is not already on its way out — the fading and
  // faded cases are covered against the pure builder in ledger.test.ts.
  decayHalfLifeDays: 180,
  ...overrides,
});

const graded = (over: Partial<GradedResult> = {}): GradedResult => ({
  overall: 0.8,
  confidence: 0.8,
  evalTier: 2,
  verification: { upheld: [], invalidated: [], missing: [], passed: true },
  criteria: [
    {
      criterionId: "light",
      name: "Light",
      band: "strong",
      evidence: "the window is behind the subject",
      reasoning: "you used it deliberately",
      weight: 1,
    },
  ],
  strengths: [],
  gaps: [],
  nextActions: [],
  bandSpread: 0,
  humanReview: false,
  observation: { correct: true, confidence: 0.8, evidenceTier: 2 },
  ...over,
});

live("the mastery ledger, against the database", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const pack = findPack(PACK)!;
  const [first, second] = pack.skills;
  const project = pack.projects[0]!;
  const users: string[] = [];

  async function newUser(): Promise<string> {
    const id = `mastery-${crypto.randomUUID()}`;
    users.push(id);
    await db.insert(user).values({ id, name: "Test", email: `${id}@example.test` });
    return id;
  }

  /** A goal in the seeded pack, optionally with mastery already on it. */
  async function goalFor(
    userId: string,
    mastery: MasteryState[] = [],
    overrides: Partial<GoalSpec> = {},
  ): Promise<string> {
    return createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(overrides),
      mastery,
      now: NOW,
    });
  }

  /** A hand-in, marked, exactly as the Inngest function does it. */
  async function handIn(
    userId: string,
    skillSlug: string,
    at: Date,
    prior: MasteryState = held(skillSlug),
  ): Promise<string> {
    const id = await createSubmission(db, {
      userId,
      packSlug: PACK,
      projectSlug: project.slug,
      artefact: "a photograph of a window",
      truncated: false,
      skillSlug,
      now: at,
    });

    await recordEvaluation(db, {
      submissionId: id,
      userId,
      packSlug: PACK,
      rubricSlug: project.rubric,
      rubricVersion: 1,
      skill: pack.skills.find((s) => s.slug === skillSlug)!,
      mastery: prior,
      result: graded(),
      model: "claude-opus-5",
      promptVersion: "eval@1",
      now: at,
    });

    return id;
  }

  beforeAll(async () => {
    // The reads join `skill`, so the pack has to actually be there.
    await seedPack(db, loadPack(`packs/${PACK}`));
  }, 60_000);

  afterAll(async () => {
    for (const id of users) await db.delete(user).where(eq(user.id, id));
    await close();
  });

  describe("artefactEvidence", () => {
    it("finds nothing for a learner who has handed nothing in", async () => {
      const userId = await newUser();
      await goalFor(userId);
      expect(await artefactEvidence(db, userId, PACK)).toEqual(new Map());
    });

    it("links a skill to its newest hand-in and counts them all", async () => {
      const userId = await newUser();
      await goalFor(userId);
      await handIn(userId, first!.slug, BEFORE_WINDOW);
      const newest = await handIn(userId, first!.slug, IN_WINDOW);

      const evidence = await artefactEvidence(db, userId, PACK);
      expect(evidence.get(first!.slug)).toEqual({
        submissionId: newest,
        count: 2,
      });
    });

    it("ignores mastery that moved without an artefact behind it", async () => {
      // A recall question answered in a session moves mastery and writes an
      // audit row — and it is not something a learner can show anyone, which
      // is the whole reason the read joins `evaluation`.
      const userId = await newUser();
      await goalFor(userId);
      await recordMasteryUpdate(db, {
        userId,
        packSlug: PACK,
        skillSlug: first!.slug,
        prior: 0.4,
        posterior: 0.6,
        observationConfidence: 0.6,
        evidenceTier: 2,
        reason: "Answered a recall question correctly.",
        now: IN_WINDOW,
      });

      expect(await artefactEvidence(db, userId, PACK)).toEqual(new Map());
    });

    it("never shows one learner another's work", async () => {
      const mine = await newUser();
      const theirs = await newUser();
      await goalFor(mine);
      await goalFor(theirs);
      await handIn(theirs, first!.slug, IN_WINDOW);

      expect(await artefactEvidence(db, mine, PACK)).toEqual(new Map());
    });
  });

  describe("weekActivity", () => {
    async function session(
      userId: string,
      goalId: string,
      completedAt: Date,
      durationMinutes: number | null,
    ): Promise<void> {
      await db.insert(learningSession).values({
        userId,
        goalId,
        startedAt: completedAt,
        completedAt,
        blocks: [],
        durationMinutes,
      });
    }

    const window = (userId: string, goalId: string) => ({
      userId,
      goalId,
      packSlug: PACK,
      from: windowStart(NOW),
      to: NOW,
    });

    it("sums the minutes inside the window and ignores the ones before it", async () => {
      const userId = await newUser();
      const goalId = await goalFor(userId);
      await session(userId, goalId, IN_WINDOW, 25);
      await session(userId, goalId, IN_WINDOW, 35);
      await session(userId, goalId, BEFORE_WINDOW, 90);

      const activity = await weekActivity(db, window(userId, goalId));
      expect(activity.sessions).toBe(2);
      expect(activity.minutesLogged).toBe(60);
    });

    it("counts a session that never recorded a duration as no time at all", async () => {
      const userId = await newUser();
      const goalId = await goalFor(userId);
      await session(userId, goalId, IN_WINDOW, null);

      const activity = await weekActivity(db, window(userId, goalId));
      expect(activity.sessions).toBe(1);
      expect(activity.minutesLogged).toBe(0);
    });

    it("reports which skills moved, summing repeats and dropping the rest", async () => {
      const userId = await newUser();
      const goalId = await goalFor(userId);

      for (const [prior, posterior] of [
        [0.3, 0.4],
        [0.4, 0.5],
      ]) {
        await recordMasteryUpdate(db, {
          userId,
          packSlug: PACK,
          skillSlug: first!.slug,
          prior: prior!,
          posterior: posterior!,
          observationConfidence: 0.6,
          evidenceTier: 2,
          reason: "moved",
          now: IN_WINDOW,
        });
      }

      // Backwards, and therefore not something that "moved" this week.
      await recordMasteryUpdate(db, {
        userId,
        packSlug: PACK,
        skillSlug: second!.slug,
        prior: 0.5,
        posterior: 0.4,
        observationConfidence: 0.6,
        evidenceTier: 2,
        reason: "missed",
        now: IN_WINDOW,
      });

      // Forwards, but last month.
      await recordMasteryUpdate(db, {
        userId,
        packSlug: PACK,
        skillSlug: second!.slug,
        prior: 0.1,
        posterior: 0.3,
        observationConfidence: 0.6,
        evidenceTier: 2,
        reason: "moved, but before the window",
        now: BEFORE_WINDOW,
      });

      const activity = await weekActivity(db, window(userId, goalId));
      expect(activity.moved).toEqual([
        { name: first!.name, delta: expect.closeTo(0.2, 5) },
      ]);
    });

    it("counts what was handed in, whatever the marking did next", async () => {
      const userId = await newUser();
      const goalId = await goalFor(userId);
      await handIn(userId, first!.slug, IN_WINDOW);
      await handIn(userId, second!.slug, IN_WINDOW);
      await handIn(userId, first!.slug, BEFORE_WINDOW);

      expect((await weekActivity(db, window(userId, goalId))).artefacts).toBe(2);
    });
  });

  describe("what the two screens are handed", () => {
    it("has nothing to show before there is a goal", async () => {
      const userId = await newUser();
      expect(await ledgerFor(db, userId, NOW)).toBeUndefined();
      expect(await digestFor(db, userId, NOW)).toBeUndefined();
    });

    it("degrades to nothing when the goal's pack has left the build", async () => {
      // A pack removed from disk is a deployment event, not a corrupt row.
      const userId = await newUser();
      await goalFor(userId, [], { domain: "a-pack-that-was-deleted" });

      expect(await ledgerFor(db, userId, NOW)).toBeUndefined();
      expect(await digestFor(db, userId, NOW)).toBeUndefined();
    });

    it("claims the skill with a hand-in behind it, and nothing else", async () => {
      const userId = await newUser();
      // Both skills sit above the bar; only one of them has been shown.
      await goalFor(userId, [held(first!.slug), held(second!.slug)]);
      const submissionId = await handIn(userId, first!.slug, IN_WINDOW);

      const view = await ledgerFor(db, userId, NOW);
      expect(view!.ledger.canDo.map((e) => e.skillSlug)).toEqual([first!.slug]);
      expect(view!.ledger.canDo[0]!.submissionId).toBe(submissionId);
      expect(view!.ledger.canDo[0]!.statement).toBe(first!.canDoStatement);

      const unproven = view!.ledger.whatsLeft.find(
        (e) => e.skillSlug === second!.slug,
      );
      expect(unproven!.standing).toBe("unproven");
      expect(unproven!.submissionId).toBeNull();
    });

    it("builds the week out of the same rows the ledger reads", async () => {
      const userId = await newUser();
      const goalId = await goalFor(userId, [held(first!.slug)]);
      await handIn(userId, first!.slug, IN_WINDOW);
      await db.insert(learningSession).values({
        userId,
        goalId,
        startedAt: IN_WINDOW,
        completedAt: IN_WINDOW,
        blocks: [],
        durationMinutes: 120,
      });

      const view = await digestFor(db, userId, NOW);
      expect(view!.digest.hoursLogged).toBe(2);
      expect(view!.digest.committedHours).toBe(3);
      expect(view!.digest.keptCommitment).toBe(false);
      expect(view!.digest.sessions).toBe(1);
      expect(view!.digest.artefacts).toBe(1);
      expect(view!.digest.moved.map((m) => m.name)).toEqual([first!.name]);
      // One skill proved, none of it slipping — the same fact the ledger
      // shows, because it is read off the ledger.
      expect(view!.digest.tracked).toBe(1);
      expect(view!.digest.slipping).toBe(0);
      // The estimate is recomputed now, so it reflects the skill just proved.
      expect(view!.digest.remainingHours).toBeGreaterThan(0);
      expect(view!.digest.weeksAtCommitment).toBeGreaterThan(0);
      expect(view!.digest.weeksAtActualPace).toBeGreaterThan(
        view!.digest.weeksAtCommitment,
      );
      expect(view!.from).toEqual(windowStart(NOW));
      expect(view!.to).toEqual(NOW);
    });

    it("keeps mastery a learner has never handed work in for out of the claim", async () => {
      const userId = await newUser();
      await goalFor(userId);
      await upsertMastery(db, userId, PACK, held(first!.slug), NOW);

      const view = await ledgerFor(db, userId, NOW);
      expect(view!.ledger.canDo).toHaveLength(0);
      expect(view!.pack.slug).toBe(PACK);
      expect(view!.goal.packSlug).toBe(PACK);
    });
  });
});
