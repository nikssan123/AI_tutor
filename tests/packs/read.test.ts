import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { createClient } from "@/db";
import {
  assessmentItem,
  domainPack,
  project,
  skill,
  skillDependency,
} from "@/db/schema";
import { loadPack, loadAllPacks } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { packFromDb } from "@/lib/packs/read";
import { itemId, projectId, rubricId, skillId } from "@/lib/packs/ids";
import type { DomainPack } from "@/lib/packs/types";

/**
 * The contract these tests defend: **a pack read out of the database is the
 * pack that was written into it.**
 *
 * Everything downstream — the planner, the diagnostic, the curriculum architect
 * — is handed a `DomainPack` and cannot tell which source it came from. If the
 * two paths ever diverge, generated packs quietly behave differently from disk
 * packs, and the symptom would appear somewhere far away from the cause.
 */

const FIXTURES = "tests/fixtures/packs";
const fixture = (name: string) => loadPack(join(FIXTURES, name));

/**
 * Both paths hold the same content; only the array order can differ, because
 * the disk path preserves the author's YAML order and the database path sorts
 * by slug for determinism. Ordering is not semantic — `selectNextItem` breaks
 * ties on slug rather than position — so the comparison is made order-free
 * rather than pretending the two orders should match.
 */
function canonical(pack: DomainPack): DomainPack {
  const by = <T>(key: (v: T) => string) => (a: T, b: T) =>
    key(a).localeCompare(key(b));

  return {
    ...pack,
    skills: [...pack.skills].sort(by((s) => s.slug)),
    dependencies: [...pack.dependencies].sort(
      by((d) => `${d.from}->${d.to}`),
    ),
    items: [...pack.items].sort(by((i) => i.slug)),
    rubrics: [...pack.rubrics].sort(by((r) => r.slug)),
    projects: [...pack.projects].sort(by((p) => p.slug)),
  };
}

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("packFromDb (integration)", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);

  afterAll(async () => {
    /*
     * Only the fixture packs this file created, not "everything but the SQL
     * pack". These tests share a database with local development *and* with
     * whatever else vitest is running in parallel, so a blanket delete is a
     * test reaching outside its own scope — which is how the shared-state bug
     * in pass 10 happened. A fixture left behind would show up at /admin/packs,
     * so it still has to go; it just goes by name.
     */
    await db.delete(domainPack).where(eq(domainPack.slug, "valid-minimal"));
    await close();
  });

  it("returns undefined for a pack that was never seeded", async () => {
    expect(await packFromDb(db, "no-such-pack")).toBeUndefined();
  });

  /*
   * The load-bearing test. Run against every real pack rather than a fixture,
   * because the fixtures are deliberately minimal and the shapes that break a
   * round trip — an item with no options, a null review timestamp, a project
   * pointing at a rubric — only all appear together in a real one.
   */
  it.each(loadAllPacks().map((p) => [p.slug, p] as const))(
    "round-trips %s byte for byte",
    async (_slug, onDisk) => {
      await seedPack(db, onDisk);
      const fromDb = await packFromDb(db, onDisk.slug);

      expect(fromDb).toBeDefined();
      expect(canonical(fromDb!)).toEqual(canonical(onDisk));
    },
  );

  it("preserves quality.status, which has its own column for this reason", async () => {
    const pack = { ...fixture("valid-minimal") };
    pack.quality = {
      status: "validated",
      reviewedBy: "nixon",
      reviewKind: "human",
      reviewedAt: "2026-08-13T00:00:00.000Z",
      score: 82,
    };

    await seedPack(db, pack);
    const fromDb = await packFromDb(db, pack.slug);

    expect(fromDb!.quality).toEqual({
      status: "validated",
      reviewedBy: "nixon",
      reviewKind: "human",
      reviewedAt: "2026-08-13T00:00:00.000Z",
      score: 82,
    });
  });

  /**
   * The column is `text`, so nothing at the database level stops a row saying
   * `reviewKind: "hand"`. An unrecognised reviewer is one we cannot vouch for,
   * and the safe reading is that there isn't one — otherwise a typo written
   * straight into the database opens the index gate that `PackQuality`'s enum
   * exists to keep shut.
   */
  it("drops a review kind the enum does not recognise, and the name with it", async () => {
    const pack = { ...fixture("valid-minimal") };
    pack.quality = {
      status: "validated",
      reviewedBy: "nixon",
      reviewKind: "human",
      reviewedAt: null,
      score: null,
    };
    await seedPack(db, pack);

    await db
      .update(domainPack)
      .set({ reviewKind: "hand" })
      .where(eq(domainPack.slug, pack.slug));

    const fromDb = await packFromDb(db, pack.slug);
    expect(fromDb!.quality.reviewKind).toBeNull();
    expect(fromDb!.quality.reviewedBy).toBeNull();
  });

  it("reads back a pack with no dependencies", async () => {
    // A Generated pack legitimately starts life as a flat list of skills.
    const flat = { ...fixture("valid-minimal"), dependencies: [] };
    await seedPack(db, flat);

    const fromDb = await packFromDb(db, flat.slug);
    expect(fromDb!.dependencies).toEqual([]);
    expect(fromDb!.skills.length).toBeGreaterThan(0);
  });

  it("omits `options` rather than returning null for a non-MCQ item", async () => {
    // The validator warns when a non-MCQ carries options, so a null column
    // coming back as `[]` or `null` would fail a pack that was fine on disk.
    const pack = fixture("valid-minimal");
    await seedPack(db, pack);

    const fromDb = await packFromDb(db, pack.slug);
    const shortText = fromDb!.items.find((i) => i.type === "short_text")!;
    expect(shortText).toBeDefined();
    expect("options" in shortText).toBe(false);
  });

  it("drops a dependency edge pointing outside the pack", async () => {
    /*
     * Not reachable through seeding — it is written here directly — but the
     * read path must not invent a skill slug it cannot resolve. The honest
     * outcome is a pack with one fewer edge, not a pack referencing a skill
     * that is not in it, which would fail validation downstream.
     */
    const pack = fixture("valid-minimal");
    // A real pack, because the FK needs a genuine second pack's skill and the
    // other fixtures are deliberately invalid.
    const other = loadPack("packs/business-writing");
    await seedPack(db, pack);
    await seedPack(db, other);

    const edgesBefore = (await packFromDb(db, pack.slug))!.dependencies.length;

    // An edge from this pack's skill to a skill belonging to a different pack.
    await db.insert(skillDependency).values({
      fromSkillId: skillId(pack.slug, pack.skills[0]!.slug),
      toSkillId: skillId(other.slug, other.skills[0]!.slug),
      type: "hard",
      strength: 1,
    });

    const fromDb = await packFromDb(db, pack.slug);
    expect(fromDb!.dependencies).toHaveLength(edgesBefore);
    expect(
      fromDb!.dependencies.every((d) =>
        pack.skills.some((s) => s.slug === d.to),
      ),
    ).toBe(true);
  });

  /*
   * The three drops below all exist because the schema's foreign keys point at
   * a row, not at a *pack*: `assessment_item.skill_id`, `project.rubric_id` and
   * the ids inside `project.target_skill_ids` can each reference something
   * outside the pack that owns them without violating a constraint. Seeding
   * never writes such a row, so each is set up here by hand — but "the seeder
   * would not do that" is not the same as "the database cannot hold it", and
   * the read path's job is to return a coherent pack either way.
   */

  it("drops an item whose skill belongs to another pack", async () => {
    const pack = fixture("valid-minimal");
    const other = loadPack("packs/business-writing");
    await seedPack(db, pack);
    await seedPack(db, other);

    const packRow = (
      await db.select().from(domainPack).where(eq(domainPack.slug, pack.slug))
    )[0]!;

    await db.insert(assessmentItem).values({
      id: itemId(pack.slug, "stray-item"),
      packId: packRow.id,
      skillId: skillId(other.slug, other.skills[0]!.slug),
      slug: "stray-item",
      type: "short_text",
      prompt: "An item whose skill lives in a different pack.",
      difficulty: 0.5,
      discrimination: 1,
    });

    const fromDb = await packFromDb(db, pack.slug);
    expect(fromDb!.items.some((i) => i.slug === "stray-item")).toBe(false);
  });

  it("drops a project whose rubric belongs to another pack", async () => {
    const pack = fixture("valid-minimal");
    const other = loadPack("packs/business-writing");
    await seedPack(db, pack);
    await seedPack(db, other);

    const packRow = (
      await db.select().from(domainPack).where(eq(domainPack.slug, pack.slug))
    )[0]!;

    await db.insert(project).values({
      id: projectId(pack.slug, "stray-project"),
      packId: packRow.id,
      slug: "stray-project",
      title: "Stray",
      brief: "A project pointing at a rubric that is not in this pack at all.",
      rubricId: rubricId(other.slug, other.rubrics[0]!.slug),
      evidenceType: "text",
      difficulty: 0.5,
      targetSkillIds: [skillId(pack.slug, pack.skills[0]!.slug)],
      acceptanceCriteria: ["something"],
      estimatedMinutes: 30,
      isPublic: false,
    });

    const fromDb = await packFromDb(db, pack.slug);
    expect(fromDb!.projects.some((p) => p.slug === "stray-project")).toBe(false);
  });

  it("reads a null evaluator config as an empty one", async () => {
    // `toRows` always writes an object, but the column is nullable and a pack
    // row predating that guarantee would come back with null. `evaluatorConfig`
    // is a required object on the schema, so null would fail the whole pack.
    const pack = fixture("valid-minimal");
    await seedPack(db, pack);
    await db
      .update(domainPack)
      .set({ evaluatorConfig: null })
      .where(eq(domainPack.slug, pack.slug));

    const fromDb = await packFromDb(db, pack.slug);
    expect(fromDb!.evaluatorConfig).toEqual({});
  });

  it("reports a row set that no longer forms a valid pack as absent", async () => {
    /*
     * A pack with no skills is not a thin pack, it is not a pack — the schema
     * requires at least one. Returning undefined sends the caller down the "set
     * this up again" path; returning the husk would put an empty skill graph
     * into the planner, which is the failure that would be hard to trace.
     */
    const pack = fixture("valid-minimal");
    await seedPack(db, pack);

    const packRow = (
      await db.select().from(domainPack).where(eq(domainPack.slug, pack.slug))
    )[0]!;
    await db.delete(skill).where(eq(skill.packId, packRow.id));

    expect(await packFromDb(db, pack.slug)).toBeUndefined();
  });

  it("drops a stale skill id from a project's target list", async () => {
    // `target_skill_ids` is jsonb, so nothing stops an id surviving there after
    // the skill it named is gone. The project is still usable; the dead id is
    // not, and naming a skill the pack does not contain would fail validation.
    const pack = fixture("valid-minimal");
    await seedPack(db, pack);

    const live = skillId(pack.slug, pack.skills[0]!.slug);
    await db
      .update(project)
      .set({ targetSkillIds: [live, skillId(pack.slug, "deleted-long-ago")] })
      .where(eq(project.id, projectId(pack.slug, pack.projects[0]!.slug)));

    const fromDb = await packFromDb(db, pack.slug);
    const target = fromDb!.projects.find(
      (p) => p.slug === pack.projects[0]!.slug,
    )!;
    expect(target.targetSkills).toEqual([pack.skills[0]!.slug]);
  });
});
