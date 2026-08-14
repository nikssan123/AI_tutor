import { describe, expect, it } from "vitest";
import {
  agreementBetween,
  KAPPA_TARGET,
  STABILITY_TARGET,
  verdictFor,
  type Judgement,
} from "@/lib/evaluation/agreement";
import type { Band } from "@/lib/contracts/evaluation";

/**
 * The arithmetic behind §24 E8's last two acceptance criteria.
 *
 * Worth testing properly rather than eyeballing in a script, because it is the
 * number that decides whether the product's central claim is feasible — and
 * because the two ways it can mislead (a corpus with no spread, and a mispaired
 * corpus) both produce a confident-looking figure rather than an error.
 */

const j = (submissionId: string, criterionId: string, band: Band): Judgement => ({
  submissionId,
  criterionId,
  band,
});

describe("agreementBetween", () => {
  it("is κ = 1 when the two raters never differ", () => {
    const grades = [
      j("s1", "diagnosis", "strong"),
      j("s1", "improvement", "absent"),
      j("s2", "diagnosis", "competent"),
    ];
    const result = agreementBetween(grades, [...grades]);

    expect(result.n).toBe(3);
    expect(result.observed).toBe(1);
    expect(result.kappa).toBe(1);
    expect(result.withinOneBand).toBe(1);
    expect(result.disagreements).toEqual([]);
  });

  it("pairs on ids, not on order", () => {
    // A corpus hand-graded in a different order than it was run still lines up.
    const human = [j("s1", "a", "strong"), j("s2", "b", "absent")];
    const model = [j("s2", "b", "absent"), j("s1", "a", "strong")];
    expect(agreementBetween(human, model).kappa).toBe(1);
  });

  it("drops a judgement that appears on one side only", () => {
    // A half-graded corpus gets a smaller honest n, never a silent mispairing
    // against whatever happened to be at the same index.
    const human = [j("s1", "a", "strong"), j("s1", "b", "absent")];
    const model = [j("s1", "a", "strong")];

    const result = agreementBetween(human, model);
    expect(result.n).toBe(1);
    expect(result.observed).toBe(1);
  });

  it("reports κ as undefined, never as zero, when nothing varies", () => {
    // The trap: five submissions that are all roughly competent produce perfect
    // observed agreement and no information at all. Reporting 0 would read as
    // "the grader is useless"; reporting 1 would read as "ship it". Both are
    // wrong, and the instruction to the reader is "fix the corpus".
    const flat = [
      j("s1", "a", "competent"),
      j("s2", "a", "competent"),
      j("s3", "a", "competent"),
    ];
    const result = agreementBetween(flat, [...flat]);

    expect(result.observed).toBe(1);
    expect(result.kappa).toBeNull();
    expect(result.undefinedReason).toMatch(/spans the range/);
  });

  it("says so when nothing pairs at all", () => {
    const result = agreementBetween([j("s1", "a", "strong")], [j("s9", "z", "strong")]);
    expect(result.n).toBe(0);
    expect(result.kappa).toBeNull();
    expect(result.undefinedReason).toMatch(/ids match/);
  });

  it("discounts the agreement two raters would reach by chance", () => {
    // Both raters used "strong" three times in four and agree three times in
    // four. Raw agreement looks like 75%; almost all of it is chance, and κ is
    // what says so.
    const human = [
      j("s1", "a", "strong"),
      j("s2", "a", "strong"),
      j("s3", "a", "strong"),
      j("s4", "a", "absent"),
    ];
    const model = [
      j("s1", "a", "strong"),
      j("s2", "a", "strong"),
      j("s3", "a", "strong"),
      j("s4", "a", "strong"),
    ];

    const result = agreementBetween(human, model);
    expect(result.observed).toBe(0.75);
    expect(result.kappa!).toBeLessThan(result.observed);
    expect(result.kappa!).toBeCloseTo(0, 5);
  });

  it("separates 'the same band' from 'one band away'", () => {
    const human = [j("s1", "a", "competent"), j("s2", "a", "competent")];
    const model = [j("s1", "a", "strong"), j("s2", "a", "absent")];

    const result = agreementBetween(human, model);
    expect(result.observed).toBe(0);
    // competent→strong is adjacent; competent→absent is two apart.
    expect(result.withinOneBand).toBe(0.5);
  });

  it("lists the disagreements worst first, because that is the reading list", () => {
    const human = [
      j("s1", "near", "competent"),
      j("s2", "far", "strong"),
      j("s3", "same", "absent"),
    ];
    const model = [
      j("s1", "near", "developing"),
      j("s2", "far", "absent"),
      j("s3", "same", "absent"),
    ];

    const result = agreementBetween(human, model);
    expect(result.disagreements).toHaveLength(2);
    expect(result.disagreements[0]).toMatchObject({
      criterionId: "far",
      left: "strong",
      right: "absent",
      distance: 3,
    });
    expect(result.disagreements[1]!.distance).toBe(1);
  });
});

