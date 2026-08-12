import { describe, expect, it } from "vitest";
import {
  applyObservation,
  clamp,
  daysBetween,
  effectiveMastery,
  initialMastery,
  INITIAL_HALF_LIFE_DAYS,
  MAX_HALF_LIFE_DAYS,
  nextHalfLife,
  retentionDecayFraction,
  updateMastery,
} from "@/lib/engine/bkt";
import type { BktPriors, EvalTier, MasteryState } from "@/lib/engine/types";

const PRIORS: BktPriors = { pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.2 };

function state(overrides: Partial<MasteryState> = {}): MasteryState {
  return {
    skillId: "s1",
    mastery: 0.5,
    confidence: 0.6,
    evidenceCount: 3,
    lastSuccessAt: "2026-08-01T00:00:00.000Z",
    lastPracticedAt: "2026-08-01T00:00:00.000Z",
    decayHalfLifeDays: INITIAL_HALF_LIFE_DAYS,
    ...overrides,
  };
}

describe("clamp", () => {
  it("bounds values into the unit interval by default", () => {
    expect(clamp(-1)).toBe(0);
    expect(clamp(2)).toBe(1);
    expect(clamp(0.4)).toBe(0.4);
  });

  it("honours explicit bounds", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, -2, 3)).toBe(-2);
  });

  it("treats NaN as the minimum rather than propagating it", () => {
    // A NaN loose in the mastery ledger would silently poison every later
    // update, so it is contained at the boundary.
    expect(clamp(Number.NaN)).toBe(0);
    expect(clamp(Number.NaN, 0.25)).toBe(0.25);
  });
});

describe("updateMastery", () => {
  it("raises mastery on a correct observation", () => {
    const result = updateMastery(0.5, PRIORS, {
      correct: true,
      confidence: 1,
      evidenceTier: 1,
    });
    expect(result.posterior).toBeGreaterThan(0.5);
    expect(result.delta).toBeGreaterThan(0);
    expect(result.ignoredAsEngagement).toBe(false);
  });

  it("lowers mastery on an incorrect observation", () => {
    const result = updateMastery(0.5, PRIORS, {
      correct: false,
      confidence: 1,
      evidenceTier: 1,
    });
    expect(result.posterior).toBeLessThan(0.5);
    expect(result.delta).toBeLessThan(0);
  });

  it("implements §16.2's formula exactly", () => {
    const p = 0.5;
    const { pSlip, pGuess, pLearn } = PRIORS;
    const pCorrect = p * (1 - pSlip) + (1 - p) * pGuess;
    const posterior = (p * (1 - pSlip)) / pCorrect;
    const expected = posterior + (1 - posterior) * pLearn;

    const result = updateMastery(p, PRIORS, {
      correct: true,
      confidence: 1,
      evidenceTier: 1,
    });
    expect(result.posterior).toBeCloseTo(expected, 12);
  });

  it("moves mastery less when the evidence is less confident (§7.2)", () => {
    const tier1 = updateMastery(0.5, PRIORS, {
      correct: true,
      confidence: 0.9,
      evidenceTier: 1,
    });
    const tier3 = updateMastery(0.5, PRIORS, {
      correct: true,
      confidence: 0.5,
      evidenceTier: 3,
    });
    expect(tier3.delta).toBeLessThan(tier1.delta);
  });

  it("clamps a prior that arrives outside the unit interval", () => {
    expect(
      updateMastery(1.4, PRIORS, {
        correct: true,
        confidence: 1,
        evidenceTier: 1,
      }).prior,
    ).toBe(1);
  });

  it("falls back to the prior rather than dividing by zero on degenerate priors", () => {
    // pSlip=1, pGuess=0 drives pCorrect to 0 for any p.
    const degenerate: BktPriors = {
      pInit: 0.5,
      pLearn: 0,
      pSlip: 1,
      pGuess: 0,
    };
    const correct = updateMastery(0.5, degenerate, {
      correct: true,
      confidence: 1,
      evidenceTier: 1,
    });
    expect(Number.isNaN(correct.posterior)).toBe(false);
    expect(correct.posterior).toBe(0.5);

    // pSlip=0, pGuess=1 drives pCorrect to 1.
    const inverse: BktPriors = { pInit: 0.5, pLearn: 0, pSlip: 0, pGuess: 1 };
    const incorrect = updateMastery(0.5, inverse, {
      correct: false,
      confidence: 1,
      evidenceTier: 1,
    });
    expect(Number.isNaN(incorrect.posterior)).toBe(false);
    expect(incorrect.posterior).toBe(0.5);
  });

  it("clamps an out-of-range confidence", () => {
    const result = updateMastery(0.5, PRIORS, {
      correct: true,
      confidence: 42,
      evidenceTier: 1,
    });
    expect(result.posterior).toBeLessThanOrEqual(1);
  });
});

