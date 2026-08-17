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
  EvaluationDraft,
  HUMAN_REVIEW_BELOW,
  TIER_CONFIDENCE,
  type Band,
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
  marks: "text",
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

/**
 * §24 E8.5 phase 2 — the image half of the evidence contract.
 *
 * The rule the whole epic is careful about: a locator is **weaker** evidence
 * than a quote and must never be reported as though it were the same thing. So
 * the cases that matter here are the ones where the weaker half could borrow the
 * stronger half's credibility — a locator pointing at a frame nobody handed in,
 * a `verifierPassed` widened to cover something no string match touched, and an
 * `image` criterion marked on a hand-in that carried no photograph at all.
 */
describe("verify, on evidence a string match cannot reach", () => {
  const marking = (id: string, marks: RubricCriterion["marks"], weight = 0.5) =>
    ({ ...criterion(id, weight), marks }) as RubricCriterion;

  const LOCATOR = {
    photograph: 1,
    where: "the top edge of the seam",
    observed: "the fold stands up from about halfway across",
  };

  const located = (
    criterionId: string,
    over: Partial<EvaluationDraft["criteria"][number]> = {},
  ): EvaluationDraft["criteria"][number] => ({
    criterionId,
    band: "competent",
    reasoning: "because of what the frame shows",
    locator: LOCATOR,
    ...over,
  });

  it("upholds an image criterion on a locator alone", () => {
    // The point of the phase: no quote is owed, and none is invented.
    const criteria = [marking("cut", "image"), marking("method", "text")];
    const result = verify(
      draftOf([
        located("cut"),
        verdict("method", "strong", "I aggregated the line items"),
      ]),
      criteria,
      ARTEFACT,
      2,
    );

    expect(result.upheld.map((u) => u.verdict.criterionId)).toEqual([
      "cut",
      "method",
    ]);
    expect(result.located).toEqual([{ criterionId: "cut", photograph: 1 }]);
  });

  it("throws out a locator pointing at a photograph nobody handed in", () => {
    // The image-shaped fabrication, and the one thing about a locator a computer
    // can settle. It is why the frame index is a number rather than prose.
    const result = verify(
      draftOf([located("cut", { locator: { ...LOCATOR, photograph: 4 } })]),
      [marking("cut", "image", 1)],
      ARTEFACT,
      3,
    );

    expect(result.upheld).toEqual([]);
    expect(result.invalidated[0]).toEqual({
      criterionId: "cut",
      reason: "photograph 4 was not handed in",
    });
  });

  it("throws out an image criterion that pointed at nothing", () => {
    const result = verify(
      draftOf([located("cut", { locator: undefined })]),
      [marking("cut", "image", 1)],
      ARTEFACT,
      1,
    );

    expect(result.invalidated[0]!.reason).toBe(
      "nothing in the photographs was pointed at",
    );
  });

  it("costs one criterion, not the evaluation, when a field arrives as null", () => {
    /*
     * A model asked for an optional field sometimes answers `null` rather than
     * omitting it. The contract accepts that shape so the deterministic step can
     * decide, because rejecting it in the schema fails the whole draft — and the
     * learner's evaluation is spent on `marker_unavailable` for a marking that
     * may be entirely sound. `AdviceList` records the day that happened.
     */
    const parsed = EvaluationDraft.safeParse({
      criteria: [
        { criterionId: "cut", band: "strong", evidence: null, reasoning: "seen" },
        {
          criterionId: "method",
          band: "competent",
          evidence: "I aggregated the line items",
          locator: null,
          reasoning: "quoted",
        },
      ],
      strengths: [],
      gaps: [],
      nextActions: [],
    });
    expect(parsed.success).toBe(true);

    const result = verify(
      parsed.data!,
      [marking("cut", "text"), marking("method", "text")],
      ARTEFACT,
    );

    expect(result.upheld.map((u) => u.verdict.criterionId)).toEqual(["method"]);
    expect(result.invalidated[0]!.reason).toBe(
      "the quoted evidence is not in the submitted work",
    );
  });

  it("throws out an image criterion when no photograph arrived", () => {
    /*
     * Neither half of the contract is left: no quote is owed and there is no
     * frame to point at. `score` renormalises over what survived, so this costs
     * coverage and confidence rather than marks — the honest consequence of
     * handing in less than the brief asked for.
     */
    const result = verify(
      draftOf([
        located("cut", { locator: undefined }),
        verdict("method", "strong", "I aggregated the line items"),
      ]),
      [marking("cut", "image"), marking("method", "text")],
      ARTEFACT,
      0,
    );

    expect(result.invalidated[0]!.reason).toBe(
      "judged from a photograph, and none was handed in",
    );
    expect(result.upheld.map((u) => u.verdict.criterionId)).toEqual(["method"]);
  });

  it("asks a both criterion for the quote as well as the frame", () => {
    const criteria = [marking("cut", "both", 1)];

    const quoted = verify(
      draftOf([
        located("cut", { evidence: "the grain stays one row per segment" }),
      ]),
      criteria,
      ARTEFACT,
      1,
    );
    expect(quoted.upheld).toHaveLength(1);

    const unquoted = verify(draftOf([located("cut")]), criteria, ARTEFACT, 1);
    expect(unquoted.invalidated[0]!.reason).toBe(
      "the quoted evidence is not in the submitted work",
    );
  });

  it("decides a both criterion on the write-up when no frame arrived", () => {
    /*
     * The collapse this epic had to avoid. `light-and-separation`'s four criteria
     * all read both halves; requiring a locator with no photograph in hand would
     * invalidate every one of them and turn a degraded verdict into no verdict.
     */
    const result = verify(
      draftOf([
        {
          criterionId: "cut",
          band: "competent",
          evidence: "the grain stays one row per segment",
          reasoning: "the write-up is what settled it",
        },
      ]),
      [marking("cut", "both", 1)],
      ARTEFACT,
      0,
    );

    expect(result.upheld).toHaveLength(1);
    expect(result.passed).toBe(true);
    expect(result.located).toEqual([]);
  });

  it("keeps only a locator it checked", () => {
    // A grader may hand one to a text criterion, or to a both criterion on a
    // hand-in with no frames. Nothing verified those, so they do not come out.
    const result = verify(
      draftOf([
        located("method", {
          evidence: "I aggregated the line items",
          band: "strong",
        }),
      ]),
      [marking("method", "text", 1)],
      ARTEFACT,
      2,
    );

    expect(result.upheld[0]!.locator).toBeNull();
    expect(result.located).toEqual([]);
  });

  it("keeps verifierPassed a statement about quotes only", () => {
    /*
     * The rule the whole phase turns on. Two image criteria were thrown out for
     * pointing at a frame that was not there — and every quote the rubric owns
     * was still returned and still found. Reporting `passed: false` would blame
     * the string match for something it never ran; reporting the image failure
     * *through* `passed` would make one boolean mean two things.
     */
    const result = verify(
      draftOf([
        located("cut", { locator: { ...LOCATOR, photograph: 9 } }),
        located("safety", { locator: { ...LOCATOR, photograph: 9 } }),
        verdict("method", "strong", "I aggregated the line items"),
      ]),
      [
        marking("cut", "image", 0.3),
        marking("safety", "image", 0.3),
        marking("method", "text", 0.4),
      ],
      ARTEFACT,
      1,
    );

    expect(result.passed).toBe(true);
    expect(result.invalidated).toHaveLength(2);
    expect(result.quotedWeight).toBe(1);
  });

  it("still fails verifierPassed when a quote it could check was missing", () => {
    // The narrowing must not become an escape hatch: a `text` criterion the
    // grader skipped is exactly what the boolean is for.
    const result = verify(
      draftOf([located("cut")]),
      [marking("cut", "image", 0.5), marking("method", "text", 0.5)],
      ARTEFACT,
      1,
    );

    expect(result.missing).toEqual(["method"]);
    expect(result.passed).toBe(false);
  });

  it("reports how much of the score a quote actually anchors", () => {
    const result = verify(
      draftOf([
        located("cut"),
        verdict("method", "strong", "I aggregated the line items"),
      ]),
      [marking("cut", "image", 0.75), marking("method", "text", 0.25)],
      ARTEFACT,
      1,
    );

    expect(result.quotedWeight).toBeCloseTo(0.25);
  });

  it("calls a verdict with nothing in it fully quoted rather than not at all", () => {
    // There is no verdict for the share to qualify, and `confidenceFor` already
    // refuses an empty draft any credit on its own terms — a 0 here would
    // subtract the same thing twice.
    expect(verify(draftOf([]), CRITERIA, ARTEFACT).quotedWeight).toBe(1);
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

  it("will not let a locator inherit a quote's credibility", () => {
    /*
     * §24 E8.5 phase 2, and §4.2 law 3 turned on our own confidence number.
     * Both verdicts below are clean: every quote either rubric owns was returned
     * and found. But one of them rests three quarters of its score on
     * photographs nothing deterministic can check, and a number that came out
     * the same for both would be saying those two verdicts are equally well
     * evidenced.
     */
    const anchored = verify(
      draftOf([
        verdict("grain", "strong", "GROUP BY c.segment"),
        verdict("checked", "competent", "I aggregated the line items"),
      ]),
      CRITERIA,
      ARTEFACT,
      1,
    );

    const looked = verify(
      draftOf([
        {
          criterionId: "grain",
          band: "strong",
          reasoning: "what the frame shows",
          locator: { photograph: 1, where: "the top edge", observed: "flat" },
        },
        verdict("checked", "competent", "I aggregated the line items"),
      ]),
      [
        { ...criterion("grain", 0.75), marks: "image" },
        criterion("checked", 0.25),
      ],
      ARTEFACT,
      1,
    );

    expect(anchored.passed).toBe(true);
    expect(looked.passed).toBe(true);

    expect(
      confidenceFor({ tier: 3, verification: looked, coverage: 1, bandSpread: 0 }),
    ).toBeLessThan(
      confidenceFor({
        tier: 3,
        verification: anchored,
        coverage: 1,
        bandSpread: 0,
      }),
    );
  });

  it("leaves a prose verdict's confidence exactly where it was", () => {
    // The scaling is 1 on every submission before this epic, which is the only
    // reason it can be introduced without reinterpreting the stored corpus §21
    // measures κ against.
    expect(clean.quotedWeight).toBe(1);
    expect(
      confidenceFor({ tier: 2, verification: clean, coverage: 1, bandSpread: 0 }),
    ).toBe(TIER_CONFIDENCE[2]!.max);
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
