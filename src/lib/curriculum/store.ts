import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { curriculum, curriculumModule } from "@/db/schema";
import { rubricId as packRubricId } from "@/lib/packs/ids";
import {
  CurriculumModule,
  type CurriculumDraft,
  type ValidatorReport,
} from "@/lib/contracts/curriculum";
import type { CurriculumSource } from "./generate";

/**
 * Persistence for a validated curriculum.
 *
 * §14.4 — "the curriculum is a cached projection of the plan, never the source
 * of truth." So this stores a *version* rather than overwriting: the previous
 * curriculum is marked superseded, not deleted, because a learner three weeks
 * in is entitled to see what changed and when.
 */

export interface StoredCurriculum {
  id: string;
  goalId: string;
  version: number;
  status: string;
  generatedAt: Date;
  report: ValidatorReport | null;
  modules: CurriculumDraft["modules"];
}

export interface SaveInput {
  goalId: string;
  packSlug: string;
  draft: CurriculumDraft;
  report: ValidatorReport | null;
  source: CurriculumSource;
  now: Date;
}

/**
 * The status a curriculum is stored under.
 *
 * A canonical fallback is stored `validated` rather than `active`: it is a real
 * curriculum and the learner can work from it, but it is the path we landed on
 * after the tailored one failed twice, and flattening that distinction would
 * lose the signal §14.9.5 asks to be logged for pack improvement.
 */
export function statusFor(source: CurriculumSource): string {
  return source === "canonical" ? "validated" : "active";
}

export async function saveCurriculum(
  db: Db,
  input: SaveInput,
): Promise<string> {
  const id = crypto.randomUUID();

  await db.transaction(async (tx) => {
    const previous = await tx
      .select({ version: curriculum.version })
      .from(curriculum)
      .where(eq(curriculum.goalId, input.goalId))
      .orderBy(desc(curriculum.version))
      .limit(1);

    // Supersede rather than delete: §14.4's "cached projection" is allowed to
    // change, and the history of how it changed is the interesting part.
    await tx
      .update(curriculum)
      .set({ status: "superseded" })
      .where(
        and(
          eq(curriculum.goalId, input.goalId),
          eq(curriculum.status, "active"),
        ),
      );

    await tx.insert(curriculum).values({
      id,
      goalId: input.goalId,
      version: (previous[0]?.version ?? 0) + 1,
      generatedAt: input.now,
      validatorReport: input.report,
      status: statusFor(input.source),
    });

    for (const mod of input.draft.modules) {
      await tx.insert(curriculumModule).values({
        curriculumId: id,
        order: mod.order,
        title: mod.title,
        targetSkillIds: mod.targetSkillIds,
        estimatedHours: mod.estimatedHours,
        outputArtifactType: mod.outputArtifact,
        acceptanceCriteria: mod.acceptanceCriteria,
        // The draft names a pack rubric by slug; the column is a UUID. Same
        // slug-to-uuid seam as the mastery store, resolved in one place.
        rubricId:
          mod.rubricId === null
            ? null
            : packRubricId(input.packSlug, mod.rubricId),
      });
    }
  });

  return id;
}

/** The curriculum `/goals/[id]/path` renders — newest non-superseded version. */
export async function currentCurriculum(
  db: Db,
  goalId: string,
): Promise<StoredCurriculum | undefined> {
  const rows = await db
    .select()
    .from(curriculum)
    .where(eq(curriculum.goalId, goalId))
    .orderBy(desc(curriculum.version))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  const modules = await db
    .select()
    .from(curriculumModule)
    .where(eq(curriculumModule.curriculumId, row.id))
    .orderBy(curriculumModule.order);

  return {
    id: row.id,
    goalId: row.goalId,
    version: row.version,
    status: row.status,
    generatedAt: row.generatedAt,
    // A report written by an older shape of the contract is shown as absent
    // rather than crashing the page it is meant to explain.
    report: parseReport(row.validatorReport),
    modules: modules.flatMap((m) => {
      const parsed = CurriculumModule.safeParse({
        order: m.order,
        title: m.title,
        targetSkillIds: m.targetSkillIds,
        estimatedHours: m.estimatedHours,
        outputArtifact: m.outputArtifactType,
        acceptanceCriteria: m.acceptanceCriteria ?? [],
        rubricId: m.rubricId,
      });
      return parsed.success ? [parsed.data] : [];
    }),
  };
}

function parseReport(raw: unknown): ValidatorReport | null {
  // Nullable column, so drizzle yields null and never undefined.
  if (raw === null) return null;
  const parsed = (raw as { checks?: unknown; passed?: unknown });
  return Array.isArray(parsed.checks) && typeof parsed.passed === "boolean"
    ? (raw as ValidatorReport)
    : null;
}
