import { z } from "zod";

/**
 * §7.1 — the Domain Pack schema.
 *
 * A pack is a versioned *data* bundle, not code. Everything the engine needs to
 * serve a new domain arrives through this shape, which is what makes §7.3's
 * rule hold: adding a domain requires no code change.
 */

/**
 * The longest a slug may be, in one place because two things need it.
 *
 * The schema below enforces it; `derive.ts` has to *build* slugs that satisfy
 * it, and until this constant existed it did so against a 64 it had written
 * down separately. That is exactly how the two drifted apart: `slugify` capped
 * a skill slug at 64 and `itemsFrom` then appended `-1`, producing 66
 * characters and a pack that could not be parsed — after four model calls had
 * already been paid for.
 */
export const MAX_SLUG_LENGTH = 64;

const slug = z
  .string()
  .min(2)
  .max(MAX_SLUG_LENGTH)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "must be lowercase, hyphen-separated, no leading or trailing hyphen",
  );

/** §7.1 — maturity is declared to the user, never faked. */
export const PackMaturity = z.enum(["curated", "standard", "generated"]);
export type PackMaturity = z.infer<typeof PackMaturity>;

/** §7.2 — evaluation-capability tier. */
export const EvalTier = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type EvalTier = z.infer<typeof EvalTier>;

/** §7.3 — the six workspaces. The pack picks one; no code branches on it. */
export const Workspace = z.enum([
  "text",
  "code",
  "query-sheet",
  "media",
  "audio",
  "conversation",
]);
export type Workspace = z.infer<typeof Workspace>;

export const SkillLevel = z.enum([
  "foundational",
  "core",
  "advanced",
  "specialist",
]);

export const BktPriors = z.object({
  pInit: z.number().min(0).max(1),
  pLearn: z.number().min(0).max(1),
  pSlip: z.number().min(0).max(1),
  pGuess: z.number().min(0).max(1),
});

export const PackSkill = z.object({
  slug,
  name: z.string().min(1),
  description: z.string().min(1),
  level: SkillLevel,
  /** §16.4 — the skill *area*, which is what the interleaving bonus switches. */
  area: z.string().min(1),
  evalTier: EvalTier,
  estimatedHours: z.number().positive().max(100),
  canDoStatement: z.string().min(10),
  observableEvidence: z.array(z.string().min(1)).min(1),
  bktPriors: BktPriors,
});
export type PackSkill = z.infer<typeof PackSkill>;

export const PackDependency = z.object({
  from: slug,
  to: slug,
  type: z.enum(["hard", "soft"]),
  strength: z.number().min(0).max(1).default(1),
});
export type PackDependency = z.infer<typeof PackDependency>;

export const ItemType = z.enum([
  "mcq",
  "short_text",
  "explain",
  "code_read",
  "micro_artifact",
]);
export type ItemType = z.infer<typeof ItemType>;

/**
 * §16.4 — "Free-text and produce-an-answer items outnumber MCQ ≥2:1". These are
 * the types that count as production rather than recognition.
 */
export const PRODUCTION_ITEM_TYPES: ItemType[] = [
  "short_text",
  "explain",
  "code_read",
  "micro_artifact",
];

export const PackItem = z.object({
  slug,
  skill: slug,
  type: ItemType,
  /** 0..1, on the same scale as mastery so the diagnostic can match them up. */
  difficulty: z.number().min(0).max(1),
  discrimination: z.number().min(0).max(3).default(1),
  prompt: z.string().min(10),
  options: z.array(z.string().min(1)).min(2).optional(),
  answerKey: z.unknown().optional(),
});
export type PackItem = z.infer<typeof PackItem>;

export const RubricBands = z.object({
  absent: z.string().min(1),
  developing: z.string().min(1),
  competent: z.string().min(1),
  strong: z.string().min(1),
});

export const RubricCriterion = z.object({
  id: slug,
  name: z.string().min(1),
  description: z.string().min(1),
  weight: z.number().positive().max(1),
  bands: RubricBands,
});
export type RubricCriterion = z.infer<typeof RubricCriterion>;

export const PackRubric = z.object({
  slug,
  version: z.number().int().positive().default(1),
  isPublic: z.boolean().default(true),
  /** §14.6 — rubric coverage: every rubric needs at least four criteria. */
  criteria: z.array(RubricCriterion).min(4),
});
export type PackRubric = z.infer<typeof PackRubric>;

export const PackProject = z.object({
  slug,
  title: z.string().min(1),
  brief: z.string().min(40),
  rubric: slug,
  evidenceType: z.string().min(1),
  difficulty: z.number().min(0).max(1),
  estimatedMinutes: z.number().int().positive(),
  isPublic: z.boolean().default(false),
  targetSkills: z.array(slug).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
});
export type PackProject = z.infer<typeof PackProject>;

