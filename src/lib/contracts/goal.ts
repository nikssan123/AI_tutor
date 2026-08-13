import { z } from "zod";

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
  motivation: z.string().max(500),
  constraints: z.array(z.string().max(200)).max(20),
  existingAssets: z.array(z.string().max(200)).max(20),
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