describe("§7.2 hard rule: a Tier 5 observation can never raise mastery", () => {
  it("returns the prior unchanged for a correct tier-5 observation", () => {
    const result = updateMastery(0.42, PRIORS, {
      correct: true,
      confidence: 1,
      evidenceTier: 5,
    });
    expect(result.posterior).toBe(0.42);
    expect(result.delta).toBe(0);
    expect(result.ignoredAsEngagement).toBe(true);
  });

  it("holds no matter how many tier-5 observations arrive", () => {
    // This is the rule that stops the horizontal product from becoming a
    // plausible-sounding lie, so it is asserted under repetition, not once.
    let current = state({ mastery: 0.3, evidenceCount: 0 });
    for (let i = 0; i < 100; i += 1) {
      current = applyObservation(
        current,
        PRIORS,
        { correct: true, confidence: 1, evidenceTier: 5 },
        `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      ).state;
    }
    expect(current.mastery).toBe(0.3);
    expect(current.evidenceCount).toBe(0);
  });

  it("records engagement without touching the retention schedule", () => {
    const before = state({ decayHalfLifeDays: 28 });
    const { state: after, update } = applyObservation(
      before,
      PRIORS,
      { correct: true, confidence: 1, evidenceTier: 5 },
      "2026-08-12T09:00:00.000Z",
    );
    expect(update.ignoredAsEngagement).toBe(true);
    expect(after.lastPracticedAt).toBe("2026-08-12T09:00:00.000Z");
    expect(after.lastSuccessAt).toBe(before.lastSuccessAt);
    expect(after.decayHalfLifeDays).toBe(28);
    expect(after.mastery).toBe(before.mastery);
  });
});

describe("mastery is monotonic under repeated correct observations", () => {
  it("never decreases across a run of successes", () => {
    let current = 0.1;
    for (let i = 0; i < 50; i += 1) {
      const next = updateMastery(current, PRIORS, {
        correct: true,
        confidence: 1,
        evidenceTier: 1,
      }).posterior;
      expect(next).toBeGreaterThanOrEqual(current);
      current = next;
    }
    expect(current).toBeGreaterThan(0.9);
  });

  it("never exceeds 1 or falls below 0 for any tier or confidence", () => {
    const tiers: EvalTier[] = [1, 2, 3, 4, 5];
    for (const tier of tiers) {
      for (const confidence of [0, 0.25, 0.5, 0.75, 1]) {
        for (const correct of [true, false]) {
          for (const prior of [0, 0.01, 0.5, 0.99, 1]) {
            const { posterior } = updateMastery(prior, PRIORS, {
              correct,
              confidence,
              evidenceTier: tier,
            });
            expect(posterior).toBeGreaterThanOrEqual(0);
            expect(posterior).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe("nextHalfLife", () => {
  it("doubles on success and caps at 180 days", () => {
    expect(nextHalfLife(7, true)).toBe(14);
    expect(nextHalfLife(120, true)).toBe(180);
    expect(nextHalfLife(MAX_HALF_LIFE_DAYS, true)).toBe(MAX_HALF_LIFE_DAYS);
  });

  it("resets to the starting interval on failure", () => {
    expect(nextHalfLife(112, false)).toBe(INITIAL_HALF_LIFE_DAYS);
  });
});

describe("daysBetween", () => {
  it("measures elapsed days as a fraction", () => {
    expect(
      daysBetween("2026-08-01T00:00:00.000Z", "2026-08-08T00:00:00.000Z"),
    ).toBe(7);
    expect(
      daysBetween("2026-08-01T00:00:00.000Z", "2026-08-01T12:00:00.000Z"),
    ).toBe(0.5);
  });

  it("never returns a negative span", () => {
    expect(
      daysBetween("2026-08-08T00:00:00.000Z", "2026-08-01T00:00:00.000Z"),
    ).toBe(0);
  });

  it("returns 0 for an unparseable timestamp", () => {
    expect(daysBetween("not-a-date", "2026-08-01T00:00:00.000Z")).toBe(0);
    expect(daysBetween("2026-08-01T00:00:00.000Z", "nonsense")).toBe(0);
  });
});

describe("decay", () => {
  it("halves effective mastery after exactly one half-life", () => {
    const s = state({
      mastery: 0.8,
      decayHalfLifeDays: 7,
      lastSuccessAt: "2026-08-01T00:00:00.000Z",
    });
    expect(effectiveMastery(s, "2026-08-08T00:00:00.000Z")).toBeCloseTo(0.4, 10);
    expect(effectiveMastery(s, "2026-08-15T00:00:00.000Z")).toBeCloseTo(0.2, 10);
  });

  it("does not decay a skill that has never been demonstrated", () => {
    const s = state({ mastery: 0.25, lastSuccessAt: null });
    expect(effectiveMastery(s, "2027-01-01T00:00:00.000Z")).toBe(0.25);
  });

  it("falls back to the default half-life if a row carries a bad one", () => {
    const s = state({
      mastery: 0.8,
      decayHalfLifeDays: 0,
      lastSuccessAt: "2026-08-01T00:00:00.000Z",
    });
    expect(effectiveMastery(s, "2026-08-08T00:00:00.000Z")).toBeCloseTo(0.4, 10);
    expect(
      retentionDecayFraction(s, "2026-08-08T00:00:00.000Z"),
    ).toBeCloseTo(0.5, 10);
  });

  it("decays more slowly once the half-life has expanded", () => {
    const fresh = state({ mastery: 0.8, decayHalfLifeDays: 7 });
    const established = state({ mastery: 0.8, decayHalfLifeDays: 56 });
    const at = "2026-08-15T00:00:00.000Z";
    expect(effectiveMastery(established, at)).toBeGreaterThan(
      effectiveMastery(fresh, at),
    );
  });
});

describe("retentionDecayFraction", () => {
  it("is zero for a skill with no evidence yet", () => {
    expect(
      retentionDecayFraction(
        state({ evidenceCount: 0 }),
        "2026-09-01T00:00:00.000Z",
      ),
    ).toBe(0);
  });

  it("is zero for a skill that has never succeeded", () => {
    expect(
      retentionDecayFraction(
        state({ lastSuccessAt: null }),
        "2026-09-01T00:00:00.000Z",
      ),
    ).toBe(0);
  });

  it("reaches 0.5 after one half-life and rises toward 1", () => {
    const s = state({ decayHalfLifeDays: 7 });
    expect(
      retentionDecayFraction(s, "2026-08-08T00:00:00.000Z"),
    ).toBeCloseTo(0.5, 10);
    expect(
      retentionDecayFraction(s, "2026-10-01T00:00:00.000Z"),
    ).toBeGreaterThan(0.99);
  });
});

describe("initialMastery", () => {
  it("seeds from the skill's expert prior", () => {
    const seeded = initialMastery("s9", PRIORS);
    expect(seeded).toEqual({
      skillId: "s9",
      mastery: 0.2,
      confidence: 0.2,
      evidenceCount: 0,
      lastSuccessAt: null,
      lastPracticedAt: null,
      decayHalfLifeDays: INITIAL_HALF_LIFE_DAYS,
    });
  });
});

describe("applyObservation", () => {
  it("advances the whole row on a correct tier-1 observation", () => {
    const before = state({ mastery: 0.4, evidenceCount: 2, confidence: 0.5 });
    const { state: after, update } = applyObservation(
      before,
      PRIORS,
      { correct: true, confidence: 0.9, evidenceTier: 1 },
      "2026-08-12T09:00:00.000Z",
    );

    expect(after.mastery).toBe(update.posterior);
    expect(after.evidenceCount).toBe(3);
    expect(after.lastSuccessAt).toBe("2026-08-12T09:00:00.000Z");
    expect(after.lastPracticedAt).toBe("2026-08-12T09:00:00.000Z");
    expect(after.decayHalfLifeDays).toBe(14);
    expect(after.confidence).toBe(0.9);
  });

  it("keeps the prior success timestamp and resets the interval on failure", () => {
    const before = state({ decayHalfLifeDays: 56 });
    const { state: after } = applyObservation(
      before,
      PRIORS,
      { correct: false, confidence: 0.8, evidenceTier: 1 },
      "2026-08-12T09:00:00.000Z",
    );

    expect(after.lastSuccessAt).toBe(before.lastSuccessAt);
    expect(after.decayHalfLifeDays).toBe(INITIAL_HALF_LIFE_DAYS);
    expect(after.evidenceCount).toBe(before.evidenceCount + 1);
  });

  it("never lowers stored confidence", () => {
    const before = state({ confidence: 0.9 });
    const { state: after } = applyObservation(
      before,
      PRIORS,
      { correct: true, confidence: 0.3, evidenceTier: 3 },
      "2026-08-12T09:00:00.000Z",
    );
    expect(after.confidence).toBe(0.9);
  });
});