/**
 * §7.1's `resource_index` — vetted external references, as pack data.
 *
 * A pack's skills, items and rubrics are things we assert. A resource is a
 * pointer at something somebody else published, and the difference shows up in
 * the two fields no other pack entity has: `publishedAt`, which is what §14.6's
 * freshness check ages out, and `checkedAt`/`reachable`, which is the last time
 * a link checker looked and what it found.
 *
 * **`reachable` is a finding with a date on it, not a promise.** It says a
 * request to this URL resolved on `checkedAt` — which is the strongest thing
 * any stored value can say about a page we do not control. A pack that claimed
 * a link "works" would be making a claim about the present out of a fact about
 * the past, and §4.2 law 3 is exactly the rule against that.
 */
export const ResourceKind = z.enum([
  "tutorial",
  "reference",
  "course",
  "book",
  "specification",
  "video",
  "dataset",
]);
export type ResourceKind = z.infer<typeof ResourceKind>;

export const PackResource = z.object({
  slug,
  url: z.string().url(),
  title: z.string().min(1),
  publisher: z.string().min(1),
  kind: ResourceKind,
  /** Pack-local skill slugs. A resource pointing outside its pack is dropped. */
  skills: z.array(slug).min(1),
  assessment: z.string().min(1),
  /** ISO-8601 date, or null where the source states none. */
  publishedAt: z.string().nullable().default(null),
  /** ISO-8601 timestamp of the last link check. */
  checkedAt: z.string().nullable().default(null),
  /** What that check found. Never a claim about right now. */
  reachable: z.boolean().default(true),
});
export type PackResource = z.infer<typeof PackResource>;

/**
 * §7.1 — *who* checked the pack, not just that someone did.
 *
 * The badge on a subject page says "Written and checked by hand", and for three
 * packs in this repository that was false: they carried
 * `reviewedBy: "Claude Opus 5 (model review)"` and the page had no way to tell
 * a person from a model, so it made the stronger claim for both. An enum is the
 * fix a free string could not be — `reviewKind` cannot be spelled wrong without
 * failing validation, and there is no third value to drift into.
 */
export const ReviewKind = z.enum(["human", "model"]);
export type ReviewKind = z.infer<typeof ReviewKind>;

/**
 * `reviewKind: null` is the only representation of "nobody has checked this".
 *
 * It replaces a sentinel string (`reviewedBy: "unreviewed"`) that `isTopicIndexable`
 * compared against directly, which meant the *schema default* — `null` — was not
 * equal to it and sailed through the gate. A pack that simply omitted its
 * `quality` block was indexable without ever having been read. Absence now fails
 * closed, because the gate asks for a positive value instead of the absence of a
 * magic one.
 */
export const PackQuality = z
  .object({
    status: z.string().default("draft"),
    reviewedBy: z.string().nullable().default(null),
    reviewKind: ReviewKind.nullable().default(null),
    reviewedAt: z.string().nullable().default(null),
    score: z.number().min(0).max(100).nullable().default(null),
  })
  /**
   * A reviewer with no kind, or a kind with no reviewer, is half a claim. Both
   * halves travel together or the pack does not load — otherwise the two fields
   * can disagree, and the one the badge reads would decide what the learner is
   * told.
   */
  .refine((q) => (q.reviewedBy === null) === (q.reviewKind === null), {
    message: "quality.reviewedBy and quality.reviewKind must be set together",
    path: ["reviewKind"],
  });

export const PackManifest = z.object({
  slug,
  name: z.string().min(1),
  taxonomyParent: z.string().min(1).nullable().default(null),
  maturity: PackMaturity,
  evalTier: EvalTier,
  workspace: Workspace,
  version: z.number().int().positive().default(1),
  evaluatorConfig: z.record(z.string(), z.unknown()).default({}),
  quality: PackQuality.default({
    status: "draft",
    reviewedBy: null,
    reviewKind: null,
    reviewedAt: null,
    score: null,
  }),
  skills: z.array(PackSkill).min(1),
  dependencies: z.array(PackDependency).default([]),
});

/** A fully assembled pack: manifest plus the item bank, rubrics and projects. */
export const DomainPackSchema = PackManifest.extend({
  items: z.array(PackItem).default([]),
  rubrics: z.array(PackRubric).default([]),
  projects: z.array(PackProject).default([]),
  /**
   * Defaulted rather than required, because every pack that exists today has
   * none. A pack without resources is a pack nobody has researched yet, which
   * is a true statement about all seven curated ones until the backfill runs.
   */
  resources: z.array(PackResource).default([]),
});

export type DomainPack = z.infer<typeof DomainPackSchema>;
