import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import {
  assessmentItem,
  domainPack,
  project,
  rubric,
  skill,
  skillDependency,
} from "@/db/schema";
import { toRows } from "./rows";
import { assertValid } from "./validate";
import type { DomainPack } from "./types";

/**
 * Idempotent pack seeding (§24 E2).
 *
 * Two properties matter here. It validates before it writes — an invalid pack
 * must never reach the database, because the planner reads the graph directly
 * and a cycle would be a production defect rather than a build one. And it is
 * idempotent, because deterministic ids (see ids.ts) mean re-seeding updates
 * rows in place rather than accumulating duplicates.
 */

export interface SeedResult {
  packSlug: string;
  skills: number;
  dependencies: number;
  items: number;
  rubrics: number;
  projects: number;
}

export async function seedPack(
  db: Db,
  pack: DomainPack,
): Promise<SeedResult> {
  assertValid(pack);
  const rows = toRows(pack);

  await db.transaction(async (tx) => {
    await tx
      .insert(domainPack)
      .values(rows.pack)
      .onConflictDoUpdate({
        target: domainPack.id,
        set: {
          slug: rows.pack.slug,
          name: rows.pack.name,
          taxonomyParent: rows.pack.taxonomyParent,
          maturity: rows.pack.maturity,
          evalTier: rows.pack.evalTier,
          workspace: rows.pack.workspace,
          version: rows.pack.version,
          evaluatorConfig: rows.pack.evaluatorConfig,
          qualityStatus: rows.pack.qualityStatus,
          qualityScore: rows.pack.qualityScore,
          reviewedBy: rows.pack.reviewedBy,
          reviewedAt: rows.pack.reviewedAt,
          updatedAt: new Date(),
        },
      });

    for (const row of rows.skills) {
      await tx
        .insert(skill)
        .values(row)
        .onConflictDoUpdate({ target: skill.id, set: row });
    }

    // Dependencies are replaced wholesale: an edge removed from the YAML must
    // disappear from the graph, and there is no id to update in place.
    const packSkillIds = new Set(rows.skills.map((s) => s.id));
    const existingEdges = await tx.select().from(skillDependency);
    for (const edge of existingEdges) {
      if (packSkillIds.has(edge.fromSkillId) || packSkillIds.has(edge.toSkillId)) {
        await tx
          .delete(skillDependency)
          .where(eq(skillDependency.fromSkillId, edge.fromSkillId));
      }
    }
    if (rows.dependencies.length > 0) {
      await tx.insert(skillDependency).values(rows.dependencies);
    }

    for (const row of rows.rubrics) {
      await tx
        .insert(rubric)
        .values(row)
        .onConflictDoUpdate({ target: rubric.id, set: row });
    }

    for (const row of rows.items) {
      await tx
        .insert(assessmentItem)
        .values(row)
        .onConflictDoUpdate({
          target: assessmentItem.id,
          // timesServed / timesCorrect are calibration data earned in
          // production (§21) — re-seeding the pack must never reset them.
          set: {
            packId: row.packId,
            skillId: row.skillId,
            slug: row.slug,
            type: row.type,
            prompt: row.prompt,
            options: row.options,
            answerKey: row.answerKey,
            difficulty: row.difficulty,
            discrimination: row.discrimination,
          },
        });
    }

    for (const row of rows.projects) {
      await tx
        .insert(project)
        .values(row)
        .onConflictDoUpdate({ target: project.id, set: row });
    }
  });

  return {
    packSlug: pack.slug,
    skills: rows.skills.length,
    dependencies: rows.dependencies.length,
    items: rows.items.length,
    rubrics: rows.rubrics.length,
    projects: rows.projects.length,
  };
}

export async function seedPacks(
  db: Db,
  packs: DomainPack[],
): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const pack of packs) {
    results.push(await seedPack(db, pack));
  }
  return results;
}
