import { afterAll, describe, expect, it } from "vitest";
import { eq, ne } from "drizzle-orm";
import { join } from "node:path";
import { createClient } from "@/db";
import {
  assessmentItem,
  domainPack,
  project,
  skill,
  skillDependency,
} from "@/db/schema";
import { loadPack } from "@/lib/packs/loader";
import { seedPack, seedPacks } from "@/lib/packs/seed";
import { PackValidationError } from "@/lib/packs/validate";
import { deterministicUuid, packId, skillId } from "@/lib/packs/ids";
import { toRows } from "@/lib/packs/rows";

const FIXTURES = "tests/fixtures/packs";
const fixture = (name: string) => loadPack(join(FIXTURES, name));

describe("deterministic ids", () => {
  it("produces a valid RFC 4122 version 5 UUID", () => {
    const id = deterministicUuid("anything");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("is stable across runs, which is what makes seeding idempotent", () => {
    expect(deterministicUuid("x")).toBe(deterministicUuid("x"));
    expect(packId("sql-data-analysis")).toBe(packId("sql-data-analysis"));
  });

  it("separates namespaces so a skill and an item never collide", () => {
    expect(skillId("p", "same")).not.toBe(packId("same"));
    expect(deterministicUuid("a")).not.toBe(deterministicUuid("b"));
  });

  it("scopes skill ids by pack", () => {
    expect(skillId("pack-a", "joins")).not.toBe(skillId("pack-b", "joins"));
  });
});

describe("toRows", () => {
  const pack = fixture("valid-minimal");
  const rows = toRows(pack);

  it("resolves every slug reference to a deterministic id", () => {
    expect(rows.dependencies[0]).toEqual({
      fromSkillId: skillId("valid-minimal", "alpha"),
      toSkillId: skillId("valid-minimal", "beta"),
      type: "hard",
      strength: 1,
    });
    expect(rows.items[0]!.skillId).toBe(skillId("valid-minimal", "alpha"));
    expect(rows.projects[0]!.targetSkillIds).toEqual([
      skillId("valid-minimal", "alpha"),
      skillId("valid-minimal", "beta"),
    ]);
  });

  it("carries `area` through, because the planner scores on it", () => {
    expect(rows.skills[0]!.area).toBe("basics");
  });

  it("normalises absent optional fields to null", () => {
    const shortText = rows.items.find((i) => i.type === "short_text")!;
    expect(shortText.options).toBeNull();
    expect(rows.pack.reviewedAt).toBeNull();
    expect(rows.pack.qualityScore).toBeNull();
  });

  it("parses a review timestamp when one is present", () => {
    const reviewed = fixture("valid-minimal");
    reviewed.quality.reviewedAt = "2026-08-12T00:00:00.000Z";
    expect(toRows(reviewed).pack.reviewedAt).toEqual(
      new Date("2026-08-12T00:00:00.000Z"),
    );
  });
});

/**
 * Integration tests against the local Postgres. Skipped when DATABASE_URL is
 * absent so the suite still passes with Docker down.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("seedPack (integration)", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  afterAll(() => close());

  it("refuses to write an invalid pack", async () => {
    // Validation runs before any write — a cycle in the database would be a
    // production defect, not a build one.
    await expect(seedPack(db, fixture("cyclic"))).rejects.toBeInstanceOf(
      PackValidationError,
    );

    const rows = await db
      .select()
      .from(domainPack)
      .where(eq(domainPack.slug, "cyclic"));
    expect(rows).toEqual([]);
  });

  it("seeds the real SQL pack", async () => {
    const result = await seedPack(db, loadPack("packs/sql-data-analysis"));
    expect(result.skills).toBeGreaterThanOrEqual(25);

    const [row] = await db
      .select()
      .from(domainPack)
      .where(eq(domainPack.slug, "sql-data-analysis"));
    expect(row?.maturity).toBe("curated");
    expect(row?.workspace).toBe("query-sheet");
  });

  it("is idempotent — re-seeding does not duplicate anything", async () => {
    const pack = loadPack("packs/sql-data-analysis");
    const id = packId(pack.slug);

    await seedPack(db, pack);
    const first = {
      skills: (await db.select().from(skill).where(eq(skill.packId, id))).length,
      items: (
        await db
          .select()
          .from(assessmentItem)
          .where(eq(assessmentItem.packId, id))
      ).length,
      projects: (await db.select().from(project).where(eq(project.packId, id)))
        .length,
    };

    await seedPack(db, pack);
    const second = {
      skills: (await db.select().from(skill).where(eq(skill.packId, id))).length,
      items: (
        await db
          .select()
          .from(assessmentItem)
          .where(eq(assessmentItem.packId, id))
      ).length,
      projects: (await db.select().from(project).where(eq(project.packId, id)))
        .length,
    };

    expect(second).toEqual(first);
  });

  it("preserves calibration counters across a re-seed", async () => {
    // §21 — timesServed/timesCorrect are the accumulating asset. Re-seeding the
    // pack must never reset them, or every deploy would erase the moat.
    const pack = loadPack("packs/sql-data-analysis");
    const targetId = (
      await db
        .select()
        .from(assessmentItem)
        .where(eq(assessmentItem.packId, packId(pack.slug)))
    )[0]!.id;

    await db
      .update(assessmentItem)
      .set({ timesServed: 137, timesCorrect: 91 })
      .where(eq(assessmentItem.id, targetId));

    await seedPack(db, pack);

    const [after] = await db
      .select()
      .from(assessmentItem)
      .where(eq(assessmentItem.id, targetId));
    expect(after?.timesServed).toBe(137);
    expect(after?.timesCorrect).toBe(91);
  });

  it("removes an edge that was deleted from the pack file", async () => {
    const pack = loadPack("packs/sql-data-analysis");
    const trimmed = { ...pack, dependencies: pack.dependencies.slice(0, 5) };

    await seedPack(db, trimmed);
    const ids = new Set(
      (await db.select().from(skill).where(eq(skill.packId, packId(pack.slug))))
        .map((s) => s.id),
    );
    const edges = (await db.select().from(skillDependency)).filter((e) =>
      ids.has(e.fromSkillId),
    );
    expect(edges).toHaveLength(5);

    // Restore the full pack so later runs and the dev database stay correct.
    await seedPack(db, pack);
  });

  it("seeds several packs in one call", async () => {
    const results = await seedPacks(db, [fixture("valid-minimal")]);
    expect(results).toHaveLength(1);
    expect(results[0]!.packSlug).toBe("valid-minimal");
  });

});

live("seeding a pack with no dependencies", () => {
  const { db, close } = createClient(DATABASE_URL!, 1);

  afterAll(async () => {
    // These tests share a database with local development, so any fixture pack
    // that survives shows up at /admin/packs and in every listing query.
    await db.delete(domainPack).where(ne(domainPack.slug, "sql-data-analysis"));
    await close();
  });

  it("handles a pack whose skills have no edges between them", async () => {
    // A Generated pack legitimately starts life as a flat list of skills.
    const flat = { ...fixture("valid-minimal"), dependencies: [] };
    const result = await seedPack(db, flat);
    expect(result.dependencies).toBe(0);
  });
});
