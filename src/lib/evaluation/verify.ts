import {
  BAND_SCORE,
  COMPETENT,
  HUMAN_REVIEW_BELOW,
  TIER_CONFIDENCE,
  type CriterionVerdict,
  type EvaluationDraft,
} from "@/lib/contracts/evaluation";
import type { RubricCriterion } from "@/lib/packs/types";
import type { EvalTier } from "@/lib/packs/types";

/**
 * §14.5 step 5 — "does each score cite real evidence from the artefact?"
 *
 * The plan describes this as a Sonnet pass. It is a string match instead, and
 * that is a strengthening rather than a shortcut: the question "does this quote
 * appear in this text" has a correct answer that a computer can produce every
 * time and free, and asking a second model to check the first model's quotes
 * introduces exactly the failure it is supposed to catch. §15's schema already
 * said as much — `verifierPassed` is documented there as "the deterministic
 * string-match check that every quote appears verbatim in the artefact".
 *
 * This is the single rule §14.5 calls non-negotiable, and it is the one that
 * makes the whole product's claim ("every score quotes your work") checkable
 * rather than asserted.
 */

/**
 * Whitespace-insensitive containment.
 *
 * A model reflows what it quotes — a line break becomes a space, indentation is
 * dropped, a run of spaces collapses. Matching on the normalised form accepts
 * those and nothing else: the words, in order, must still be present. It cannot
 * turn a fabricated quote into a passing one, because a fabrication differs in
 * more than whitespace.
 */
export function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function quoteAppearsIn(artefact: string, quote: string): boolean {
  const needle = normalise(quote);
  // An empty quote is not evidence of anything, and would match everything.
  if (needle.length === 0) return false;
  return normalise(artefact).includes(needle);
}

export interface VerifiedCriterion {
  verdict: CriterionVerdict;
  criterion: RubricCriterion;
  /** False when the quote is not in the artefact, or the criterion is unknown. */
  quoted: boolean;
}

export interface VerificationResult {
  /** Criteria whose evidence checks out. Only these are scored. */
  upheld: VerifiedCriterion[];
  /** Criteria the verifier threw out, with the reason, for the audit trail. */
  invalidated: Array<{ criterionId: string; reason: string }>;
  /** Rubric criteria the grader never returned a verdict for. */
  missing: string[];
  /** §15 — the boolean recorded on the evaluation row. */
  passed: boolean;
}

/**
 * Checks a draft against the rubric it was graded with and the artefact it
 * claims to quote.
 *
 * Three things get a criterion thrown out, and all three are cases where the
 * grader has told us something about a document other than the one submitted:
 * a criterion the rubric does not contain, a criterion returned twice, and a
 * quote that is not in the artefact.
 */
export function verify(
  draft: EvaluationDraft,
  criteria: RubricCriterion[],
  artefact: string,
): VerificationResult {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const upheld: VerifiedCriterion[] = [];
  const invalidated: VerificationResult["invalidated"] = [];
  const seen = new Set<string>();

  for (const verdict of draft.criteria) {
    const criterion = byId.get(verdict.criterionId);

    if (!criterion) {
      invalidated.push({
        criterionId: verdict.criterionId,
        reason: "the rubric has no such criterion",
      });
      continue;
    }
    if (seen.has(verdict.criterionId)) {
      invalidated.push({
        criterionId: verdict.criterionId,
        reason: "scored more than once",
      });
      continue;
    }
    seen.add(verdict.criterionId);

    if (!quoteAppearsIn(artefact, verdict.evidence)) {
      // The failure this whole step exists for.
      invalidated.push({
        criterionId: verdict.criterionId,
        reason: "the quoted evidence is not in the submitted work",
      });
      continue;
    }

    upheld.push({ verdict, criterion, quoted: true });
  }

  const missing = criteria
    .map((c) => c.id)
    .filter((id) => !seen.has(id))
    .sort();

  return {
    upheld,
    invalidated,
    missing,
    // A clean pass means every criterion in the rubric was scored and every
    // score is anchored in the work. Anything less is reported, not hidden.
    passed: invalidated.length === 0 && missing.length === 0,
  };
}

