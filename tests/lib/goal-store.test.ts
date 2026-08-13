import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClient } from "@/db";
import { learnerSkillMastery, user } from "@/db/schema";
import { findPack } from "@/lib/content";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { skillId } from "@/lib/packs/ids";
import {
  activeGoal,
  createGoal,
  DEFAULT_SESSION_MINUTES,
  masteryFor,
  sessionMinutesFor,
} from "@/lib/goals/store";
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
});
