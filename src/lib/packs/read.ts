import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import {
  assessmentItem,
  domainPack,
  packResource,
  project,
  rubric,
  skill,
  skillDependency,
} from "@/db/schema";
import { DomainPackSchema, ReviewKind, type DomainPack } from "./types";

/**
 * Reads a pack back out of the database — the inverse of `toRows`.
 *
 * This is what makes §7.1's Generated tier possible at all. Packs authored on
 * demand cannot be written to `packs/`: the production filesystem is read-only,
 * and a file written by one instance would not exist on the next. So a generated
 * pack lives in the tables `seedPack` already writes, and this is the only way
 * back out of them.
 *
 * **The contract is that a pack read from here is indistinguishable from one
 * read off disk.** Both paths end at `DomainPackSchema.safeParse`, and the
 * round-trip test in `tests/packs/read.test.ts` asserts the equality directly,
 * because the moment the two diverge the engine starts behaving differently for
 * generated packs in ways nobody would think to look for.
 *
 * The database keys on UUID and packs reference each other by slug (see
 * `ids.ts`), so every read here is also a translation back into slug space.
 * `store.ts` already does this for mastery; this does it for the pack itself.
 */

/**
 * Rebuilds `pack.quality` from the five columns that carry it.
 *
 * `reviewKind` is parsed rather than cast: the column is `text`, so a row
 * carrying anything but `human` or `model` is a row we do not understand, and
 * the safe reading of an unrecognised reviewer is that there isn't one. Casting
 * would let a typo written straight into the database open the index gate.
 */
function qualityOf(row: {
  qualityStatus: string;
  reviewedBy: string | null;
  reviewKind: string | null;
  reviewedAt: Date | null;
  qualityScore: number | null;
}) {
  const kind = ReviewKind.safeParse(row.reviewKind);
  const reviewKind = kind.success ? kind.data : null;
  return {
    status: row.qualityStatus,
    // Both halves travel together — `PackQuality` refuses a pack where only one
    // is set, so an unreadable kind drops the name with it.
    reviewedBy: reviewKind === null ? null : row.reviewedBy,
    reviewKind,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    score: row.qualityScore,
  };
}

