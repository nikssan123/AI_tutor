import { and, count, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { domainPack, learningGoal, packBuild } from "@/db/schema";
import { packFromDb } from "@/lib/packs/read";
import { validatePack, type ValidationReport } from "@/lib/packs/validate";
import type { BuildStatus } from "@/lib/packs/build";
import type { DomainPack } from "@/lib/packs/types";

/**
 * §7.1's review queue — the packs nobody has read yet.
 *
 * `/admin/packs` reads the curated packs off disk, which is right for them: they
 * are files in git and their review happens in a diff. A Generated pack has no
 * diff to review, so this is the only surface where anyone ever sees one.
 *
 * The queue is also the promotion gate. §7.1 says a Generated pack is "promoted
 * to Standard after 5 users + quality gate", and both halves are enforced here
 * rather than left to whoever clicks the button.
 */

/** §7.1 — "promoted to Standard after 5 users + quality gate". */
export const PROMOTION_MIN_LEARNERS = 5;

export interface GeneratedPackSummary {
  pack: DomainPack;
  report: ValidationReport;
  /** How many learners have a goal against it. Drives the promotion gate. */
  learners: number;
  /** The build that produced it, when the row is still around. */
  build: { status: BuildStatus; detail: string | null } | undefined;
  /** Whether §7.1's two conditions are both met right now. */
  promotable: boolean;
  /** Why not, when it is not. Empty when it is. */
  blockers: string[];
}

function statusOf(value: string): BuildStatus {
  return value === "ready" || value === "failed" ? value : "building";
}

/**
 * Every pack that lives only in the database, with what a reviewer needs.
 *
 * Read one at a time through `packFromDb` rather than with a join, because a
 * reviewer has to see the same object the engine sees — a summary assembled
 * differently here could look fine while the pack the planner gets is broken.
 */
export async function generatedPacks(db: Db): Promise<GeneratedPackSummary[]> {
  const rows = await db
    .select({ slug: domainPack.slug, id: domainPack.id })
    .from(domainPack)
    .where(eq(domainPack.maturity, "generated"));

  const summaries: GeneratedPackSummary[] = [];

  for (const row of rows) {
    const pack = await packFromDb(db, row.slug);
    if (!pack) continue;

    const [learnerRow] = await db
      .select({ n: count() })
      .from(learningGoal)
      .where(
        and(
          eq(learningGoal.packId, row.id),
          eq(learningGoal.status, "active"),
        ),
      );

    const [buildRow] = await db
      .select()
      .from(packBuild)
      .where(eq(packBuild.slug, row.slug))
      .limit(1);

    const report = validatePack(pack);
    const learners = Number(learnerRow!.n);

    const blockers: string[] = [];
    if (learners < PROMOTION_MIN_LEARNERS) {
      blockers.push(
        `${learners} of ${PROMOTION_MIN_LEARNERS} learners — not enough use to judge it yet`,
      );
    }
    if (!report.passed) {
      blockers.push("it does not pass validation");
    }

    summaries.push({
      pack,
      report,
      learners,
      build: buildRow
        ? { status: statusOf(buildRow.status), detail: buildRow.detail }
        : undefined,
      promotable: blockers.length === 0,
      blockers,
    });
  }

  return summaries.sort((a, b) => b.learners - a.learners);
}

export type PromotionOutcome =
  | { kind: "promoted" }
  | { kind: "refused"; blockers: string[] };

/**
 * Moves a Generated pack to Standard.
 *
 * The gate is re-checked here rather than trusted from the page that rendered
 * the button: the numbers can change between a reviewer loading the queue and
 * clicking, and "Standard" is a claim about the pack that the product then makes
 * to learners. It is the reviewer's name that goes on it, so it is recorded.
 */
export async function promotePack(
  db: Db,
  slug: string,
  reviewer: string,
  now: Date = new Date(),
): Promise<PromotionOutcome> {
  const summary = (await generatedPacks(db)).find((s) => s.pack.slug === slug);

  if (!summary) return { kind: "refused", blockers: ["no such generated pack"] };
  if (!summary.promotable) {
    return { kind: "refused", blockers: summary.blockers };
  }

  await db
    .update(domainPack)
    .set({
      maturity: "standard",
      qualityStatus: "reviewed",
      reviewedBy: reviewer,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(domainPack.slug, slug));

  return { kind: "promoted" };
}

/**
 * Deletes a generated pack outright.
 *
 * The other half of a review queue: some packs are not worth promoting and
 * leaving them in place means learners keep being offered them. Cascades to the
 * skills, items, rubrics and projects; a learner with a goal against it is
 * protected by the foreign key, which is deliberate — removing a course out
 * from under someone mid-plan is not a review decision.
 */
export async function discardPack(db: Db, slug: string): Promise<boolean> {
  const summary = (await generatedPacks(db)).find((s) => s.pack.slug === slug);
  if (!summary || summary.learners > 0) return false;

  await db.delete(domainPack).where(eq(domainPack.slug, slug));
  await db.delete(packBuild).where(eq(packBuild.slug, slug));
  return true;
}
