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

/**
 * How many sub-areas those skills may be spread across.
 *
 * The canonical curriculum cuts a course into modules by grouping consecutive
 * skills that share an area, so this is really a bound on how fragmented a
 * generated course can be. The first pack built without it came back with eight
 * areas over fourteen skills, and nine of its eleven modules held one skill —
 * the exact shape grouping exists to prevent. Curated packs of that size use
 * five.
 *
 * **The ceiling is set by the floor on skills, not by the ceiling.** Four,
 * because a pack may be as small as `MIN_GENERATED_SKILLS` — and "every area
 * holds at least two skills" has to be satisfiable at eight of them, not merely
 * at fourteen. A bound that only holds on the largest packs is not a bound. It
 * leaves 2–2.7 skills per area on the smallest and 3.5–4.7 on the largest,
 * which is about where the curated packs sit.
 *
 * Guidance rather than a schema `refine`: a violation here is a course that
 * reads badly, not one that is wrong, and failing a pack over it would throw
 * away four model calls and about a pound to redo work that is otherwise sound.
 */
export const MIN_GENERATED_AREAS = 3;
export const MAX_GENERATED_AREAS = 4;

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
  /**
   * How the answer is typed. Asked of the author rather than inferred from
   * `type`, because `type` is about the question: "list the exact dotnet CLI
   * commands" is `short_text` and its answer is entirely code.
   */
  answerFormat: z.enum(["prose", "code"]).default("prose"),
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

/* ── Resources ────────────────────────────────────────────────────────────── */

/**
 * §7.1's `resource_index` — the one thing in a generated pack that does not come
 * out of the model's weights.
 *
 * Everything else here is judgement about a subject, which is what a model is
 * for. A *reference* is a fact about the world on a particular day: whether the
 * page exists, who published it, when. §14.6's freshness check is written to
 * catch exactly the case where those facts have rotted, and until this contract
 * existed it had nothing to check — the researcher was a row in the model table
 * and an optional field nobody filled in.
 *
 * The URL is the reason this call searches rather than recalls. A model asked
 * for "the best SQL tutorial" will produce a plausible URL from memory, and a
 * plausible URL is worse than none: it fails the reachability check at best, and
 * at worst resolves to something else entirely.
 */

/** Between these, a pack has enough to point a learner at without a shelf. */
export const MIN_GENERATED_RESOURCES = 4;
export const MAX_GENERATED_RESOURCES = 24;

export const DraftResource = z.object({
  /** Exactly as returned by the search — never reconstructed or tidied. */
  url: z.string().url().max(600),
  title: z.string().min(2).max(200),
  /** Who published it: "Harvard CS50", "PostgreSQL docs", "Julia Evans". */
  publisher: z.string().min(2).max(120),
  kind: z.enum([
    "tutorial",
    "reference",
    "course",
    "book",
    "specification",
    "video",
    "dataset",
  ]),
  /** Refs (`s3`) of the skills this covers, as `items.ts` and `rubrics.ts` use. */
  skills: z.array(z.string().min(1)).min(1).max(8),
  /**
   * What it is good for and what it is not — the same standard §12's guides
   * hold citations to. A bare link is a search result; an assessment is why we
   * are sending someone there rather than somewhere else.
   */
  assessment: z.string().min(20).max(600),
  /**
   * ISO-8601, or null where the source does not state one.
   *
   * Null rather than a guess, and `resourceFreshness` treats it as "cannot be
   * judged stale" rather than "fresh" — the check only ages out a date it was
   * actually given. A model filling this in from vibes would turn the one
   * signal that catches rot into noise.
   */
  publishedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .nullable(),
});
export type DraftResource = z.infer<typeof DraftResource>;

export const ResourcesDraft = z.object({
  resources: z
    .array(DraftResource)
    .min(MIN_GENERATED_RESOURCES)
    .max(MAX_GENERATED_RESOURCES),
});
export type ResourcesDraft = z.infer<typeof ResourcesDraft>;
