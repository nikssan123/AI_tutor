import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createClient } from "@/db";
import { goalIntake, packBuild, user } from "@/db/schema";
import {
  BUILD_TIMEOUT_MINUTES,
  MAX_CONCURRENT_BUILDS_PER_USER,
  activeBuildsFor,
  buildInFlightFor,
  findBuild,
  finishBuild,
  startBuild,
} from "@/lib/packs/build";
import {
  EMPTY_INTAKE,
  clearIntake,
  loadIntake,
  saveIntake,
} from "@/lib/goals/intake-store";
import type { CapturedGoal } from "@/lib/goals/analyzer";

/**
 * The two rows that make on-demand pack building safe: the build claim, which
 * stops ten people asking for Rust from starting ten generations, and the
 * intake, which is the conversation between requests.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

const NOW = new Date("2026-08-13T12:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const IDS = ["build-test-user-1", "build-test-user-2"];

live("pack builds and intake", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);

  afterAll(async () => {
    await db.delete(user).where(inArray(user.id, IDS));
    await close();
  });

  beforeEach(async () => {
    await db.delete(packBuild).where(inArray(packBuild.requestedBy, IDS));
    for (const id of IDS) {
      await db
        .insert(user)
        .values({
          id,
          name: "Build tester",
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: NOW,
          updatedAt: NOW,
        })
        .onConflictDoNothing();
    }
  });

  describe("startBuild", () => {
    it("claims a slug nobody is building", async () => {
      const outcome = await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );
      expect(outcome.kind).toBe("started");

      const build = await findBuild(db, "rust-lang");
      expect(build).toMatchObject({ status: "building", subject: "Rust" });
    });

    it("joins a build already running instead of starting a second", async () => {
      /*
       * The whole economics of §7.1's Generated tier: a pack costs about $0.61
       * to author and is shared by everyone who asks for that subject, so ten
       * people asking for Rust must cause one generation, not ten.
       */
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );
      const second = await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[1]! },
        later(1),
      );

      expect(second.kind).toBe("already");
      // Still the first learner's build, and still only one of them.
      expect(second.kind === "already" && second.build.subject).toBe("Rust");
      expect(await activeBuildsFor(db, IDS[1]!, later(1))).toBe(0);
    });

    it("refuses a learner a second simultaneous build", async () => {
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );
      const second = await startBuild(
        db,
        { slug: "welding", subject: "Welding", userId: IDS[0]! },
        later(1),
      );

      expect(second.kind).toBe("rate-limited");
      expect(await findBuild(db, "welding")).toBeUndefined();
    });

    it("lets a build that has clearly died be retried", async () => {
      // A worker that fell over mid-run would otherwise wedge the slug in
      // "building" forever, with no way for the learner to ask again.
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );

      const retry = await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        later(BUILD_TIMEOUT_MINUTES + 1),
      );
      expect(retry.kind).toBe("started");
    });

    it("lets a failed build be retried straight away", async () => {
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );
      await finishBuild(db, "rust-lang", {
        status: "failed",
        detail: "not enough items",
      });

      const retry = await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        later(1),
      );
      expect(retry.kind).toBe("started");
      expect((await findBuild(db, "rust-lang"))!.status).toBe("building");
    });
  });

  describe("activeBuildsFor", () => {
    it("counts only live builds", async () => {
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );
      expect(await activeBuildsFor(db, IDS[0]!, later(1))).toBe(
        MAX_CONCURRENT_BUILDS_PER_USER,
      );

      // Finished builds do not count against the next one.
      await finishBuild(db, "rust-lang", { status: "ready" });
      expect(await activeBuildsFor(db, IDS[0]!, later(1))).toBe(0);
    });

    it("ignores a build old enough to be dead", async () => {
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );
      expect(
        await activeBuildsFor(db, IDS[0]!, later(BUILD_TIMEOUT_MINUTES + 1)),
      ).toBe(0);
    });
  });

  /**
   * The same rows, read as something to tell the learner rather than as a rate
   * limit. Every screen outside `/start` needs this: a learner who walks away
   * from the wait screen is still mid-course-creation, and `/today` used to
   * offer them a "Build it" button that fails.
   */
  describe("buildInFlightFor", () => {
    it("hands back the build they are waiting on, subject and all", async () => {
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );

      expect(await buildInFlightFor(db, IDS[0]!, later(1))).toMatchObject({
        slug: "rust-lang",
        subject: "Rust",
        status: "building",
      });
    });

    it("is nothing for a learner who asked for none", async () => {
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );

      expect(await buildInFlightFor(db, IDS[1]!, later(1))).toBeUndefined();
    });

    /**
     * The two ways a build stops being something to report. Finished is the
     * ordinary one; dead is the one that would otherwise leave a learner
     * staring at "we're writing your course" forever.
     */
    it("is nothing once the build has finished", async () => {
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );
      await finishBuild(db, "rust-lang", { status: "ready" });

      expect(await buildInFlightFor(db, IDS[0]!, later(1))).toBeUndefined();
    });

    it("is nothing once the build is old enough to be dead", async () => {
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );

      expect(
        await buildInFlightFor(db, IDS[0]!, later(BUILD_TIMEOUT_MINUTES + 1)),
      ).toBeUndefined();
    });
  });

  describe("finishBuild", () => {
    it("records a failure with something the learner can read", async () => {
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );
      await finishBuild(db, "rust-lang", {
        status: "failed",
        detail: "7 items; a diagnostic needs at least 24",
      });

      const build = await findBuild(db, "rust-lang");
      expect(build).toMatchObject({
        status: "failed",
        detail: "7 items; a diagnostic needs at least 24",
      });
    });

    it("clears the detail when a retry succeeds", async () => {
      await startBuild(
        db,
        { slug: "rust-lang", subject: "Rust", userId: IDS[0]! },
        NOW,
      );
      await finishBuild(db, "rust-lang", { status: "failed", detail: "thin" });
      await finishBuild(db, "rust-lang", { status: "ready" });

      expect((await findBuild(db, "rust-lang"))!.detail).toBeNull();
    });
  });

  describe("the intake row", () => {
    const captured: CapturedGoal = {
      subject: "Rust programming",
      matchedPack: null,
      outcomeType: "career",
      statedLevel: "none",
      weeklyHours: 4,
      deadline: "2027-03-01",
      motivation: "changing jobs",
      constraints: [],
      existingAssets: [],
      priorDomain: "none",
    };

    it("is empty for a learner who has not started", async () => {
      await clearIntake(db, IDS[0]!);
      expect(await loadIntake(db, IDS[0]!)).toEqual(EMPTY_INTAKE);
    });

    it("round-trips a conversation", async () => {
      await saveIntake(db, IDS[0]!, {
        messages: [
          { r: "a", t: "What do you want to learn?" },
          { r: "l", t: "Rust" },
        ],
        captured,
        chips: ["1-2 hrs", "3-5 hrs"],
        clarity: 0.7,
        done: false,
        // The course they arrived having chosen, which has to survive every
        // turn — it is what the goal is finally built on.
        packSlug: "photography",
      });

      const loaded = await loadIntake(db, IDS[0]!);
      expect(loaded.messages).toHaveLength(2);
      expect(loaded.captured).toEqual(captured);
      expect(loaded.chips).toEqual(["1-2 hrs", "3-5 hrs"]);
      expect(loaded.clarity).toBeCloseTo(0.7);
      expect(loaded.packSlug).toBe("photography");
    });

    it("replaces rather than accumulates, so starting over really does", async () => {
      await saveIntake(db, IDS[0]!, {
        messages: [{ r: "l", t: "first" }],
        captured,
        chips: [],
        clarity: 0.3,
        done: false,
        packSlug: "photography",
      });
      await saveIntake(db, IDS[0]!, {
        messages: [{ r: "l", t: "second" }],
        captured: undefined,
        chips: [],
        clarity: 0,
        done: false,
        packSlug: null,
      });

      const loaded = await loadIntake(db, IDS[0]!);
      expect(loaded.messages).toEqual([{ r: "l", t: "second" }]);
      expect(loaded.captured).toBeUndefined();
      // Including the course: starting over on a subject we do not run must
      // not leave the last conversation's pack behind to be built instead.
      expect(loaded.packSlug).toBeNull();
    });

    it("treats a stored value it cannot parse as no conversation", async () => {
      // Written by an older version, or by hand. The screen restarts rather
      // than rendering half a conversation.
      await saveIntake(db, IDS[0]!, {
        ...EMPTY_INTAKE,
        messages: [{ r: "l", t: "hi" }],
      });
      await db
        .update(goalIntake)
        .set({ messages: [{ nonsense: true }, 7], captured: { bad: 1 } })
        .where(eq(goalIntake.userId, IDS[0]!));

      const loaded = await loadIntake(db, IDS[0]!);
      expect(loaded.messages).toEqual([]);
      expect(loaded.captured).toBeUndefined();
    });

    it("treats messages stored as something other than a list as none", async () => {
      await saveIntake(db, IDS[0]!, EMPTY_INTAKE);
      await db
        .update(goalIntake)
        .set({ messages: "not a list at all" })
        .where(eq(goalIntake.userId, IDS[0]!));

      expect((await loadIntake(db, IDS[0]!)).messages).toEqual([]);
    });

    it("drops chips that are not strings", async () => {
      await saveIntake(db, IDS[0]!, EMPTY_INTAKE);
      await db
        .update(goalIntake)
        .set({ chips: ["keep", 7, null] })
        .where(eq(goalIntake.userId, IDS[0]!));

      expect((await loadIntake(db, IDS[0]!)).chips).toEqual(["keep"]);
    });

    it("handles chips stored as something other than a list", async () => {
      await saveIntake(db, IDS[0]!, EMPTY_INTAKE);
      await db
        .update(goalIntake)
        .set({ chips: "not a list" })
        .where(eq(goalIntake.userId, IDS[0]!));

      expect((await loadIntake(db, IDS[0]!)).chips).toEqual([]);
    });

    it("is cleared once it has produced a goal", async () => {
      await saveIntake(db, IDS[0]!, {
        ...EMPTY_INTAKE,
        messages: [{ r: "l", t: "done with this" }],
      });
      await clearIntake(db, IDS[0]!);
      expect(await loadIntake(db, IDS[0]!)).toEqual(EMPTY_INTAKE);
    });
  });
});
