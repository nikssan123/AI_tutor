import { z } from "zod";

/**
 * §14.9.2 step contracts 4 and 5 — `CurriculumDraft` and `ValidatorReport`.
 *
 * The draft is what the Curriculum Architect (Sonnet 5) is asked to produce.
 * The report is what the validator says about it, and §14.6 is unambiguous that
 * the validator is the gate: "runs on every generated curriculum before the
 * learner sees it. Fails closed."
 *
 * §14.4's framing matters for reading both: "the curriculum is a cached
 * projection of the plan, never the source of truth." The source of truth is
 * (skill graph × mastery × constraints), which is why the planner can disagree
 * with the curriculum tomorrow without either being wrong.
 */

export const OutputArtifact = z.enum([
  "none",
  "exercise",
  "project",
  "recording",
  "document",
  "media",
]);
export type OutputArtifact = z.infer<typeof OutputArtifact>;

export const CurriculumModule = z.object({
  order: z.number().int().min(0),
  title: z.string().min(1).max(200),
  /** §14.4 — 1–3 skills per module. More than three is not a module, it's a term. */
  targetSkillIds: z.array(z.string()).min(1).max(3),
  estimatedHours: z.number().min(0),
  outputArtifact: OutputArtifact,
  acceptanceCriteria: z.array(z.string()),
  rubricId: z.string().nullable(),
});
export type CurriculumModule = z.infer<typeof CurriculumModule>;

export const CurriculumDraft = z.object({
  modules: z.array(CurriculumModule).min(3).max(40),
  totalHours: z.number().min(0),
  rationale: z.string(),
});
export type CurriculumDraft = z.infer<typeof CurriculumDraft>;

/** §14.6 — the nine checks, named exactly as the plan names them. */
export const CheckName = z.enum([
  "prereq_completeness",
  "no_hallucinated_skills",
  "no_redundancy",
  "length_sanity",
  "difficulty_ramp",
  "no_already_mastered",
  "resource_freshness",
  "rubric_coverage",
  "factual_spotcheck",
]);
export type CheckName = z.infer<typeof CheckName>;

/**
 * All nine names, in the plan's order. Exported so the report can assert it
 * carries every check rather than however many happened to run — §24 E6's
 * acceptance criterion is "all nine checks run **and are reported**", and a
 * check that silently stopped running is exactly the failure that criterion
 * exists to catch.
 */
export const ALL_CHECKS = CheckName.options;

export const ValidatorCheck = z.object({
  name: CheckName,
  passed: z.boolean(),
  severity: z.enum(["blocking", "warning"]),
  detail: z.string(),
  /** A patch the repair step can apply. Null when the check cannot self-repair. */
  repair: z.unknown().nullable(),
});
export type ValidatorCheck = z.infer<typeof ValidatorCheck>;

export const ValidatorReport = z.object({
  passed: z.boolean(),
  checks: z.array(ValidatorCheck),
});
export type ValidatorReport = z.infer<typeof ValidatorReport>;
