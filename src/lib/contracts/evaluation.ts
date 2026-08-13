import { z } from "zod";

/**
 * §14.5 — what the Evaluation Agent is asked for, and what comes back.
 *
 * "Failing here fails the product." The contract carries one rule the rest of
 * the pipeline is built to enforce: **every criterion score must quote the
 * artefact**. A score without a quote is not a weak score, it is not a score —
 * the verifier invalidates it, because an unquoted judgement is the shape a
 * hallucination arrives in.
 */

/** The four bands every rubric criterion is written against (§7.1). */
export const Band = z.enum(["absent", "developing", "competent", "strong"]);
export type Band = z.infer<typeof Band>;

/**
 * Band → score. Evenly spaced, and deliberately not a curve: the bands are
 * defined by their descriptors in the rubric the learner read before starting,
 * so bending the numbers afterwards would move a goalpost they were shown.
 */
export const BAND_SCORE: Record<Band, number> = {
  absent: 0,
  developing: 1 / 3,
  competent: 2 / 3,
  strong: 1,
};

/** At or above this, the work is treated as demonstrating the skill. */
export const COMPETENT = BAND_SCORE.competent;

export const CriterionVerdict = z.object({
  /** The rubric criterion's id. Checked against the rubric, never trusted. */
  criterionId: z.string().min(1),
  band: Band,
  /**
   * A span copied out of the artefact that justifies the band.
   *
   * Required even for `absent`, where it is the place the missing thing should
   * have been — "the query has no GROUP BY" is a claim about text that exists.
   * The one honest exception is an artefact with nothing in it at all, and the
   * pipeline handles that before it ever reaches a model.
   */
  evidence: z.string().min(1).max(2000),
  /** Why this band and not the one above it. Shown to the learner verbatim. */
  reasoning: z.string().min(1).max(1200),
});
export type CriterionVerdict = z.infer<typeof CriterionVerdict>;

export const EvaluationDraft = z.object({
  criteria: z.array(CriterionVerdict).min(1).max(12),
  /** What the work does well, in the learner's terms. */
  strengths: z.array(z.string().min(1).max(400)).max(6),
  /** What to fix, ordered by how much it matters. */
  gaps: z.array(z.string().min(1).max(400)).max(6),
  /** Concrete next actions, not encouragement. */
  nextActions: z.array(z.string().min(1).max(400)).max(6),
});
export type EvaluationDraft = z.infer<typeof EvaluationDraft>;

/**
 * §7.2's confidence ranges, which decide what the UI is allowed to claim.
 *
 * The floor of each band is what an evaluation starts at; agreement between
 * passes and a clean verifier move it up towards the ceiling. Nothing moves it
 * above the ceiling, because the ceiling is a property of the *evidence type*
 * rather than of how sure a model sounded.
 */
export const TIER_CONFIDENCE: Record<number, { min: number; max: number }> = {
  1: { min: 0.85, max: 0.95 },
  2: { min: 0.65, max: 0.85 },
  3: { min: 0.5, max: 0.7 },
  4: { min: 0.5, max: 0.75 },
  // §7.2 tier 5 — "None". Self-reported work is logged and never scored.
  5: { min: 0, max: 0 },
};

/** Below this an evaluation goes to a person rather than to the learner's record. */
export const HUMAN_REVIEW_BELOW = 0.5;
