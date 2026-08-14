import { Band } from "@/lib/contracts/evaluation";
import type { Band as BandName } from "@/lib/contracts/evaluation";

/**
 * §24 E8's two unmet acceptance criteria, as arithmetic.
 *
 * > On the Phase-0 hand-graded set, model-vs-human agreement is Cohen's κ ≥ 0.6
 * > Two runs on the same submission land within one rubric band ≥85% of the time
 *
 * They measure different failures and both are needed. κ asks *is the grader
 * right* — does it land where a human lands, allowing for the agreement you
 * would get by chance. Stability asks *is the grader consistent* — does it say
 * the same thing twice. A grader can be stable and wrong (it reliably marks
 * everything "competent") or right and unstable (it averages out correct while
 * telling two learners with identical work different things). Only the second
 * of those is visible without a human corpus, which is why this needs one.
 *
 * This is the arithmetic only. `scripts/calibration.ts` is what runs it against
 * the real evaluator; keeping the two apart means the number that decides
 * whether the product is feasible is itself covered by tests.
 */

export const BANDS = Band.options;

/** One criterion of one submission, graded twice. */
export interface Judgement {
  submissionId: string;
  criterionId: string;
  band: BandName;
}

export interface Agreement {
  /** Paired judgements compared. */
  n: number;
  /** Share landing on exactly the same band. */
  observed: number;
  /** Share that would agree by chance, given how each rater spread their bands. */
  expected: number;
  /**
   * Cohen's κ, or `null` when it is not defined.
   *
   * Undefined is not the same as zero and must not be printed as one: it means
   * *this corpus cannot answer the question*, which is a different instruction
   * to the person reading it. See `undefinedReason`.
   */
  kappa: number | null;
  undefinedReason: string | null;
  /** Share landing on the same band or an adjacent one. */
  withinOneBand: number;
  /** Every disagreement, worst first — the list worth actually reading. */
  disagreements: Array<{
    submissionId: string;
    criterionId: string;
    left: BandName;
    right: BandName;
    /** Bands apart, 1–3. */
    distance: number;
  }>;
}

function index(band: BandName): number {
  return BANDS.indexOf(band);
}

function key(j: Judgement): string {
  return `${j.submissionId}::${j.criterionId}`;
}

/**
 * Compares two sets of judgements over the same criteria.
 *
 * Pairs on (submission, criterion) rather than on position, so a corpus graded
 * in a different order than it was run still lines up. Anything present on one
 * side only is dropped — a half-graded corpus should produce a smaller honest
 * `n`, never a silent mispairing.
 */
export function agreementBetween(
  left: Judgement[],
  right: Judgement[],
): Agreement {
  const rightByKey = new Map(right.map((j) => [key(j), j]));

  const pairs: Array<{ left: Judgement; right: Judgement }> = [];
  for (const l of left) {
    const r = rightByKey.get(key(l));
    if (r) pairs.push({ left: l, right: r });
  }

  const n = pairs.length;
  if (n === 0) {
    return {
      n: 0,
      observed: 0,
      expected: 0,
      kappa: null,
      undefinedReason:
        "no judgement appears on both sides — check the submission and criterion ids match",
      withinOneBand: 0,
      disagreements: [],
    };
  }

  let matched = 0;
  let withinOne = 0;
  const disagreements: Agreement["disagreements"] = [];

  const leftCounts = new Map<BandName, number>();
  const rightCounts = new Map<BandName, number>();

  for (const pair of pairs) {
    const distance = Math.abs(index(pair.left.band) - index(pair.right.band));
    if (distance === 0) matched += 1;
    if (distance <= 1) withinOne += 1;
    if (distance > 0) {
      disagreements.push({
        submissionId: pair.left.submissionId,
        criterionId: pair.left.criterionId,
        left: pair.left.band,
        right: pair.right.band,
        distance,
      });
    }

    leftCounts.set(pair.left.band, (leftCounts.get(pair.left.band) ?? 0) + 1);
    rightCounts.set(pair.right.band, (rightCounts.get(pair.right.band) ?? 0) + 1);
  }

  const observed = matched / n;
  const expected = BANDS.reduce(
    (sum, band) =>
      sum + ((leftCounts.get(band) ?? 0) / n) * ((rightCounts.get(band) ?? 0) / n),
    0,
  );

  disagreements.sort((a, b) => b.distance - a.distance);

  return {
    n,
    observed,
    expected,
    ...kappaFor(observed, expected),
    withinOneBand: withinOne / n,
    disagreements,
  };
}

