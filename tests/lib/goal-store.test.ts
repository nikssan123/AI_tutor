import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClient } from "@/db";
import {
  evaluation,
  learnerSkillMastery,
  learningGoal,
  masteryUpdate,
  submission,
  user,
} from "@/db/schema";
import { findPack } from "@/lib/content";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { rubricId, skillId } from "@/lib/packs/ids";
import {
  activeGoal,
  createGoal,
  DEFAULT_SESSION_MINUTES,
  goalsFor,
  masteryFor,
  setGoalDepth,
  sessionMinutesFor,
  setGoalStatus,
} from "@/lib/goals/store";
import { markAchievedIfComplete } from "@/lib/goals/achievement";
import { coursesFor } from "@/lib/goals/courses";
import { todayFor } from "@/lib/goals/today";
import type { GoalSpec } from "@/lib/contracts/goal";
import type { MasteryState } from "@/lib/engine";

/**
 * The slug/UUID seam (§15). These run against the local Postgres and are
 * skipped without DATABASE_URL — see AGENTS.md, which is also why a run without
 * it reports ~96.5% coverage rather than a regression.
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
  motivation: "a trip in October",
  constraints: [],
  existingAssets: [],
  depth: "standard",
  clarity: 1,
  ...overrides,
});

const state = (
  slug: string,
  overrides: Partial<MasteryState> = {},
): MasteryState => ({
  skillId: slug,
  mastery: 0.9,
  confidence: 0.8,
  evidenceCount: 2,
  lastSuccessAt: "2026-08-12T09:00:00.000Z",
  lastPracticedAt: "2026-08-12T09:00:00.000Z",
  decayHalfLifeDays: 7,
  ...overrides,
});

live("the goal store", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const pack = findPack(PACK)!;
  const [first, second] = pack.skills;
  const users: string[] = [];

  /** A fresh user per test, so nothing leaks between them. */
  async function newUser(): Promise<string> {
    const id = `test-${crypto.randomUUID()}`;
    users.push(id);
    await db.insert(user).values({ id, name: "Test", email: `${id}@example.test` });
    return id;
  }

  beforeAll(async () => {
    // The mastery read joins `skill`, so the pack has to actually be there.
    // Only this pack, and deliberately this one: tests/packs/seed.test.ts
    // clears every *other* pack as its cleanup, and these files run in
    // parallel. Seeding the whole catalogue here would race with it.
    await seedPack(db, loadPack(`packs/${PACK}`));
  }, 60_000);

  afterAll(async () => {
    for (const id of users) await db.delete(user).where(eq(user.id, id));
    await close();
  });

  it("has no active goal before one is set", async () => {
    expect(await activeGoal(db, await newUser())).toBeUndefined();
  });

  it("stores a goal and reads it back through the spec", async () => {
    const userId = await newUser();
    const goalId = await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [],
      now: NOW,
    });

    const goal = await activeGoal(db, userId);
    expect(goal?.id).toBe(goalId);
    // The pack a goal belongs to is read off the spec's domain, so the two can
    // never drift apart into a goal pointing at one pack and planning another.
    expect(goal?.packSlug).toBe(PACK);
    expect(goal?.spec.rawGoal).toBe("stop being scared of window functions");
  });

  it("translates mastery between slug space and UUID space", async () => {
    const userId = await newUser();
    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [state(first!.slug), state(second!.slug, { mastery: 0.4 })],
      now: NOW,
    });

    const rows = await db
      .select()
      .from(learnerSkillMastery)
      .where(eq(learnerSkillMastery.userId, userId));
    expect(rows.map((r) => r.skillId).sort()).toEqual(
      [skillId(PACK, first!.slug), skillId(PACK, second!.slug)].sort(),
    );

    const read = await masteryFor(db, userId, PACK);
    expect(read.map((m) => m.skillId).sort()).toEqual(
      [first!.slug, second!.slug].sort(),
    );
    expect(read.find((m) => m.skillId === first!.slug)).toEqual(
      state(first!.slug),
    );
  });

  it("keeps mastery when a second goal is set in the same pack", async () => {
    // History belongs to the (user, skill) pair, not to the goal that produced
    // it — starting again does not erase what someone proved.
    const userId = await newUser();
    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [state(first!.slug)],
      now: NOW,
    });
    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec({ rawGoal: "second attempt" }),
      mastery: [],
      now: new Date("2026-08-14T09:00:00.000Z"),
    });

    expect((await masteryFor(db, userId, PACK)).map((m) => m.skillId)).toEqual([
      first!.slug,
    ]);
    // Newest active goal wins (§8 screen 6 shows one card).
    expect((await activeGoal(db, userId))?.spec.rawGoal).toBe("second attempt");
  });

  it("upserts rather than duplicating when a skill is observed again", async () => {
    const userId = await newUser();
    for (const mastery of [0.3, 0.75]) {
      await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [state(first!.slug, { mastery, evidenceCount: 5 })],
        now: NOW,
      });
    }

    const read = await masteryFor(db, userId, PACK);
    expect(read).toHaveLength(1);
    expect(read[0]!.mastery).toBe(0.75);
  });

  it("stores null timestamps for a skill never successfully demonstrated", async () => {
    const userId = await newUser();
    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [
        state(first!.slug, { lastSuccessAt: null, lastPracticedAt: null }),
      ],
      now: NOW,
    });

    const read = await masteryFor(db, userId, PACK);
    expect(read[0]!.lastSuccessAt).toBeNull();
    expect(read[0]!.lastPracticedAt).toBeNull();
  });

  it("does not leak mastery across packs", async () => {
    const userId = await newUser();
    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [state(first!.slug)],
      now: NOW,
    });

    expect(await masteryFor(db, userId, "photography")).toEqual([]);
  });

  it("ignores a goal whose spec no longer parses", async () => {
    // Rather than guessing at the missing fields and planning something the
    // learner never asked for.
    const userId = await newUser();
    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [],
      now: NOW,
    });
    await db.execute(
      `update learning_goal set goal_spec = '{"rawGoal":"broken"}'::jsonb where user_id = '${userId}'`,
    );

    expect(await activeGoal(db, userId)).toBeUndefined();
  });

  it("falls back to the default session length before a profile exists", async () => {
    const userId = await newUser();
    expect(await sessionMinutesFor(db, userId)).toBe(DEFAULT_SESSION_MINUTES);

    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [],
      now: NOW,
    });
    expect(await sessionMinutesFor(db, userId)).toBe(DEFAULT_SESSION_MINUTES);
  });

  describe("setGoalDepth", () => {
    it("moves the goal between depths and leaves the rest of the spec alone", async () => {
      const userId = await newUser();
      const goalId = await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [],
        now: NOW,
      });

      expect(await setGoalDepth(db, userId, goalId, "sprint")).toBe(true);

      const goal = await activeGoal(db, userId);
      expect(goal?.spec.depth).toBe("sprint");
      // Everything else survives the read-modify-write. A switch that quietly
      // reset the weekly budget would reshape every session after it.
      expect(goal?.spec.weeklyHours).toBe(spec().weeklyHours);
      expect(goal?.spec.rawGoal).toBe(spec().rawGoal);
    });

    it("refuses to move somebody else's goal", async () => {
      const owner = await newUser();
      const stranger = await newUser();
      const goalId = await createGoal(db, {
        userId: owner,
        packSlug: PACK,
        spec: spec(),
        mastery: [],
        now: NOW,
      });

      expect(await setGoalDepth(db, stranger, goalId, "mastery")).toBe(false);
      expect((await activeGoal(db, owner))?.spec.depth).toBe("standard");
    });

    /**
     * The same rule `activeGoal` applies: a goal whose spec no longer parses is
     * one we cannot plan against, so it is left alone rather than partially
     * rewritten into something even less readable.
     */
    it("leaves a goal whose spec no longer parses alone", async () => {
      const userId = await newUser();
      const goalId = await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [],
        now: NOW,
      });

      await db
        .update(learningGoal)
        .set({ goalSpec: { rawGoal: "half a spec" } })
        .where(eq(learningGoal.id, goalId));

      expect(await setGoalDepth(db, userId, goalId, "sprint")).toBe(false);
    });

    it("reports nothing moved for a goal that does not exist", async () => {
      const userId = await newUser();
      expect(
        await setGoalDepth(db, userId, crypto.randomUUID(), "sprint"),
      ).toBe(false);
    });

    /**
     * The promise the path screen prints. Depth decides what the projection
     * asks for and has no opinion about evidence, so a switch cannot cost a
     * learner a skill they proved.
     */
    it("does not disturb what the learner has already proved", async () => {
      const userId = await newUser();
      const goalId = await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [state(first!.slug, { mastery: 0.99 })],
        now: NOW,
      });

      const before = await masteryFor(db, userId, PACK);
      await setGoalDepth(db, userId, goalId, "sprint");
      expect(await masteryFor(db, userId, PACK)).toEqual(before);
    });
  });
});

