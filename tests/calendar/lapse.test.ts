import { describe, expect, it } from "vitest";
import { claimLapses, lapseDay, LAPSE_HORIZON_DAYS } from "@/lib/calendar/lapse";
import { effectiveMastery } from "@/lib/engine/bkt";
import { MASTERY_TARGET } from "@/lib/engine/scoring";
import type { LedgerEntry } from "@/lib/mastery/ledger";
import type { MasteryState } from "@/lib/engine";

/**
 * When a claim stops counting.
 *
 * The property that matters is not any particular date — it is that this agrees
 * with `effectiveMastery` exactly, because the product is only allowed one decay
 * rule and `/mastery` already reads it forwards. The first test asserts the two
 * are inverses; everything after it is a case that would otherwise be silently
 * wrong.
 */

/** Midnight, so a whole-day answer lands on a whole-day boundary. */
const NOW = "2026-08-14T00:00:00.000Z";

const state = (overrides: Partial<MasteryState> = {}): MasteryState => ({
  skillId: "metering",
  mastery: 1,
  confidence: 0.9,
  evidenceCount: 3,
  lastSuccessAt: NOW,
  lastPracticedAt: NOW,
  decayHalfLifeDays: 7,
  ...overrides,
});

describe("lapseDay", () => {
  it("is the exact inverse of the decay the planner scores on", () => {
    for (const half of [7, 14, 30, 180]) {
      for (const mastery of [0.86, 0.9, 0.95, 1]) {
        const claim = state({ mastery, decayHalfLifeDays: half });
        const day = lapseDay(claim, NOW)!;
        expect(day).toBeTypeOf("string");

        // On the day it names, the claim has gone; the day before, it holds.
        expect(effectiveMastery(claim, `${day}T00:00:00.000Z`)).toBeLessThan(
          MASTERY_TARGET,
        );
        const before = new Date(
          Date.parse(`${day}T00:00:00.000Z`) - 86_400_000,
        ).toISOString();
        expect(effectiveMastery(claim, before)).toBeGreaterThanOrEqual(
          MASTERY_TARGET,
        );
      }
    }
  });

  it("dates a fresh claim on a short interval within days", () => {
    // 1.0 at a seven-day half-life clears 0.85 for about 1.6 days.
    expect(lapseDay(state(), NOW)).toBe("2026-08-16");
  });

  it("dates a well-practised claim months out, not weeks", () => {
    expect(
      lapseDay(state({ mastery: 0.9, decayHalfLifeDays: 180 }), NOW),
    ).toBe("2026-08-29");
  });

  /**
   * The bound the stepping search rests on: at the 180-day cap and mastery of
   * 1, a claim survives 180 × log₂(1 ÷ 0.85) ≈ 42 days. If that ever stops
   * being true the search would silently start returning null instead of a date.
   */
  it("never has to look further than the horizon it searches", () => {
    const day = lapseDay(state({ decayHalfLifeDays: 180 }), NOW)!;
    const days = (Date.parse(`${day}T00:00:00.000Z`) - Date.parse(NOW)) / 86_400_000;
    expect(days).toBeLessThan(LAPSE_HORIZON_DAYS);
  });

  it("says nothing about a skill that is not a claim today", () => {
    // Already faded: `/mastery` puts this back on the path, and a calendar
    // mourning it a second time would be telling the learner it is still theirs.
    expect(lapseDay(state({ mastery: 0.5 }), NOW)).toBeNull();
  });

  it("says nothing about mastery with no success behind it", () => {
    // A pack prior above the bar is a guess about strangers, and nothing that
    // never decayed has a day on which it stops.
    expect(lapseDay(state({ lastSuccessAt: null }), NOW)).toBeNull();
  });
});

const claim = (slug: string, name: string): LedgerEntry => ({
  skillSlug: slug,
  name,
  statement: `You can ${name}`,
  standing: "shown",
  submissionId: "s1",
  artefacts: 1,
  confidence: 0.8,
  shownDaysAgo: 0,
  note: "Shown in the work you handed in.",
});

describe("claimLapses", () => {
  it("dates every claim that has a date", () => {
    expect(
      claimLapses({
        claims: [claim("metering", "Metering")],
        mastery: new Map([["metering", state()]]),
        now: NOW,
      }),
    ).toEqual([{ day: "2026-08-16", skillName: "Metering" }]);
  });

  it("drops a claim whose mastery row is not in front of it", () => {
    expect(
      claimLapses({
        claims: [claim("metering", "Metering")],
        mastery: new Map(),
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("drops a claim with nothing to decay", () => {
    expect(
      claimLapses({
        claims: [claim("metering", "Metering")],
        mastery: new Map([["metering", state({ lastSuccessAt: null })]]),
        now: NOW,
      }),
    ).toEqual([]);
  });
});
