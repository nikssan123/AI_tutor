import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClient } from "@/db";
import { user } from "@/db/schema";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { createGoal } from "@/lib/goals/store";
import {
  claimPathBuild,
  finishPathBuild,
  findPathBuild,
  isRunning,
  isSkip,
  markPathBuildStage,
  outcomeDetail,
  PATH_BUILD_STAGES,
  PATH_BUILD_TIMEOUT_MINUTES,
} from "@/lib/curriculum/build-state";
import type { GoalSpec } from "@/lib/contracts/goal";

/**
 * The row that turned a silent button into a wait with steps.
 *
 * The build itself lives in `curriculum-build.test.ts`; what is asserted here
 * is the claim — one build per goal, whatever the learner does to the button —
 * and that a run which stopped, however it stopped, can be asked for again.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

const PACK = "sql-data-analysis";
const NOW = new Date("2026-08-16T09:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const spec: GoalSpec = {
  rawGoal: "learn sql",
  domain: PACK,
  targetOutcome: "SQL",
  outcomeType: "career",
  statedLevel: "beginner",
  weeklyHours: 4,
  deadline: null,
  motivation: "",
  constraints: [],
  existingAssets: [],
  priorDomain: "none",
  depth: "standard",
  clarity: 1,
};

describe("the outcome sentences", () => {
  it("calls the three known non-outcomes a skip", () => {
    for (const reason of ["nothing-to-teach", "not-active", "no-pack"]) {
      expect(isSkip(reason)).toBe(true);
      expect(outcomeDetail(reason).length).toBeGreaterThan(20);
    }
  });

  /**
   * The best possible news, and the one the wording has to get right: a learner
   * who has already proved everything their course covers has finished it, and
   * must not be told the machine broke.
   */
  it("tells somebody who has finished that they have finished", () => {
    expect(outcomeDetail("nothing-to-teach")).toMatch(/already proved/i);
  });

  it("treats anything it has not heard of as a failure with no reason", () => {
    expect(isSkip("the-worker-caught-fire")).toBe(false);
    expect(outcomeDetail("the-worker-caught-fire")).toMatch(/do not have a reason/i);
  });
});

describe("isRunning", () => {
  const row = (status: string, startedAt: Date) =>
    ({ goalId: "g", status, stage: null, detail: null, startedAt }) as never;

  it("is true only while a building row is inside the timeout", () => {
    expect(isRunning(row("building", NOW), later(1))).toBe(true);
    expect(
      isRunning(row("building", NOW), later(PATH_BUILD_TIMEOUT_MINUTES + 1)),
    ).toBe(false);
  });

  it("is false for every row that has finished", () => {
    for (const status of ["ready", "failed", "skipped"]) {
      expect(isRunning(row(status, NOW), later(1))).toBe(false);
    }
  });
});

