import {
  BAND_SCORE,
  COMPETENT,
  HUMAN_REVIEW_BELOW,
  TIER_CONFIDENCE,
  type CriterionVerdict,
  type EvaluationDraft,
  type EvidenceLocator,
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
  /**
   * The quote, **only when this step found it in the artefact**.
   *
   * Non-null for `text` and `both`; **null for `image`**, whose band rests on a
   * locator instead. It is what keeps §14.5's claim narrow: "every score quotes
   * your work" is true of the criteria this is non-null on, and of no others.
   */
  quote: string | null;
  /**
   * The locator, **only when this step checked one**.
   *
   * Null on a criterion the rubric marks from the write-up, and null on one it
   * marks from a photograph that never arrived — in both cases the grader may
   * still have supplied a locator, and in both cases nothing verified it.
   *
   * Both fields work the same way and for the same reason: only evidence this
   * function actually checked leaves it. Reading either off `verdict` downstream
   * is how an unchecked string ends up drawn where a checked one goes.
   */
  locator: EvidenceLocator | null;
}

export interface VerificationResult {
  /** Criteria whose evidence checks out. Only these are scored. */
  upheld: VerifiedCriterion[];
  /** Criteria the verifier threw out, with the reason, for the audit trail. */
  invalidated: Array<{ criterionId: string; reason: string }>;
  /** Rubric criteria the grader never returned a verdict for. */
  missing: string[];
  /**
   * §15 — the boolean recorded on the evaluation row.
   *
   * **A statement about quotes, and only about quotes** (§24 E8.5 phase 2). It
   * is true when every criterion the string match could speak about was
   * returned, once, with a span found in the submitted text — and it says
   * nothing at all about criteria judged from a photograph, because nothing
   * deterministic can. Widening it to cover those would make the column read as
   * a clean bill of health for evidence that was never checked, which is §4.2
   * law 3 broken in the one place the product is sold on.
   */
  passed: boolean;
  /**
   * The share of upheld rubric weight whose band a quote actually anchors.
   *
   * 1 for a prose hand-in, lower for a verdict resting partly on locators, and
   * `confidenceFor` reads it — a verdict that was checked less has to say so in
   * the number, not only in the wording beside it.
   */
  quotedWeight: number;
  /**
   * Upheld criteria whose band came out of a photograph, and which frames each
   * one cites. Goes to `provenBy` and to the screen; kept apart from `passed`
   * for the reason above.
   */
  located: Array<{ criterionId: string; photographs: number[] }>;
}

/**
 * Checks a draft against the rubric it was graded with and the evidence it
 * claims to rest on.
 *
 * A criterion is thrown out whenever the grader has told us something about a
 * document other than the one submitted: a criterion the rubric does not
 * contain, a criterion returned twice, a quote that is not in the artefact, and
 * — since phase 2 — a locator pointing at a photograph nobody handed in.
 *
 * @param imageCount how many photographs arrived with the work. Not how many
 * the brief asked for: a criterion the rubric marks from an image is owed a
 * locator only if there was an image to locate anything in.
 */
export function verify(
  draft: EvaluationDraft,
  criteria: RubricCriterion[],
  artefact: string,
  imageCount = 0,
): VerificationResult {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const upheld: VerifiedCriterion[] = [];
  const invalidated: VerificationResult["invalidated"] = [];
  const located: VerificationResult["located"] = [];
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

    let checkedQuote: string | null = null;

    // `text` and `both` owe a quote; `image` does not have one to owe.
    if (criterion.marks !== "image") {
      const quote = verdict.evidence ?? "";
      if (!quoteAppearsIn(artefact, quote)) {
        // The failure this whole step exists for. A criterion that gave no
        // quote at all fails it here rather than in a case of its own: an
        // absent quote and an invented one are the same amount of evidence.
        invalidated.push({
          criterionId: verdict.criterionId,
          reason: "the quoted evidence is not in the submitted work",
        });
        continue;
      }
      checkedQuote = quote;
    } else if (imageCount === 0) {
      /*
       * Nothing anchors this one. An `image` criterion owes no quote, so with no
       * photograph in hand there is neither half of the contract left — and a
       * band with no evidence under it is exactly what the verifier exists to
       * remove. `score` renormalises over what survived, so this costs the
       * learner coverage and confidence rather than marks, which is the honest
       * consequence of handing in less than the brief asked for.
       */
      invalidated.push({
        criterionId: verdict.criterionId,
        reason: "judged from a photograph, and none was handed in",
      });
      continue;
    }

    let checkedLocator: EvidenceLocator | null = null;

    if (criterion.marks !== "text" && imageCount > 0) {
      const locator = verdict.locator;
      if (!locator) {
        invalidated.push({
          criterionId: verdict.criterionId,
          reason: "nothing in the photographs was pointed at",
        });
        continue;
      }
      /*
       * The one thing about a locator a computer can settle, and the reason the
       * frames are structured rather than prose. **Every** cited frame is
       * checked, not the first: a criterion about a set names several, and one
       * validated number beside three unchecked ones is worse than no check —
       * it reads as a check having happened.
       */
      const missingFrame = locator.photographs.find((n) => n > imageCount);
      if (missingFrame !== undefined) {
        invalidated.push({
          criterionId: verdict.criterionId,
          reason: `photograph ${missingFrame} was not handed in`,
        });
        continue;
      }
      checkedLocator = locator;
      located.push({
        criterionId: verdict.criterionId,
        photographs: locator.photographs,
      });
    }

    upheld.push({
      verdict,
      criterion,
      quote: checkedQuote,
      locator: checkedLocator,
    });
  }

  const missing = criteria
    .map((c) => c.id)
    .filter((id) => !seen.has(id))
    .sort();

  /*
   * `passed` is scoped to the criteria a quote could have been checked for, and
   * so is the population it is scoped against: a rubric where two `image`
   * criteria were thrown out for a missing locator has still had every quote it
   * owns checked and found. Anything about the image half is reported in
   * `invalidated`, `located` and `quotedWeight`, all of which reach the row.
   */
  const quotable = new Set(
    criteria.filter((c) => c.marks !== "image").map((c) => c.id),
  );
  const quoteFailed = invalidated.some(
    (i) => !byId.has(i.criterionId) || quotable.has(i.criterionId),
  );

  const upheldWeight = upheld.reduce((sum, u) => sum + u.criterion.weight, 0);
  const anchoredWeight = upheld
    .filter((u) => u.quote !== null)
    .reduce((sum, u) => sum + u.criterion.weight, 0);

  return {
    upheld,
    invalidated,
    missing,
    passed: !quoteFailed && missing.every((id) => !quotable.has(id)),
    // 1 when nothing was upheld, because there is no verdict for it to qualify;
    // `confidenceFor` already refuses credit to an empty draft on its own terms,
    // and a 0 here would double-count that.
    quotedWeight: upheldWeight === 0 ? 1 : anchoredWeight / upheldWeight,
    located,
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
  //
  // §24 E8.5 phase 2 — scaled by how much of the verdict the string match could
  // speak about. `passed` is a statement about quotes, so the credit it earns
  // has to be proportional to the share of the score quotes anchor; a rubric
  // marked mostly from photographs has been checked less, and awarding it the
  // full 0.6 would let a locator inherit a quote's credibility. It is 1 for a
  // prose hand-in, which is every submission before this epic.
  if (input.verification.passed) {
    earned += 0.6 * input.verification.quotedWeight;
  } else if (
    input.verification.invalidated.length === 0 &&
    input.verification.upheld.length > 0
  ) {
    earned += 0.3 * input.verification.quotedWeight;
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
