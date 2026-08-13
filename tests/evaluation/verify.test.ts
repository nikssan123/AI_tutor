import { describe, expect, it } from "vitest";
import {
  confidenceFor,
  needsHumanReview,
  normalise,
  observationFrom,
  quoteAppearsIn,
  score,
  verify,
} from "@/lib/evaluation/verify";
import {
  BAND_SCORE,
  HUMAN_REVIEW_BELOW,
  TIER_CONFIDENCE,
  type Band,
  type EvaluationDraft,
} from "@/lib/contracts/evaluation";
import type { RubricCriterion } from "@/lib/packs/types";

/**
 * §14.5's non-negotiable rule: **every criterion score must quote the
 * artefact.** This file is that rule.
 *
 * It is the difference between "we mark your work" and "we produce text about
 * your work", so the cases that matter most here are the dishonest ones — a
 * quote that was never in the submission, a criterion the rubric does not have,
 * a grader marking the same thing twice.
 */

const criterion = (id: string, weight: number): RubricCriterion => ({
  id,
  name: `Criterion ${id}`,
  description: "What this one judges, at length.",
  weight,
  bands: {
    absent: "absent",
    developing: "developing",
    competent: "competent",
    strong: "strong",
  },
});

const CRITERIA = [criterion("grain", 0.5), criterion("checked", 0.5)];

const ARTEFACT = `SELECT c.segment, SUM(oi.quantity * oi.unit_price) AS revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
GROUP BY c.segment;

I aggregated the line items rather than the order total, so the grain stays
one row per segment.`;

const verdict = (
  criterionId: string,
  band: Band,
  evidence: string,
): EvaluationDraft["criteria"][number] => ({
  criterionId,
  band,
  evidence,
  reasoning: "because of the thing quoted above",
});

const draftOf = (
  criteria: EvaluationDraft["criteria"],
): EvaluationDraft => ({
  criteria,
  strengths: [],
  gaps: [],
  nextActions: [],
});

describe("quoteAppearsIn", () => {
  it("accepts a span copied out of the work", () => {
    expect(quoteAppearsIn(ARTEFACT, "GROUP BY c.segment")).toBe(true);
  });

  it("accepts a quote the model reflowed", () => {
    /*
     * A model turns a line break into a space and drops indentation when it
     * quotes. Matching on the normalised form accepts that and nothing else —
     * the words, in order, still have to be there.
     */
    expect(
      quoteAppearsIn(ARTEFACT, "the grain stays one row per segment"),
    ).toBe(true);
  });

  it("is case-insensitive, because quoting is not transcription", () => {
    expect(quoteAppearsIn(ARTEFACT, "group by c.segment")).toBe(true);
  });

  it("rejects a quote that is not in the work", () => {
    // The failure the whole step exists to catch.
    expect(
      quoteAppearsIn(ARTEFACT, "I ran EXPLAIN ANALYZE and checked the plan"),
    ).toBe(false);
  });

  it("rejects a plausible near-miss", () => {
    // A fabrication differs by more than whitespace, which is exactly why
    // normalising does not weaken the check.
    expect(quoteAppearsIn(ARTEFACT, "GROUP BY c.channel")).toBe(false);
  });

  it("rejects an empty quote, which would otherwise match everything", () => {
    expect(quoteAppearsIn(ARTEFACT, "   ")).toBe(false);
  });

  it("normalises runs of whitespace to one space", () => {
    expect(normalise("  a \n\n  b\t c ")).toBe("a b c");
  });
});

