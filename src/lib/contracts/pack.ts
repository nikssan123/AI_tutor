import { z } from "zod";

/**
 * §7.1's Generated tier — what the model is asked for when a learner's goal
 * matches no pack in the catalogue.
 *
 * These contracts are deliberately *smaller* than `DomainPack`. The model is
 * asked for the parts that need judgement about a subject — what the skills
 * are, what order they go in, what a good answer looks like — and for nothing
 * that code can work out on its own. Slugs, BKT priors, evaluation tiers, ids
 * and rubric weights are all derived in `generate/derive.ts`, because a model
 * asked for a calibrated probability or a set of numbers summing to 1 produces
 * its worst output and `validatePack` blocks on exactly those.
 *
 * The split also keeps the repair loop cheap: a bad weight is arithmetic, not a
 * regeneration.
 */

/** 8–14 skills. A curated pack has ~26; a generated one should not pretend to. */
export const MIN_GENERATED_SKILLS = 8;
export const MAX_GENERATED_SKILLS = 14;

export const DraftSkill = z.object({
  name: z.string().min(2).max(120),
  description: z.string().min(10).max(600),
  level: z.enum(["foundational", "core", "advanced", "specialist"]),
  /** §16.4's interleaving bonus switches on this, so it is a planner input. */
  area: z.string().min(2).max(60),
  estimatedHours: z.number().positive().max(100),
  canDoStatement: z.string().min(10).max(300),
  observableEvidence: z.array(z.string().min(1).max(200)).min(1).max(5),
  /**
   * Names of skills listed *earlier* in the array. Backward-only references are
   * what make the graph acyclic by construction rather than by a check that
   * fails after the money is spent — see `derive.ts`.
   */
  prerequisites: z.array(z.string().min(1)).max(6),
  /**
   * §7.2 tier 5 — "motivation, taste, confidence, 'understanding' without
   * output". A skill the learner can only self-report is marked here so the
   * engine refuses to let it raise mastery, rather than being quietly scored
   * like everything else.
   */
  selfReportOnly: z.boolean(),
});
export type DraftSkill = z.infer<typeof DraftSkill>;

export const PackGraphDraft = z.object({
  /** Display name for the subject, e.g. "Rust Programming". */
  name: z.string().min(2).max(80),
  /** §7.1's taxonomy branch, e.g. "technology". Drives the subject icon. */
  taxonomyParent: z.string().min(2).max(60),
  /** §7.3 — which work surface the learner produces evidence in. */
  workspace: z.enum([
    "text",
    "code",
    "query-sheet",
    "media",
    "audio",
    "conversation",
  ]),
  skills: z
    .array(DraftSkill)
    .min(MIN_GENERATED_SKILLS)
    .max(MAX_GENERATED_SKILLS),
  /**
   * Why this shape, and what the model deliberately left out. Shown to nobody
   * yet; recorded so a pack that turns out wrong can be read back against the
   * reasoning that produced it.
   */
  rationale: z.string().max(2000),
});
export type PackGraphDraft = z.infer<typeof PackGraphDraft>;

/* ── Item bank ────────────────────────────────────────────────────────────── */

/**
 * §16.4 — production items must outnumber recognition items 2:1, and
 * `validatePack` blocks a pack that breaks it. The generator asks for the right
 * mix rather than filtering afterwards, so the ratio costs nothing to hold.
 */
export const MIN_ITEMS_PER_SKILL = 3;
export const MIN_GENERATED_ITEMS = 24;

export const DraftItem = z.object({
  /** The `name` of the skill this assesses, as given in the graph. */
  skill: z.string().min(1),
  type: z.enum(["mcq", "short_text", "explain", "code_read", "micro_artifact"]),
  /** 0..1, on the same scale as mastery so the diagnostic can match them up. */
  difficulty: z.number().min(0).max(1),
  prompt: z.string().min(10).max(2000),
  /** MCQ only; 2–5 options with exactly one correct. */
  options: z.array(z.string().min(1).max(400)).min(2).max(5).optional(),
  /** MCQ only: 0-based index into `options`. */
  correct: z.number().int().min(0).max(4).optional(),
  /**
   * Free-text only: what a correct answer must contain. These are what the
   * learner marks themselves against, so they are phrased as checkable claims
   * rather than as a model answer.
   */
  concepts: z.array(z.string().min(1).max(300)).max(6).optional(),
});
export type DraftItem = z.infer<typeof DraftItem>;

export const ItemBankDraft = z.object({
  items: z.array(DraftItem).min(1).max(120),
});
export type ItemBankDraft = z.infer<typeof ItemBankDraft>;

/* ── Rubrics and projects ─────────────────────────────────────────────────── */

/** §14.6 rubric coverage — fewer than four criteria is not a rubric. */
export const MIN_RUBRIC_CRITERIA = 4;

export const DraftCriterion = z.object({
  name: z.string().min(2).max(120),
  description: z.string().min(10).max(600),
  /**
   * Relative importance, any positive number. Normalised to sum to 1 in code —
   * the model is never asked for weights that add up, because they never do and
   * `validatePack` blocks on a sum that is off by 0.001.
   */
  weight: z.number().positive().max(100),
  bands: z.object({
    absent: z.string().min(1).max(400),
    developing: z.string().min(1).max(400),
    competent: z.string().min(1).max(400),
    strong: z.string().min(1).max(400),
  }),
});
export type DraftCriterion = z.infer<typeof DraftCriterion>;

export const DraftRubric = z.object({
  name: z.string().min(2).max(120),
  criteria: z.array(DraftCriterion).min(MIN_RUBRIC_CRITERIA).max(8),
});
export type DraftRubric = z.infer<typeof DraftRubric>;

export const DraftProject = z.object({
  title: z.string().min(2).max(160),
  brief: z.string().min(40).max(4000),
  /** The `name` of one of the rubrics in the same draft. */
  rubric: z.string().min(1),
  /** Skill names from the graph that this project produces evidence for. */
  targetSkills: z.array(z.string().min(1)).min(1).max(6),
  evidenceType: z.string().min(2).max(60),
  difficulty: z.number().min(0).max(1),
  estimatedMinutes: z.number().int().positive().max(2400),
  acceptanceCriteria: z.array(z.string().min(1).max(400)).min(1).max(10),
});
export type DraftProject = z.infer<typeof DraftProject>;

export const RubricsDraft = z.object({
  rubrics: z.array(DraftRubric).min(1).max(6),
  projects: z.array(DraftProject).min(1).max(6),
});
export type RubricsDraft = z.infer<typeof RubricsDraft>;