/* ── Scoring ──────────────────────────────────────────────────────────────── */

export interface Scored {
  /** 0..1, weighted by the rubric's own weights. */
  overall: number;
  /** The share of the rubric's weight that survived verification. */
  coverage: number;
}

/**
 * The overall score, over upheld criteria only.
 *
 * Renormalised by the weight that survived rather than scored out of the full
 * rubric: a criterion the verifier threw out is one we know nothing about, and
 * treating "unknown" as zero would punish a learner for the grader's mistake.
 * The share that survived is returned alongside, because a score derived from
 * 40% of the rubric is not a score anybody should act on — `confidenceFor`
 * reads it, and a low one drives the whole thing to human review.
 */
export function score(upheld: VerifiedCriterion[]): Scored {
  const weight = upheld.reduce((sum, u) => sum + u.criterion.weight, 0);
  if (weight === 0) return { overall: 0, coverage: 0 };

  const earned = upheld.reduce(
    (sum, u) => sum + u.criterion.weight * BAND_SCORE[u.verdict.band],
    0,
  );

  return { overall: earned / weight, coverage: weight };
}

/* ── Confidence ───────────────────────────────────────────────────────────── */

export interface ConfidenceInput {
  /** §7.2 tier of the skill being evidenced — the ceiling comes from here. */
  tier: EvalTier;
  verification: VerificationResult;
  /** Share of the rubric's weight that was upheld, from `score`. */
  coverage: number;
  /**
   * Band distance between two independent passes, when a second one ran.
   * §14.5 step 4: "disagreement > 1 band → flag".
   */
  bandSpread?: number | undefined;
}

/**
 * §14.5 step 6 — confidence from tier, verifier agreement and self-consistency.
 *
 * It starts at the floor of the tier's range and earns its way up. Nothing here
 * can push it past the tier's ceiling, which is the point: §7.2 fixes what a
 * *kind of evidence* can support, and no amount of internal agreement turns a
 * photograph into an executed test.
 */
export function confidenceFor(input: ConfidenceInput): number {
  const range = TIER_CONFIDENCE[input.tier]!;
  if (range.max === 0) return 0;

  const span = range.max - range.min;
  let earned = 0;

  // A clean verifier pass is most of it: it is the thing that distinguishes a
  // grounded evaluation from a plausible one.
  //
  // The partial credit below requires something to have actually been upheld.
  // Without that guard a grader that returned *nothing* scores as "invented
  // nothing" and earns confidence for it, which is how an evaluation with no
  // evidence behind it ends up looking trustworthy.
  if (input.verification.passed) earned += 0.6;
  else if (
    input.verification.invalidated.length === 0 &&
    input.verification.upheld.length > 0
  ) {
    earned += 0.3;
  }

  // Coverage below the whole rubric is a real gap in what we looked at.
  earned += 0.2 * Math.min(1, input.coverage);

  // Two passes landing in the same band is the strongest signal available
  // short of executing something.
  if (input.bandSpread !== undefined) {
    earned += input.bandSpread === 0 ? 0.2 : input.bandSpread <= 1 ? 0.1 : 0;
  }

  return range.min + span * Math.min(1, earned);
}

/** §14.5 step 8 — below this it goes to a person, not to the learner's record. */
export function needsHumanReview(confidence: number): boolean {
  return confidence < HUMAN_REVIEW_BELOW;
}

/**
 * The observation the mastery model gets.
 *
 * `correct` is whether the work reached the competent band, which is the line
 * the rubric itself draws — the learner read those descriptors before starting.
 * Confidence weights how far the belief moves, and the tier travels with it so
 * `updateMastery` can apply §7.2's rule about tier 5 without knowing anything
 * about submissions.
 */
export function observationFrom(
  overall: number,
  confidence: number,
  tier: EvalTier,
): { correct: boolean; confidence: number; evidenceTier: EvalTier } {
  return {
    correct: overall >= COMPETENT,
    confidence,
    evidenceTier: tier,
  };
}