describe("verify", () => {
  it("upholds criteria whose evidence is in the work", () => {
    const result = verify(
      draftOf([
        verdict("grain", "strong", "the grain stays one row per segment"),
        verdict("checked", "developing", "I aggregated the line items"),
      ]),
      CRITERIA,
      ARTEFACT,
    );

    expect(result.passed).toBe(true);
    expect(result.upheld).toHaveLength(2);
    expect(result.invalidated).toEqual([]);
  });

  it("throws out a criterion whose quote was invented", () => {
    const result = verify(
      draftOf([
        verdict("grain", "strong", "the grain stays one row per segment"),
        verdict("checked", "strong", "I wrote a test that asserts the totals"),
      ]),
      CRITERIA,
      ARTEFACT,
    );

    expect(result.passed).toBe(false);
    expect(result.upheld.map((u) => u.verdict.criterionId)).toEqual(["grain"]);
    expect(result.invalidated).toEqual([
      {
        criterionId: "checked",
        reason: "the quoted evidence is not in the submitted work",
      },
    ]);
  });

  it("throws out a criterion the rubric does not contain", () => {
    // A grader inventing a criterion is grading a different rubric.
    const result = verify(
      draftOf([verdict("elegance", "strong", "GROUP BY c.segment")]),
      CRITERIA,
      ARTEFACT,
    );

    expect(result.invalidated[0]).toMatchObject({
      criterionId: "elegance",
      reason: "the rubric has no such criterion",
    });
  });

  it("keeps only the first verdict when one is scored twice", () => {
    const result = verify(
      draftOf([
        verdict("grain", "strong", "GROUP BY c.segment"),
        verdict("grain", "absent", "JOIN order_items oi"),
      ]),
      CRITERIA,
      ARTEFACT,
    );

    expect(result.upheld).toHaveLength(1);
    expect(result.upheld[0]!.verdict.band).toBe("strong");
    expect(result.invalidated[0]!.reason).toBe("scored more than once");
  });

  it("reports a criterion the grader never answered", () => {
    const result = verify(
      draftOf([verdict("grain", "strong", "GROUP BY c.segment")]),
      CRITERIA,
      ARTEFACT,
    );

    expect(result.missing).toEqual(["checked"]);
    expect(result.passed).toBe(false);
  });

  it("passes only when the whole rubric was answered and every quote holds", () => {
    const result = verify(
      draftOf([
        verdict("grain", "strong", "GROUP BY c.segment"),
        verdict("checked", "competent", "I aggregated the line items"),
      ]),
      CRITERIA,
      ARTEFACT,
    );
    expect(result.passed).toBe(true);
  });
});

describe("score", () => {
  const upheldOf = (bands: Array<[string, Band, number]>) =>
    verify(
      draftOf(
        bands.map(([id, band]) =>
          verdict(id, band, "the grain stays one row per segment"),
        ),
      ),
      bands.map(([id, , weight]) => criterion(id, weight)),
      ARTEFACT,
    ).upheld;

  it("weights by the rubric's own weights", () => {
    const scored = score(
      upheldOf([
        ["a", "strong", 0.75],
        ["b", "absent", 0.25],
      ]),
    );
    expect(scored.overall).toBeCloseTo(0.75);
  });

  it("renormalises over what survived rather than scoring gaps as zero", () => {
    /*
     * A criterion the verifier threw out is one we know nothing about.
     * Counting it as zero would fail a learner for the grader's mistake, so
     * the coverage is reported instead and confidence carries the doubt.
     */
    const upheld = upheldOf([["a", "strong", 0.5]]);
    const scored = score(upheld);

    expect(scored.overall).toBe(1);
    expect(scored.coverage).toBe(0.5);
  });

  it("returns nothing rather than dividing by zero when all evidence failed", () => {
    expect(score([])).toEqual({ overall: 0, coverage: 0 });
  });

  it("puts each band where the contract says", () => {
    for (const band of ["absent", "developing", "competent", "strong"] as const) {
      const scored = score(upheldOf([["a", band, 1]]));
      expect(scored.overall).toBeCloseTo(BAND_SCORE[band]);
    }
  });
});

