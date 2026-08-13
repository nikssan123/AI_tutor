import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createClient } from "@/db";
import {
  domainPack,
  learningGoal,
  packBuild,
  skill,
  skillDependency,
  user,
} from "@/db/schema";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { packId, skillId } from "@/lib/packs/ids";
import {
  PROMOTION_MIN_LEARNERS,
  discardPack,
  generatedPacks,
  promotePack,
} from "@/lib/admin/generated";

/**
 * §7.1's review queue and its promotion gate.
 *
 * The gate is the interesting part: "Standard" is a claim the product then
 * makes to learners, so the conditions are enforced where the write happens
 * rather than by the page that renders the button.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

const SLUG = "generated-under-test";
const SECOND_SLUG = "generated-under-test-two";
const IDS = Array.from({ length: 6 }, (_, i) => `gen-review-user-${i}`);
const NOW = new Date("2026-08-13T12:00:00.000Z");

/** A real pack, relabelled as one built on request. */
function generatedFixture() {
  const base = loadPack("packs/photography");
  return { ...base, slug: SLUG, maturity: "generated" as const };
}

live("the generated pack review queue", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);

  /*
   * Goals first: `learning_goal.pack_id` has no cascade, which is the very
   * thing `discardPack` leans on to refuse pulling a course out from under
   * someone. The teardown has to respect it like anything else would.
   */
  async function clearFixture() {
    await db.delete(learningGoal).where(inArray(learningGoal.userId, IDS));
    await db
      .delete(domainPack)
      .where(inArray(domainPack.slug, [SLUG, SECOND_SLUG]));
  }

  afterAll(async () => {
    await clearFixture();
    await db.delete(user).where(inArray(user.id, IDS));
    await close();
  });

  beforeEach(async () => {
    await clearFixture();
    await db
      .delete(packBuild)
      .where(inArray(packBuild.slug, [SLUG, SECOND_SLUG]));
    for (const id of IDS) {
      await db
        .insert(user)
        .values({
          id,
          name: "Reviewer fixture",
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: NOW,
          updatedAt: NOW,
        })
        .onConflictDoNothing();
    }
    await seedPack(db, generatedFixture());
  });

  /** Gives the pack `n` learners with active goals. */
  async function withLearners(n: number) {
    for (const id of IDS.slice(0, n)) {
      await db.insert(learningGoal).values({
        userId: id,
        packId: packId(SLUG),
        rawGoalText: "learn it",
        status: "active",
      });
    }
  }

  it("lists a pack that lives only in the database", async () => {
    const queue = await generatedPacks(db);
    const entry = queue.find((e) => e.pack.slug === SLUG);

    expect(entry).toBeDefined();
    expect(entry!.pack.maturity).toBe("generated");
    expect(entry!.learners).toBe(0);
  });

  it("puts the most-used pack first, because it is closest to promotion", async () => {
    const second = { ...generatedFixture(), slug: SECOND_SLUG };
    await seedPack(db, second);
    await withLearners(2);

    const queue = (await generatedPacks(db)).filter((e) =>
      [SLUG, SECOND_SLUG].includes(e.pack.slug),
    );
    expect(queue.map((e) => e.pack.slug)).toEqual([SLUG, SECOND_SLUG]);
  });

  it("does not list curated packs, which are reviewed in a diff", async () => {
    const queue = await generatedPacks(db);
    expect(queue.some((e) => e.pack.slug === "sql-data-analysis")).toBe(false);
  });

  it("reports a build still running as building", async () => {
    await db.insert(packBuild).values({
      slug: SLUG,
      subject: "Photography",
      status: "building",
      detail: null,
      startedAt: NOW,
    });

    const entry = (await generatedPacks(db)).find((e) => e.pack.slug === SLUG)!;
    expect(entry.build).toMatchObject({ status: "building", detail: null });
  });

  it("skips a row that no longer forms a readable pack", async () => {
    // A pack whose skills are gone is not a thin pack, it is not a pack — and
    // a queue that renders it would crash on the first field it read.
    await db.delete(skill).where(eq(skill.packId, packId(SLUG)));

    expect((await generatedPacks(db)).some((e) => e.pack.slug === SLUG)).toBe(
      false,
    );
  });

  it("surfaces a failed build's reason next to the pack", async () => {
    await db.insert(packBuild).values({
      slug: SLUG,
      subject: "Photography",
      status: "failed",
      detail: "7 items; a diagnostic needs at least 24",
      startedAt: NOW,
    });

    const entry = (await generatedPacks(db)).find((e) => e.pack.slug === SLUG)!;
    expect(entry.build).toMatchObject({
      status: "failed",
      detail: "7 items; a diagnostic needs at least 24",
    });
  });

  describe("the promotion gate", () => {
    it("refuses a pack too few people have used", async () => {
      // §7.1 — "promoted to Standard after 5 users". One learner is not
      // evidence that a course is any good.
      await withLearners(PROMOTION_MIN_LEARNERS - 1);

      const entry = (await generatedPacks(db)).find((e) => e.pack.slug === SLUG)!;
      expect(entry.promotable).toBe(false);
      expect(entry.blockers.join(" ")).toContain("not enough use");

      const outcome = await promotePack(db, SLUG, "nixon@example.com");
      expect(outcome.kind).toBe("refused");
    });

    it("promotes one that has cleared both conditions", async () => {
      await withLearners(PROMOTION_MIN_LEARNERS);

      const outcome = await promotePack(db, SLUG, "nixon@example.com", NOW);
      expect(outcome).toEqual({ kind: "promoted" });

      const [row] = await db
        .select()
        .from(domainPack)
        .where(eq(domainPack.slug, SLUG));

      expect(row!.maturity).toBe("standard");
      expect(row!.qualityStatus).toBe("reviewed");
      // The reviewer's own name, because "reviewed by" is a claim about a person.
      expect(row!.reviewedBy).toBe("nixon@example.com");
      expect(row!.reviewedAt).toEqual(NOW);
    });

    it("re-checks the gate at the write rather than trusting the caller", async () => {
      /*
       * The numbers can move between a reviewer loading the queue and clicking,
       * and the button is not the thing that decides.
       */
      const outcome = await promotePack(db, SLUG, "nixon@example.com");
      expect(outcome.kind).toBe("refused");

      const [row] = await db
        .select()
        .from(domainPack)
        .where(eq(domainPack.slug, SLUG));
      expect(row!.maturity).toBe("generated");
    });

    it("refuses a pack that does not exist", async () => {
      const outcome = await promotePack(db, "no-such-pack", "nixon@example.com");
      expect(outcome).toEqual({
        kind: "refused",
        blockers: ["no such generated pack"],
      });
    });

    it("stops listing a pack once it is no longer generated", async () => {
      await withLearners(PROMOTION_MIN_LEARNERS);
      await promotePack(db, SLUG, "nixon@example.com");

      const queue = await generatedPacks(db);
      expect(queue.some((e) => e.pack.slug === SLUG)).toBe(false);
    });
  });

  it("blocks promotion of a pack that no longer validates", async () => {
    /*
     * Reachable after seeding: removing a rubric a project points at leaves the
     * pack well-formed enough to load and broken enough to fail. Learner count
     * alone must not be able to promote it.
     */
    await withLearners(PROMOTION_MIN_LEARNERS);

    // A reverse edge for one that already exists. Both ends resolve, so the
    // pack still reads back cleanly — and `detectCycle` blocks it.
    const [edge] = await db
      .select()
      .from(skillDependency)
      .where(eq(skillDependency.fromSkillId, skillId(SLUG, "exposure-triangle")))
      .limit(1);
    await db.insert(skillDependency).values({
      fromSkillId: edge!.toSkillId,
      toSkillId: edge!.fromSkillId,
      type: "hard",
      strength: 1,
    });

    const entry = (await generatedPacks(db)).find((e) => e.pack.slug === SLUG)!;
    expect(entry.promotable).toBe(false);
    expect(entry.blockers.join(" ")).toContain("does not pass validation");

    expect((await promotePack(db, SLUG, "nixon@example.com")).kind).toBe(
      "refused",
    );
  });

  describe("discarding", () => {
    it("removes a pack nobody is using", async () => {
      expect(await discardPack(db, SLUG)).toBe(true);
      expect((await generatedPacks(db)).some((e) => e.pack.slug === SLUG)).toBe(
        false,
      );
    });

    it("refuses to pull a course out from under someone mid-plan", async () => {
      await withLearners(1);
      expect(await discardPack(db, SLUG)).toBe(false);
      expect((await generatedPacks(db)).some((e) => e.pack.slug === SLUG)).toBe(
        true,
      );
    });

    it("refuses a pack that does not exist", async () => {
      expect(await discardPack(db, "no-such-pack")).toBe(false);
    });
  });
});
