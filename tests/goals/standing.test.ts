import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createClient } from "@/db";
import { packBuild, user } from "@/db/schema";
import { findPack } from "@/lib/content";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { createGoal, setGoalStatus } from "@/lib/goals/store";
import { saveIntake } from "@/lib/goals/intake-store";
import { startBuild } from "@/lib/packs/build";
import { standingFor } from "@/lib/goals/standing";
import type { GoalSpec } from "@/lib/contracts/goal";

/**
 * What the product knows about a learner with no course running — the fact
 * `/today` had and `/calendar`, `/mastery` and `/progress` did not, which is
 * how one screen could say "you were partway through creating a subject" while
 * the next said "you have nothing; pick something".
 *
 * Against the real database, because the whole point of it is the three rows it
 * reads. Skipped without DATABASE_URL — see AGENTS.md.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

const PACK = "sql-data-analysis";
const NOW = new Date("2026-08-13T09:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const spec = (): GoalSpec => ({
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
  priorDomain: "none",
  depth: "standard",
  clarity: 1,
});

live("what a learner has on", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  const pack = findPack(PACK)!;
  const users: string[] = [];

  async function newUser(): Promise<string> {
    const id = `standing-${crypto.randomUUID()}`;
    users.push(id);
    await db.insert(user).values({ id, name: "Test", email: `${id}@example.test` });
    return id;
  }

  beforeAll(async () => {
    // Only this pack: tests/packs/seed.test.ts clears every other one as its
    // cleanup and the files run in parallel.
    await seedPack(db, loadPack(`packs/${PACK}`));
  }, 60_000);

  afterAll(async () => {
    await db.delete(packBuild).where(inArray(packBuild.requestedBy, users));
    for (const id of users) await db.delete(user).where(eq(user.id, id));
    await close();
  });

  it("is empty for a learner who has done nothing at all", async () => {
    expect(await standingFor(db, await newUser(), NOW)).toEqual({
      building: undefined,
      resume: undefined,
      again: [],
    });
  });

  it("finds the conversation they walked away from", async () => {
    const userId = await newUser();
    await saveIntake(db, userId, {
      messages: [
        { r: "l", t: "I want to get better at spreadsheets" },
        { r: "a", t: "What do you use them for?" },
      ],
      captured: {
        subject: "Spreadsheets",
        matchedPack: null,
        outcomeType: null,
        statedLevel: null,
        weeklyHours: null,
        deadline: null,
        motivation: null,
        constraints: [],
        existingAssets: [],
        priorDomain: "none",
      },
      chips: [],
      clarity: 0.4,
      done: false,
    });

    const standing = await standingFor(db, userId, NOW);
    expect(standing.resume).toMatchObject({ subject: "Spreadsheets", turns: 1 });
  });

  it("finds the subject being written for them", async () => {
    const userId = await newUser();
    await startBuild(
      db,
      { slug: "kite-surfing", subject: "Kite surfing", userId },
      NOW,
    );

    const standing = await standingFor(db, userId, later(1));
    expect(standing.building).toMatchObject({
      slug: "kite-surfing",
      subject: "Kite surfing",
    });
  });

  /**
   * `pickUpAgain`'s rule, reaching the screens through here: a course put aside
   * is an offer, a finished one is not — it has no action on it, so offering it
   * would be offering a row that does nothing when tapped.
   */
  it("offers a course put aside, and not the running one", async () => {
    const userId = await newUser();
    const goalId = await createGoal(db, {
      userId,
      packSlug: PACK,
      spec: spec(),
      mastery: [],
      now: NOW,
    });

    expect((await standingFor(db, userId, NOW)).again).toEqual([]);

    await setGoalStatus(db, userId, goalId, "paused", later(1));
    expect((await standingFor(db, userId, later(2))).again).toEqual([
      {
        goalId,
        name: pack.name,
        taxonomyParent: pack.taxonomyParent,
        status: "paused",
      },
    ]);
  });
});