live("the path build row", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const users: string[] = [];

  async function newGoal(): Promise<string> {
    const id = `test-${crypto.randomUUID()}`;
    users.push(id);
    await db.insert(user).values({ id, name: "T", email: `${id}@example.test` });
    return createGoal(db, {
      userId: id,
      packSlug: PACK,
      spec,
      mastery: [],
      now: NOW,
    });
  }

  beforeAll(async () => {
    await seedPack(db, loadPack(`packs/${PACK}`));
  }, 60_000);

  afterAll(async () => {
    for (const id of users) await db.delete(user).where(eq(user.id, id));
    await close();
  });

  it("claims a goal nobody is building, queued rather than started", async () => {
    const goalId = await newGoal();

    expect(await claimPathBuild(db, goalId, NOW)).toBe("claimed");

    const build = await findPathBuild(db, goalId);
    expect(build).toMatchObject({ status: "building", detail: null });
    // Null, not the first phase: a queued build has not started planning, and
    // saying it has is what makes the rest of the screen worth nothing.
    expect(build?.stage).toBeNull();
  });

  it("has nothing to report about a goal that never asked", async () => {
    expect(await findPathBuild(db, await newGoal())).toBeUndefined();
  });

  /**
   * The double press, and the second tab. The row is the lock, so both reach
   * the same run rather than starting two — which would both pay, and one of
   * which would supersede the other's curriculum for nothing.
   */
  it("joins a run already going instead of starting a second", async () => {
    const goalId = await newGoal();
    await claimPathBuild(db, goalId, NOW);
    await markPathBuildStage(db, goalId, "checking");

    expect(await claimPathBuild(db, goalId, later(1))).toBe("already-running");
    // Untouched: a second claim that reset the phase would walk the wait screen
    // backwards for no reason.
    expect((await findPathBuild(db, goalId))?.stage).toBe("checking");
  });

  it("lets a run that outlived the timeout be claimed again", async () => {
    const goalId = await newGoal();
    await claimPathBuild(db, goalId, NOW);
    await markPathBuildStage(db, goalId, "checking");

    expect(
      await claimPathBuild(db, goalId, later(PATH_BUILD_TIMEOUT_MINUTES + 1)),
    ).toBe("claimed");

    // Cleared, because this upserts: a retry that opened on the dead run's
    // finished steps would claim work it has not done again.
    const build = await findPathBuild(db, goalId);
    expect(build?.stage).toBeNull();
    expect(build?.detail).toBeNull();
  });

  it("lets a failure be tried again, with the old reason cleared", async () => {
    const goalId = await newGoal();
    await claimPathBuild(db, goalId, NOW);
    await finishPathBuild(db, goalId, {
      status: "failed",
      detail: "the queue was not there",
    });

    expect((await findPathBuild(db, goalId))?.detail).toBe(
      "the queue was not there",
    );
    expect(await claimPathBuild(db, goalId, later(1))).toBe("claimed");
    expect(await findPathBuild(db, goalId)).toMatchObject({
      status: "building",
      detail: null,
    });
  });

  it("records every phase the pipeline reaches", async () => {
    const goalId = await newGoal();
    await claimPathBuild(db, goalId, NOW);

    for (const stage of PATH_BUILD_STAGES) {
      await markPathBuildStage(db, goalId, stage);
      expect((await findPathBuild(db, goalId))?.stage).toBe(stage);
    }
  });

  /**
   * The last stage and the ready mark race by milliseconds, and a stage that
   * landed after the finish would reopen a run that is over — a wait screen
   * showing "putting your path together" about a path already on the page.
   */
  it("ignores a phase that arrives after the run has finished", async () => {
    const goalId = await newGoal();
    await claimPathBuild(db, goalId, NOW);
    await markPathBuildStage(db, goalId, "planning");
    await finishPathBuild(db, goalId, { status: "ready" });

    await markPathBuildStage(db, goalId, "saving");

    expect((await findPathBuild(db, goalId))?.stage).toBe("planning");
  });

  it("clears the reason when a build succeeds", async () => {
    const goalId = await newGoal();
    await claimPathBuild(db, goalId, NOW);
    await finishPathBuild(db, goalId, { status: "ready" });

    expect(await findPathBuild(db, goalId)).toMatchObject({
      status: "ready",
      detail: null,
    });
  });

  it("keeps the reason when there was nothing to build", async () => {
    const goalId = await newGoal();
    await claimPathBuild(db, goalId, NOW);
    await finishPathBuild(db, goalId, {
      status: "skipped",
      detail: outcomeDetail("nothing-to-teach"),
    });

    const build = await findPathBuild(db, goalId);
    expect(build?.status).toBe("skipped");
    expect(build?.detail).toMatch(/already proved/i);
  });

  /**
   * Both columns are `text`, so a row written by an older deployment can hold a
   * word this version has never heard of. A status it cannot describe reads as
   * failed — nobody should be told to keep waiting for a run we cannot name —
   * and a stage it cannot place reads as "not started", the one answer that
   * cannot claim progress there is no evidence for.
   */
  it("reads an unrecognisable row conservatively", async () => {
    const goalId = await newGoal();
    await claimPathBuild(db, goalId, NOW);
    await db.execute(
      `update curriculum_build set status = 'reticulating', stage = 'splines' where goal_id = '${goalId}'`,
    );

    expect(await findPathBuild(db, goalId)).toMatchObject({
      status: "failed",
      stage: null,
    });
  });
});
