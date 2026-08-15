import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createClient } from "@/db";
import { goalIntake, packBuild, user } from "@/db/schema";
import {
  BUILD_TIMEOUT_MINUTES,
  MAX_CONCURRENT_BUILDS_PER_USER,
  activeBuildsFor,
  buildInFlightFor,
  markBuildNotified,
  stoppedBuilds,
  buildsCommissionedBy,
  findBuild,
  finishBuild,
  markBuildStage,
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

  describe("markBuildStage", () => {
    /**
     * The wait screen's only evidence. Everything it shows a learner for three
     * minutes is read back out of this column, so what it can and cannot say is
     * decided here rather than on the screen.
     */
    it("starts with nothing, because a queued build has done nothing", async () => {
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });
      expect((await findBuild(db, "rust"))!.stage).toBeNull();
    });

    it("records the phase the run has reached", async () => {
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });
      await markBuildStage(db, "rust", "writing");

      expect((await findBuild(db, "rust"))!.stage).toBe("writing");
    });

    it("clears it when the subject is started again", async () => {
      // `startBuild` upserts, so without the reset a retry would open on three
      // finished steps it has not done again — and the first step it re-did
      // would read as progress going backwards.
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });
      await markBuildStage(db, "rust", "checking");
      await finishBuild(db, "rust", { status: "failed", detail: "thin" });
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });

      expect((await findBuild(db, "rust"))!.stage).toBeNull();
    });

    it("cannot move a build that has already finished", async () => {
      // The seed step and the ready mark are milliseconds apart. A stage
      // landing after the finish must not reopen a build the learner has
      // already been shown as done.
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });
      await finishBuild(db, "rust", { status: "ready" });
      await markBuildStage(db, "rust", "saving");

      const build = (await findBuild(db, "rust"))!;
      expect(build.status).toBe("ready");
      expect(build.stage).toBeNull();
    });

    it("reads a stage it does not recognise as no stage at all", async () => {
      // The column is `text`, so a row written by another deployment can hold a
      // word this version has never heard of. "Not started" is the only answer
      // that cannot make the screen claim progress it has no evidence for.
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });
      await db
        .update(packBuild)
        .set({ stage: "polishing" })
        .where(eq(packBuild.slug, "rust"));

      expect((await findBuild(db, "rust"))!.stage).toBeNull();
    });
  });

  describe("buildsCommissionedBy", () => {
    it("counts nothing for an account that has never asked", async () => {
      expect(await buildsCommissionedBy(db, IDS[0]!)).toBe(0);
    });

    it("counts one per subject, however many attempts it took", async () => {
      /*
       * The quota is one custom *subject*, not one attempt at one. `startBuild`
       * upserts on the slug, so retrying a failed build reuses its row — which
       * is what keeps the wait screen's "Try again" working for somebody whose
       * only free build went wrong.
       */
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });
      await finishBuild(db, "rust", { status: "failed", detail: "thin" });
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });

      expect(await buildsCommissionedBy(db, IDS[0]!)).toBe(1);
    });

    it("counts a second subject separately", async () => {
      // Finished first, because `MAX_CONCURRENT_BUILDS_PER_USER` is 1 — a
      // second subject is only reachable once the first is done, which is also
      // the only way a free account could ever have exceeded its quota.
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });
      await finishBuild(db, "rust", { status: "ready" });
      await startBuild(db, { slug: "welding", subject: "Welding", userId: IDS[0]! });

      expect(await buildsCommissionedBy(db, IDS[0]!)).toBe(2);
    });

    it("has no period filter — it is a lifetime number", async () => {
      // A monthly allowance compounds into twelve subjects a year from an
      // account that never pays. One, ever, bounds a free signup at one build.
      const longAgo = new Date("2024-01-01T00:00:00.000Z");
      await startBuild(
        db,
        { slug: "rust", subject: "Rust", userId: IDS[0]! },
        longAgo,
      );

      expect(await buildsCommissionedBy(db, IDS[0]!)).toBe(1);
    });

    it("counts each account's own", async () => {
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });

      expect(await buildsCommissionedBy(db, IDS[1]!)).toBe(0);
    });
  });


  describe("the operator's queue", () => {
    it("lists a failed build with what an operator needs", async () => {
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });
      await finishBuild(db, "rust", { status: "failed", detail: "too thin" });

      const stopped = await stoppedBuilds(db);
      const rust = stopped.find((b) => b.slug === "rust")!;

      expect(rust.subject).toBe("Rust");
      expect(rust.detail).toBe("too thin");
      // Who is waiting, which is what makes it somebody's job.
      expect(rust.requestedBy).toBe(IDS[0]!);
      expect(rust.stalled).toBe(false);
      // Nobody told yet — the notification is a separate fact from the failure.
      expect(rust.notifiedAt).toBeNull();
    });

    it("counts a run that outlived the timeout as stopped too", async () => {
      // It stopped without ever saying why, which needs a person just as much
      // as one that failed with a reason — and needs a different first move.
      const longAgo = new Date(Date.now() - (BUILD_TIMEOUT_MINUTES + 5) * 60_000);
      await startBuild(
        db,
        { slug: "welding", subject: "Welding", userId: IDS[0]! },
        longAgo,
      );

      const stalled = (await stoppedBuilds(db)).find((b) => b.slug === "welding");
      expect(stalled?.stalled).toBe(true);
      expect(stalled?.status).toBe("building");
    });

    it("leaves a run that is merely slow alone", async () => {
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });
      expect((await stoppedBuilds(db)).some((b) => b.slug === "rust")).toBe(false);
    });

    it("records that the team was told", async () => {
      /*
       * Two writes rather than one, because the build failing and the mail
       * going out can fail independently. A failed row with no `notifiedAt` is
       * a second failure — nobody knows — and `/admin/packs` can only show that
       * because it is written down separately.
       */
      await startBuild(db, { slug: "rust", subject: "Rust", userId: IDS[0]! });
      await finishBuild(db, "rust", { status: "failed", detail: "too thin" });
      await markBuildNotified(db, "rust", NOW);

      const rust = (await stoppedBuilds(db)).find((b) => b.slug === "rust")!;
      expect(rust.notifiedAt?.toISOString()).toBe(NOW.toISOString());
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