/**
 * κ = (observed − expected) / (1 − expected).
 *
 * The denominator goes to zero when both raters put every judgement in the same
 * single band. That is the corpus-with-no-spread trap, and it is the most
 * likely way to waste a day of hand-grading: five submissions that are all
 * roughly competent produce perfect observed agreement, expected agreement of
 * 1, and no information whatsoever. It returns `null` and says so rather than
 * dividing by zero and reporting a triumphant `NaN` or an accidental `0`.
 */
function kappaFor(
  observed: number,
  expected: number,
): { kappa: number | null; undefinedReason: string | null } {
  if (expected >= 1) {
    return {
      kappa: null,
      undefinedReason:
        "every judgement on both sides landed in one band, so there is no agreement above chance to measure — the corpus needs work that spans the range",
    };
  }
  return { kappa: (observed - expected) / (1 - expected), undefinedReason: null };
}

/** §24 E8 — the two numbers that have to clear. */
export const KAPPA_TARGET = 0.6;
export const STABILITY_TARGET = 0.85;

export interface Verdict {
  passed: boolean;
  lines: string[];
}

/**
 * What the two figures mean, in the words §17.3 would use.
 *
 * A κ under the bar is much more often a rubric whose bands a *human* cannot
 * separate either than it is a bad grader, which is why the middle band of this
 * verdict sends the reader back to the rubric rather than to the prompt.
 */
export function verdictFor(accuracy: Agreement, stability: Agreement): Verdict {
  const lines: string[] = [];

  if (accuracy.kappa === null) {
    lines.push(`κ: undefined — ${accuracy.undefinedReason}`);
  } else if (accuracy.kappa >= KAPPA_TARGET) {
    lines.push(`κ ${accuracy.kappa.toFixed(2)} ≥ ${KAPPA_TARGET} — E8's agreement criterion is met.`);
  } else if (accuracy.kappa >= 0.4) {
    lines.push(
      `κ ${accuracy.kappa.toFixed(2)} is under ${KAPPA_TARGET}. Read the disagreements before touching the prompt: this range is usually two rubric bands that a human cannot separate either.`,
    );
  } else {
    lines.push(
      `κ ${accuracy.kappa.toFixed(2)} is far under ${KAPPA_TARGET}. §17.3's kill criteria exist for this — the evaluation thesis is what is being tested here, and it is better to learn this now than at day 60.`,
    );
  }

  if (stability.n === 0) {
    lines.push("stability: not measured — the second run produced nothing to compare.");
  } else if (stability.withinOneBand >= STABILITY_TARGET) {
    lines.push(
      `stability ${(stability.withinOneBand * 100).toFixed(0)}% within one band ≥ ${STABILITY_TARGET * 100}% — E8's consistency criterion is met.`,
    );
  } else {
    lines.push(
      `stability ${(stability.withinOneBand * 100).toFixed(0)}% within one band is under ${STABILITY_TARGET * 100}%. Two learners handing in the same work would be told different things.`,
    );
  }

  const passed =
    accuracy.kappa !== null &&
    accuracy.kappa >= KAPPA_TARGET &&
    stability.n > 0 &&
    stability.withinOneBand >= STABILITY_TARGET;

  return { passed, lines };
}