live("todayFor — assembling what /today plans against", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const pack = findPack(PACK)!;
  const users: string[] = [];

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
    await close();
  });

  /**
   * A marked hand-in behind every skill in the pack, which is what the ledger
   * requires before it will claim one (§24 E9 — "every capability statement
   * links to the artefact that proves it").
   *
   * Written as rows rather than by running the grader: what is under test is
   * whether the course notices it is finished, and driving Opus through fifty
   * submissions to find out would be a slow way to ask.
   */
  async function proveEverySkill(userId: string): Promise<void> {
    for (const skill of pack.skills) {
      const submissionId = crypto.randomUUID();
      const evaluationId = crypto.randomUUID();

      await db.insert(submission).values({
        id: submissionId,
        userId,
        projectId: null,
        exerciseId: null,
        status: "complete",
        submittedAt: NOW,
      });
      await db.insert(evaluation).values({
        id: evaluationId,
        submissionId,
        rubricId: rubricId(PACK, pack.rubrics[0]!.slug),
        rubricVersion: 1,
        overallScore: 0.9,
        confidence: 0.9,
        evalTier: 1,
        criterionResults: [],
        strengths: [],
        gaps: [],
        nextActions: [],
        modelUsed: "test",
        promptVersion: "1",
        verifierPassed: true,
        humanReviewed: false,
        createdAt: NOW,
      });
      await db.insert(masteryUpdate).values({
        userId,
        skillId: skillId(PACK, skill.slug),
        evaluationId,
        priorMastery: 0.5,
        posteriorMastery: 0.99,
        delta: 0.49,
        observationConfidence: 0.9,
        evidenceTier: 1,
        reason: "test fixture",
        createdAt: NOW,
      });
    }
  }

  it("returns nothing at all until a goal exists", async () => {
    expect(await todayFor(db, await newUser(), NOW)).toBeUndefined();
  });

  it("plans a real session against the stored goal", async () => {
    const userId = await newUser();
    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [],
      now: NOW,
    });

    const view = await todayFor(db, userId, NOW);
    expect(view?.pack.slug).toBe(PACK);
    expect(view?.session.blocks.length).toBeGreaterThan(0);
    expect(view?.session.reason).not.toBe("");
    // The planner's own numbers, not the page's: the projection covers the
    // whole pack, split between required, optional and skipped.
    const projection = view!.projection;
    expect(
      projection.requiredSkillIds.length +
        projection.optionalSkillIds.length +
        projection.excludedSkillIds.length,
    ).toBe(pack.skills.length);
  });

  it("is deterministic — the same state plans the same session (§24 E5)", async () => {
    const userId = await newUser();
    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [],
      now: NOW,
    });

    const a = await todayFor(db, userId, NOW);
    const b = await todayFor(db, userId, NOW);
    expect(JSON.stringify(a?.session)).toBe(JSON.stringify(b?.session));
  });

  it("honours 'I have less time' without changing anything stored", async () => {
    const userId = await newUser();
    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [],
      now: NOW,
    });

    const full = await todayFor(db, userId, NOW);
    const short = await todayFor(db, userId, NOW, { availableMinutes: 15 });

    expect(short!.session.totalMinutes).toBeLessThanOrEqual(15);
    expect(short!.session.totalMinutes).toBeLessThan(full!.session.totalMinutes);
  });

  it("skips what the learner already evidenced", async () => {
    const userId = await newUser();
    // Demonstrated *today*: a day of decay at a seven-day half-life already
    // pulls 0.9 under the bar, which is the model working, not a fixture bug.
    const known = pack.skills
      .slice(0, 3)
      .map((s) => state(s.slug, { lastSuccessAt: NOW.toISOString() }));
    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: known,
      now: NOW,
    });

    const view = await todayFor(db, userId, NOW);
    expect(view!.projection.excludedSkillIds).toEqual(
      expect.arrayContaining(known.map((k) => k.skillId)),
    );
    for (const skill of known) {
      expect(view!.session.targetSkillIds).not.toContain(skill.skillId);
    }
  });

  it("degrades to no view when the goal's pack has left the build", async () => {
    // A pack removed from disk is a deployment event, not a corrupt row.
    const userId = await newUser();
    await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec({ domain: "a-pack-that-was-deleted" }),
      mastery: [],
      now: NOW,
    });

    expect(await todayFor(db, userId, NOW)).toBeUndefined();
  });

  /* ── The lifecycle ──────────────────────────────────────────────────────── */

  describe("one course runs at a time", () => {
    it("puts the running course aside when a second is started", async () => {
      const userId = await newUser();
      const firstGoal = await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [],
        now: NOW,
      });
      const secondGoal = await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec({ rawGoal: "the second one" }),
        mastery: [],
        now: new Date("2026-08-14T09:00:00.000Z"),
      });

      // Not "the newest of two active rows wins" — the older one is genuinely
      // moved, so there is exactly one active row to win.
      const goals = await goalsFor(db, userId);
      expect(goals.find((g) => g.id === firstGoal)?.status).toBe("paused");
      expect(goals.find((g) => g.id === secondGoal)?.status).toBe("active");
      expect(goals.filter((g) => g.status === "active")).toHaveLength(1);
    });

    it("puts the running course aside when another is picked up", async () => {
      const userId = await newUser();
      const firstGoal = await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [],
        now: NOW,
      });
      const secondGoal = await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec({ rawGoal: "the second one" }),
        mastery: [],
        now: new Date("2026-08-14T09:00:00.000Z"),
      });

      expect(await setGoalStatus(db, userId, firstGoal, "active")).toBe(true);

      expect((await activeGoal(db, userId))?.id).toBe(firstGoal);
      const goals = await goalsFor(db, userId);
      expect(goals.find((g) => g.id === secondGoal)?.status).toBe("paused");
      expect(goals.filter((g) => g.status === "active")).toHaveLength(1);
    });
  });

  describe("putting a course away", () => {
    it("leaves nothing running, and leaves the course to come back to", async () => {
      const userId = await newUser();
      const goalId = await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [state(pack.skills[0]!.slug)],
        now: NOW,
      });

      expect(await setGoalStatus(db, userId, goalId, "paused")).toBe(true);
      expect(await activeGoal(db, userId)).toBeUndefined();

      const [course] = await goalsFor(db, userId);
      expect(course?.status).toBe("paused");
    });

    /** The rows are keyed per learner per skill; they were never the goal's. */
    it("keeps the mastery the learner earned on it", async () => {
      const userId = await newUser();
      const goalId = await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [state(pack.skills[0]!.slug)],
        now: NOW,
      });

      await setGoalStatus(db, userId, goalId, "abandoned");
      expect(await masteryFor(db, userId, PACK)).toHaveLength(1);
    });

    it("refuses to move a course that is not this learner's", async () => {
      const owner = await newUser();
      const stranger = await newUser();
      const goalId = await createGoal(db, {
        userId: owner,
        packSlug: PACK,
        spec: spec(),
        mastery: [],
        now: NOW,
      });

      expect(await setGoalStatus(db, stranger, goalId, "abandoned")).toBe(false);
      expect((await activeGoal(db, owner))?.id).toBe(goalId);
    });
  });

  describe("listing a learner's courses", () => {
    it("names them in the pack's own words", async () => {
      const userId = await newUser();
      await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [],
        now: NOW,
      });

      expect(await coursesFor(db, userId)).toEqual([
        {
          goalId: expect.any(String),
          name: pack.name,
          taxonomyParent: pack.taxonomyParent,
          status: "active",
        },
      ]);
    });

    it("drops a course whose spec no longer parses", async () => {
      const userId = await newUser();
      await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [],
        now: NOW,
      });
      await db.execute(
        `update learning_goal set goal_spec = '{"rawGoal":"broken"}'::jsonb where user_id = '${userId}'`,
      );

      expect(await goalsFor(db, userId)).toEqual([]);
    });

    /**
     * A status the column holds but the product does not know. Guessing
     * "active" would put a course back in front of a learner who had put it
     * away, so the row is dropped rather than defaulted.
     */
    it("drops a course whose status the product does not recognise", async () => {
      const userId = await newUser();
      await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [],
        now: NOW,
      });
      await db.execute(
        `update learning_goal set status = 'archived' where user_id = '${userId}'`,
      );

      expect(await goalsFor(db, userId)).toEqual([]);
    });

    /** There is no honest row to draw for a course nobody can name. */
    it("drops a course whose pack has left the build", async () => {
      const userId = await newUser();
      await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec({ domain: "a-pack-that-was-deleted" }),
        mastery: [],
        now: NOW,
      });

      // The goal row is readable — its pack is still joined — but the pack
      // behind the *spec* is gone, so there is no name for it.
      expect(await goalsFor(db, userId)).toHaveLength(1);
      expect(await coursesFor(db, userId)).toEqual([]);
    });
  });

  /**
   * §4.2 law 1 at course scale. `markAchievedIfComplete` runs after every marked
   * hand-in, and the overwhelmingly common answer is "not yet".
   */
  describe("finishing a course", () => {
    it("does not finish one with work still to prove", async () => {
      const userId = await newUser();
      await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [],
        now: NOW,
      });

      expect(await markAchievedIfComplete(db, userId, pack, NOW)).toBe(false);
      expect((await goalsFor(db, userId))[0]?.status).toBe("active");
    });

    it("does not finish a course that is not the one running", async () => {
      const userId = await newUser();
      const goalId = await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: [],
        now: NOW,
      });
      await setGoalStatus(db, userId, goalId, "paused");

      expect(await markAchievedIfComplete(db, userId, pack, NOW)).toBe(false);
    });

    it("does nothing at all for a learner with no course running", async () => {
      expect(
        await markAchievedIfComplete(db, await newUser(), pack, NOW),
      ).toBe(false);
    });

    /**
     * The one that matters, and the one the first draft of this got wrong.
     *
     * Mastery above the bar on every skill empties `requiredSkillIds` — which
     * is what a learner who aced the diagnostic looks like too. Nothing has
     * been handed in, so nothing is claimed, so the course is not finished.
     * §4.2 law 1: answers are not evidence.
     */
    it("does not finish a course nothing has been handed in on", async () => {
      const userId = await newUser();
      await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: pack.skills.map((s) => state(s.slug, { mastery: 0.99 })),
        now: NOW,
      });

      expect(await markAchievedIfComplete(db, userId, pack, NOW)).toBe(false);
      expect((await goalsFor(db, userId))[0]?.status).toBe("active");
    });

    it("finishes a course once every skill on it has marked work behind it", async () => {
      const userId = await newUser();
      const goalId = await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: pack.skills.map((s) => state(s.slug, { mastery: 0.99 })),
        now: NOW,
      });

      // The evidence the ledger insists on: a marked hand-in per skill. The
      // claim is what makes this different from the test above, which has
      // identical mastery and no artefacts.
      await proveEverySkill(userId);

      expect(await markAchievedIfComplete(db, userId, pack, NOW)).toBe(true);
      expect((await goalsFor(db, userId))[0]?.status).toBe("achieved");
      // Finishing takes it out of the running, so `/today` stops planning it.
      expect(await activeGoal(db, userId)).toBeUndefined();
      void goalId;
    });

    /**
     * Recorded rather than derived. Derived from `effectiveMastery`, a course
     * finished in March and untouched until June would quietly un-finish
     * itself — decay is honest about what a claim is worth today, not a claim
     * that the work was never done.
     */
    it("stays finished once it is", async () => {
      const userId = await newUser();
      await createGoal(db, {
        userId,
        packSlug: PACK,
        spec: spec(),
        mastery: pack.skills.map((s) => state(s.slug, { mastery: 0.99 })),
        now: NOW,
      });
      await proveEverySkill(userId);
      await markAchievedIfComplete(db, userId, pack, NOW);

      // A year later, every claim long since decayed below the bar.
      const later = new Date("2027-08-13T09:00:00.000Z");
      expect(await markAchievedIfComplete(db, userId, pack, later)).toBe(false);
      expect((await goalsFor(db, userId))[0]?.status).toBe("achieved");
    });
  });

});