export async function packFromDb(
  db: Db,
  slug: string,
): Promise<DomainPack | undefined> {
  const [packRow] = await db
    .select()
    .from(domainPack)
    .where(eq(domainPack.slug, slug))
    .limit(1);

  if (!packRow) return undefined;

  const [skillRows, itemRows, rubricRows, projectRows, resourceRows] =
    await Promise.all([
      db.select().from(skill).where(eq(skill.packId, packRow.id)),
      db
        .select()
        .from(assessmentItem)
        .where(eq(assessmentItem.packId, packRow.id)),
      db.select().from(rubric).where(eq(rubric.packId, packRow.id)),
      db.select().from(project).where(eq(project.packId, packRow.id)),
      db.select().from(packResource).where(eq(packResource.packId, packRow.id)),
    ]);

  // UUID → slug, for every reference the rows below carry.
  const skillSlug = new Map(skillRows.map((s) => [s.id, s.slug]));
  const rubricSlug = new Map(rubricRows.map((r) => [r.id, r.slug]));

  /*
   * `skill_dependency` has no pack column — it is scoped by the skills it
   * joins — so the edges are fetched by skill id rather than by pack. An empty
   * id list needs no guard: drizzle compiles `inArray(col, [])` to `false`.
   */
  const edgeRows = await db
    .select()
    .from(skillDependency)
    .where(
      inArray(
        skillDependency.fromSkillId,
        skillRows.map((s) => s.id),
      ),
    );

  const candidate = {
    slug: packRow.slug,
    name: packRow.name,
    taxonomyParent: packRow.taxonomyParent,
    maturity: packRow.maturity,
    evalTier: packRow.evalTier,
    workspace: packRow.workspace,
    version: packRow.version,
    evaluatorConfig: packRow.evaluatorConfig ?? {},
    quality: qualityOf(packRow),

    skills: skillRows
      .map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
        level: s.level,
        area: s.area,
        evalTier: s.evalTier,
        estimatedHours: s.estimatedHours,
        canDoStatement: s.canDoStatement,
        observableEvidence: s.observableEvidence,
        bktPriors: s.bktPriors,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),

    /*
     * An edge whose other end is outside this pack cannot be expressed in a
     * `DomainPack` — dependencies are pack-local slugs — so it is dropped
     * rather than guessed at. Seeding never creates one; this is the read side
     * refusing to invent a skill that is not in the pack it is returning.
     */
    dependencies: edgeRows
      .flatMap((e) => {
        const from = skillSlug.get(e.fromSkillId);
        const to = skillSlug.get(e.toSkillId);
        return from && to
          ? [{ from, to, type: e.type, strength: e.strength }]
          : [];
      })
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),

    items: itemRows
      .flatMap((i) => {
        const skillRef = skillSlug.get(i.skillId);
        if (!skillRef) return [];
        return [
          {
            slug: i.slug,
            skill: skillRef,
            type: i.type,
            difficulty: i.difficulty,
            discrimination: i.discrimination,
            prompt: i.prompt,
            // Rows written before the column existed default to prose, which
            // is what they were rendering as anyway.
            answerFormat: i.answerFormat === "code" ? "code" : "prose",
            // `options` is absent on every type but MCQ, and the validator
            // warns when a non-MCQ carries one. Null must come back as absent,
            // not as an empty array.
            ...(i.options === null ? {} : { options: i.options }),
            ...(i.answerKey === null ? {} : { answerKey: i.answerKey }),
          },
        ];
      })
      .sort((a, b) => a.slug.localeCompare(b.slug)),

    rubrics: rubricRows
      .map((r) => ({
        slug: r.slug,
        version: r.version,
        isPublic: r.isPublic,
        criteria: r.criteria,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),

    projects: projectRows
      .flatMap((p) => {
        const rubricRef = rubricSlug.get(p.rubricId);
        if (!rubricRef) return [];
        return [
          {
            slug: p.slug,
            title: p.title,
            brief: p.brief,
            rubric: rubricRef,
            evidence: p.evidence,
            difficulty: p.difficulty,
            estimatedMinutes: p.estimatedMinutes,
            isPublic: p.isPublic,
            targetSkills: (p.targetSkillIds as string[]).flatMap((id) => {
              const ref = skillSlug.get(id);
              return ref ? [ref] : [];
            }),
            acceptanceCriteria: p.acceptanceCriteria,
          },
        ];
      })
      .sort((a, b) => a.slug.localeCompare(b.slug)),

    /*
     * A resource whose every skill has left the pack is dropped, for the same
     * reason an orphaned dependency edge is: `PackResource.skills` needs at
     * least one pack-local slug, and inventing one to keep the row would be
     * citing a page against a skill nobody teaches. Skills that merely went
     * missing individually are pruned, which matches how assembly built it.
     */
    resources: resourceRows
      .flatMap((r) => {
        const skills = (r.skillIds as string[]).flatMap((id) => {
          const ref = skillSlug.get(id);
          return ref ? [ref] : [];
        });
        if (skills.length === 0) return [];
        return [
          {
            slug: r.slug,
            url: r.url,
            title: r.title,
            publisher: r.publisher,
            kind: r.kind,
            skills,
            assessment: r.assessment,
            publishedAt: r.publishedAt,
            checkedAt: r.checkedAt ? r.checkedAt.toISOString() : null,
            reachable: r.reachable,
          },
        ];
      })
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  };

  /*
   * A row set that no longer forms a valid pack is reported as absent rather
   * than thrown, matching how `activeGoal` treats a goal spec it cannot parse:
   * the caller's next move is "offer to set this up again", and a 500 removes
   * that option. The alternative — returning a half-pack — would put a skill
   * graph with missing edges into the planner.
   */
  const parsed = DomainPackSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
