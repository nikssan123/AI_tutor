import { z } from "zod";
import { COURSE_DEPTHS, DEFAULT_COURSE_DEPTH } from "@/lib/engine/types";

/**
 * §14.9.2 step contracts 1 and 3 — `GoalSpec` and `SkillProjection`.
 *
 * These are written as Zod rather than as bare TypeScript for the reason the
 * plan gives: "they validate at runtime *and* compile to the JSON Schema the
 * API's structured outputs need, so there is one definition per contract." The
 * Goal Analyzer (Sonnet 5, §8 screen 3) will emit a `GoalSpec` once
 * `ANTHROPIC_API_KEY` exists; until then the same shape is filled in from a
 * form. Having one contract for both paths is the point — the screen that
 * replaces the form does not get to invent a different goal.
 */

export const OutcomeType = z.enum([
  "career",
  "project",
  "exam",
  "personal",
  "curiosity",
]);
export type OutcomeType = z.infer<typeof OutcomeType>;

export const StatedLevel = z.enum([
  "none",
  "beginner",
  "intermediate",
  "advanced",
]);
export type StatedLevel = z.infer<typeof StatedLevel>;

/**
 * §13.3 and §16.1 both assume a real weekly budget; 0.5–40 is the plan's range.
 * The planner's `timeFit` term reads this, so a nonsense value is not a
 * cosmetic problem — it silently reshapes every session.
 */
export const MIN_WEEKLY_HOURS = 0.5;
export const MAX_WEEKLY_HOURS = 40;

/**
 * The stored form of `CourseDepth`. The tuple lives in the engine because the
 * engine is the layer everything else imports, and duplicating the three
 * strings here is how they would drift apart.
 */
export const CourseDepthSpec = z.enum(COURSE_DEPTHS);

/**
 * What the learner already works with, as something a cache key can hold
 * (PLAN-ADAPTATION step 5).
 *
 * `existingAssets` has been captured at intake since E3 and read by nothing. It
 * is free text — "I use pivot tables at work every day" — which is exactly what
 * makes it useful to a lesson and unusable as a cache dimension: keyed on it,
 * every learner gets their own lesson, the shared cache dies, and the marginal
 * cost of content goes from a database read to a model call. §14.9.4 expects a
 * 40–60% hit rate and that is what pays for generated lessons at all.
 *
 * So this is the *closed projection* of it. Four values, so a lesson fragments
 * into at most four buckets per band instead of one per person, and every
 * bucket is still shared with everyone who answered the same way. Bounded
 * personalisation is the only kind that survives a shared cache.
 *
 * Deliberately coarse, and deliberately not a taxonomy of everything anyone
 * might know. It exists to give the lesson generator **one concrete handle** —
 * something true about the reader it can reach for when an analogy genuinely
 * fits. `none` is the honest answer for most learners in most subjects, and the
 * lessons those learners get are the ones written today.
 */
export const PRIOR_DOMAINS = [
  "none",
  "spreadsheets",
  "programming",
  "statistics",
] as const;

export const PriorDomain = z.enum(PRIOR_DOMAINS);
export type PriorDomain = z.infer<typeof PriorDomain>;

export const DEFAULT_PRIOR_DOMAIN: PriorDomain = "none";

export const GoalSpec = z.object({
  /** Exactly what the learner typed, stored verbatim and never rewritten. */
  rawGoal: z.string().min(1).max(500),
  /** Taxonomy node slug. For a matched Curated pack, the pack's own slug. */
  domain: z.string().min(1),
  targetOutcome: z.string().min(1).max(300),
  outcomeType: OutcomeType,
  statedLevel: StatedLevel,
  weeklyHours: z.number().min(MIN_WEEKLY_HOURS).max(MAX_WEEKLY_HOURS),
  deadline: z.iso.date().nullable(),
  /**
   * How much of the pack this goal is for. Defaulted rather than required, so
   * every goal written before the dial existed reads back as `standard` — the
   * behaviour it was actually planned under.
   */
  depth: CourseDepthSpec.default(DEFAULT_COURSE_DEPTH),
  motivation: z.string().max(500),
  constraints: z.array(z.string().max(200)).max(20),
  existingAssets: z.array(z.string().max(200)).max(20),
  /**
   * The closed reading of `existingAssets`, for the lesson cache. Defaulted, so
   * every goal written before this existed reads back as `none` — which is the
   * lesson those learners were already being served.
   */
  priorDomain: PriorDomain.default(DEFAULT_PRIOR_DOMAIN),
  /** §8 screen 3 — below 0.6 the Goal Analyzer asks one more question. */
  clarity: z.number().min(0).max(1),
});
export type GoalSpec = z.infer<typeof GoalSpec>;

/**
 * Nothing was inferred, so there is nothing left to clarify.
 *
 * The LLM path will produce values below this and the intake screen will use
 * them to decide whether to ask again. A form that asked for every field
 * directly has no such uncertainty, and recording a lower number here to look
 * humble would make `clarity` mean two different things at once.
 */
export const STATED_CLARITY = 1;

export const SkillProjection = z.object({
  requiredSkillIds: z.array(z.string()),
  optionalSkillIds: z.array(z.string()),
  excludedSkillIds: z.array(z.string()),
  /** Shown to the learner as "skipped because…" (§8 screen 5). */
  exclusionReasons: z.record(z.string(), z.string()),
  estimatedHours: z.number(),
});
export type SkillProjection = z.infer<typeof SkillProjection>;