describe("verdictFor", () => {
  const perfect = (n: number): [Judgement[], Judgement[]] => {
    const bands: Band[] = ["absent", "developing", "competent", "strong"];
    const grades = Array.from({ length: n }, (_, i) =>
      j(`s${i}`, "a", bands[i % 4]!),
    );
    return [grades, [...grades]];
  };

  it("passes only when both criteria clear", () => {
    const [human, model] = perfect(8);
    const verdict = verdictFor(
      agreementBetween(human, model),
      agreementBetween(model, [...model]),
    );

    expect(verdict.passed).toBe(true);
    expect(verdict.lines[0]).toContain(String(KAPPA_TARGET));
    expect(verdict.lines[1]).toContain(String(STABILITY_TARGET * 100));
  });

  it("fails on an undefined κ rather than treating it as a pass", () => {
    const flat = [j("s1", "a", "competent"), j("s2", "a", "competent")];
    const verdict = verdictFor(
      agreementBetween(flat, [...flat]),
      agreementBetween(flat, [...flat]),
    );

    expect(verdict.passed).toBe(false);
    expect(verdict.lines[0]).toMatch(/undefined/);
  });

  it("sends a middling κ back to the rubric, not to the prompt", () => {
    // 0.4–0.6 is nearly always two bands a human cannot separate either, and
    // rewriting the prompt against an ambiguous rubric just moves the error.
    // Both raters spread evenly across the four bands, so pe = 0.25, and they
    // agree on 5 of 8: κ = (0.625 − 0.25) / 0.75 = 0.5.
    const human = [
      j("s1", "a", "absent"),
      j("s2", "a", "absent"),
      j("s3", "a", "developing"),
      j("s4", "a", "developing"),
      j("s5", "a", "competent"),
      j("s6", "a", "competent"),
      j("s7", "a", "strong"),
      j("s8", "a", "strong"),
    ];
    const model = [
      j("s1", "a", "absent"),
      j("s2", "a", "absent"),
      j("s3", "a", "developing"),
      j("s4", "a", "strong"),
      j("s5", "a", "competent"),
      j("s6", "a", "developing"),
      j("s7", "a", "strong"),
      j("s8", "a", "competent"),
    ];

    const accuracy = agreementBetween(human, model);
    expect(accuracy.kappa!).toBeGreaterThan(0.4);
    expect(accuracy.kappa!).toBeLessThan(KAPPA_TARGET);

    const verdict = verdictFor(accuracy, agreementBetween(model, [...model]));
    expect(verdict.passed).toBe(false);
    expect(verdict.lines[0]).toMatch(/rubric bands/);
  });

  it("invokes the kill criteria on a κ that is far under", () => {
    const human = [
      j("s1", "a", "strong"),
      j("s2", "a", "strong"),
      j("s3", "a", "absent"),
      j("s4", "a", "absent"),
    ];
    const model = [
      j("s1", "a", "absent"),
      j("s2", "a", "strong"),
      j("s3", "a", "strong"),
      j("s4", "a", "absent"),
    ];

    const verdict = verdictFor(
      agreementBetween(human, model),
      agreementBetween(model, [...model]),
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.lines[0]).toMatch(/§17\.3/);
  });

  it("fails, and says why, when the grader contradicts itself", () => {
    const [human, model] = perfect(4);
    const unstable = [
      j("s0", "a", "strong"),
      j("s1", "a", "strong"),
      j("s2", "a", "absent"),
      j("s3", "a", "absent"),
    ];

    const verdict = verdictFor(
      agreementBetween(human, model),
      agreementBetween(model, unstable),
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.lines[1]).toMatch(/told different things/);
  });

  it("says stability was not measured rather than implying it failed", () => {
    const [human, model] = perfect(4);
    const verdict = verdictFor(agreementBetween(human, model), agreementBetween([], []));

    expect(verdict.passed).toBe(false);
    expect(verdict.lines[1]).toMatch(/not measured/);
  });
});