describe("confidenceFor", () => {
  const clean = verify(
    draftOf([
      verdict("grain", "strong", "GROUP BY c.segment"),
      verdict("checked", "competent", "I aggregated the line items"),
    ]),
    CRITERIA,
    ARTEFACT,
  );

  const dirty = verify(
    draftOf([
      verdict("grain", "strong", "GROUP BY c.segment"),
      verdict("checked", "strong", "I wrote a test asserting the totals"),
    ]),
    CRITERIA,
    ARTEFACT,
  );

  it("never exceeds what the evidence type can support (§7.2)", () => {
    /*
     * The rule that stops the horizontal product from overclaiming: no amount
     * of internal agreement turns a photograph into an executed test.
     */
    for (const tier of [1, 2, 3, 4] as const) {
      const best = confidenceFor({
        tier,
        verification: clean,
        coverage: 1,
        bandSpread: 0,
      });
      expect(best).toBeLessThanOrEqual(TIER_CONFIDENCE[tier]!.max);
      expect(best).toBeGreaterThanOrEqual(TIER_CONFIDENCE[tier]!.min);
    }
  });

  it("gives a tier-5 observation no confidence at all", () => {
    // §7.2 — self-report is logged as engagement and never scored.
    expect(
      confidenceFor({ tier: 5, verification: clean, coverage: 1, bandSpread: 0 }),
    ).toBe(0);
  });

  it("rates a clean verifier pass above one with evidence thrown out", () => {
    const good = confidenceFor({ tier: 2, verification: clean, coverage: 1 });
    const bad = confidenceFor({ tier: 2, verification: dirty, coverage: 0.5 });
    expect(good).toBeGreaterThan(bad);
  });

  it("rewards two passes landing in the same band", () => {
    const agreed = confidenceFor({
      tier: 2,
      verification: clean,
      coverage: 1,
      bandSpread: 0,
    });
    const apart = confidenceFor({
      tier: 2,
      verification: clean,
      coverage: 1,
      bandSpread: 2,
    });
    expect(agreed).toBeGreaterThan(apart);
  });

  it("treats one band of disagreement as better than two", () => {
    const near = confidenceFor({
      tier: 2,
      verification: clean,
      coverage: 1,
      bandSpread: 1,
    });
    const far = confidenceFor({
      tier: 2,
      verification: clean,
      coverage: 1,
      bandSpread: 3,
    });
    expect(near).toBeGreaterThan(far);
  });

  it("gives a grader that returned nothing no credit for inventing nothing", () => {
    /*
     * Without this, an empty draft scores as a clean run: it invalidated no
     * quotes because it made none. An evaluation with no evidence behind it
     * must not come out looking trustworthy.
     */
    const nothing = verify(draftOf([]), CRITERIA, ARTEFACT);
    expect(
      confidenceFor({ tier: 3, verification: nothing, coverage: 0 }),
    ).toBe(TIER_CONFIDENCE[3]!.min);
  });

  it("credits a partial pass that at least invented nothing", () => {
    // Missing criteria are a smaller sin than fabricated ones, and the numbers
    // say so rather than treating both as simply "not passed".
    const partial = verify(
      draftOf([verdict("grain", "strong", "GROUP BY c.segment")]),
      CRITERIA,
      ARTEFACT,
    );
    expect(confidenceFor({ tier: 2, verification: partial, coverage: 0.5 }))
      .toBeGreaterThan(
        confidenceFor({ tier: 2, verification: dirty, coverage: 0.5 }),
      );
  });
});

describe("needsHumanReview", () => {
  it("sends anything under the threshold to a person (§14.5 step 8)", () => {
    expect(needsHumanReview(HUMAN_REVIEW_BELOW - 0.01)).toBe(true);
    expect(needsHumanReview(HUMAN_REVIEW_BELOW)).toBe(false);
  });

  it("always sends tier-5 work, which has no confidence by definition", () => {
    expect(needsHumanReview(0)).toBe(true);
  });
});

describe("observationFrom", () => {
  it("counts work at the competent band as demonstrating the skill", () => {
    // The line the rubric itself draws, and the learner read it first.
    expect(observationFrom(BAND_SCORE.competent, 0.8, 2).correct).toBe(true);
    expect(observationFrom(BAND_SCORE.developing, 0.8, 2).correct).toBe(false);
  });

  it("carries the tier through so the mastery model can apply §7.2", () => {
    expect(observationFrom(1, 0.9, 5)).toEqual({
      correct: true,
      confidence: 0.9,
      evidenceTier: 5,
    });
  });

  it("weights the update by confidence rather than by the score", () => {
    expect(observationFrom(1, 0.55, 3).confidence).toBe(0.55);
  });
});
