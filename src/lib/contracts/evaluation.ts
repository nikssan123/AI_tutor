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

/**
 * §24 E8.5 phase 2 — where in a photograph the band came from.
 *
 * The image half of the evidence contract, and it is **weaker than the text
 * half by construction**: no string match can confirm that a shadow falls where
 * the grader says it does. So it is not called a quote, it is not folded into
 * `verifierPassed`, and the one thing about it a computer *can* settle is
 * settled — the frame it cites has to be a frame that was handed in. A locator
 * pointing at photograph 5 of a three-frame set is the image-shaped version of
 * a fabricated quote, and `verify` throws it out for the same reason.
 */
export const EvidenceLocator = z.object({
  /**
   * Which photograph, 1-based.
   *
   * The same numbering the grader was shown — `buildGradeTurn` labels the
   * frames "Photograph 3 of 4" precisely so that this number and that label
   * cannot come apart. The learner is shown it too, so it has to mean the order
   * they chose the files in.
   */
  photograph: z.number().int().positive(),
  /** Where in that frame to look: "the seam allowance along the top edge". */
  where: z.string().min(1).max(300),
  /** What is visible there. This is the observation the band rests on. */
  observed: z.string().min(1).max(600),
});
export type EvidenceLocator = z.infer<typeof EvidenceLocator>;

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
   *
   * **Optional here, required by `verify` for every criterion the rubric marks
   * from the write-up** — which is `text` and `both`, and rule 2 of §24 E8.5
   * guarantees a rubric always has one. A criterion the rubric marks from the
   * photograph alone has no text span to copy, and forcing it to produce one is
   * how the check gets defeated rather than met: the grader either invents a
   * quote, which invalidates the criterion, or anchors to some unrelated
   * sentence that *does* match, which passes the string check while supporting
   * nothing. The second is the worse failure, and it is why this is optional.
   *
   * **`nullish` and no `min`, so a shape this schema dislikes costs one
   * criterion rather than the whole evaluation.** A model asked for an optional
   * field sometimes answers `null` or `""` instead of omitting it. Rejecting
   * that here throws away a marking that may be entirely sound, spends the
   * learner's evaluation on `marker_unavailable`, and tells them nothing — the
   * exact failure `AdviceList` above documents from the day it happened. An
   * empty quote is not evidence of anything, `quoteAppearsIn` says so, and
   * `verify` invalidates that one criterion with a reason.
   */
  evidence: z.string().max(2000).nullish(),
  /**
   * Where in the photographs the band came from. Required by `verify` for every
   * criterion the rubric marks from an image, when an image actually arrived.
   *
   * `nullish` for the reason above, and it is the more likely of the two to
   * arrive as an explicit null: most criteria in most rubrics do not own one.
   */
  locator: EvidenceLocator.nullish(),
  /** Why this band and not the one above it. Shown to the learner verbatim. */
  reasoning: z.string().min(1).max(1200),
});
export type CriterionVerdict = z.infer<typeof CriterionVerdict>;

/** How many of each advice list the marked screen shows. */
export const ADVICE_SHOWN = 6;

/**
 * A runaway guard, not a limit on thoroughness. Forty entries is a response
 * that has gone wrong; seven is a grader doing what it was told.
 */
export const ADVICE_CEILING = 40;

/**
 * One of the three advice lists — **capped by truncation, never by refusal.**
 *
 * This cap used to reject. A learner handed in work, the grader marked it in
 * full, returned seven gaps, and `gaps: Too big: expected array to have <=6
 * items` threw the entire evaluation away; the retry did the same; the
 * submission landed in `failed` saying "We couldn't mark this one", and the
 * month's evaluation had already been spent on it. Nothing was wrong with the
 * marking. Six was a number about the screen.
 *
 * It also contradicted the prompt to its face: the grader is told "report every
 * problem you find... do not decide something is too minor to mention", which
 * is deliberate — conservative-reporting instructions measurably depress
 * recall. Asking for everything and then discarding the answer for having
 * everything in it is a contract at war with itself. The lists are ordered by
 * how much each entry matters, so the top few are exactly what to keep.
 */
const AdviceList = z
  .array(z.string().min(1).max(400))
  .max(ADVICE_CEILING)
  .transform((list) => list.slice(0, ADVICE_SHOWN));

export const EvaluationDraft = z.object({
  criteria: z.array(CriterionVerdict).min(1).max(12),
  /** What the work does well, in the learner's terms. */
  strengths: AdviceList,
  /** What to fix, ordered by how much it matters. */
  gaps: AdviceList,
  /** Concrete next actions, not encouragement. */
  nextActions: AdviceList,
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
