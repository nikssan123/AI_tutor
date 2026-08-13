import { effectiveMastery } from "@/lib/engine/bkt";
import { MASTERY_TARGET } from "@/lib/engine/scoring";
import { dayOf, type DayKey } from "./dates";
import type { DueSkill } from "./schedule";
import type { LedgerEntry } from "@/lib/mastery/ledger";
import type { MasteryState } from "@/lib/engine";

/**
 * The day a claim stops counting.
 *
 * `/mastery` already asks the forward question — *would this still clear the bar
 * in a week* — and answers yes or no (`ledger.ts`, `slipping`). A calendar has to
 * answer *when*, which is the same curve read the other way round.
 *
 * **It is found by stepping, not by solving.** Inverting
 * `mastery × 0.5^(days / halfLife) = 0.85` algebraically would put a second
 * decay implementation in the product, and the note on `slipping` is explicit
 * about why that is not allowed: two rules eventually disagree in front of the
 * same learner, and the one on screen is the one they would believe. Stepping
 * asks `effectiveMastery` itself, so this cannot drift from the model the
 * planner scores on.
 *
 * Stepping is affordable because the answer is close by construction. The
 * longest a claim can survive is `halfLife × log₂(mastery ÷ 0.85)`, and with the
 * half-life capped at 180 days (§16.2) and mastery capped at 1, that is
 * 180 × log₂(1 ÷ 0.85) ≈ 42 days. Nothing here can loop for a year.
 */

/** Comfortably past the ~42 days a claim can survive at the 180-day cap. */
export const LAPSE_HORIZON_DAYS = 60;

export function lapseDay(state: MasteryState, nowIso: string): DayKey | null {
  // Not a claim today, so there is nothing to lose. `/mastery` calls this one
  // `faded` and puts the skill back on the path; it is not a dated event.
  if (effectiveMastery(state, nowIso) < MASTERY_TARGET) return null;

  const from = Date.parse(nowIso);
  for (let days = 1; days <= LAPSE_HORIZON_DAYS; days += 1) {
    const at = new Date(from + days * 86_400_000).toISOString();
    if (effectiveMastery(state, at) < MASTERY_TARGET) return dayOf(at);
  }

  // Reachable, and not a failure: a skill with no successful observation behind
  // it has nothing to decay from, so `effectiveMastery` returns the stored
  // number forever. A pack whose priors start a skill above the bar lands here.
  return null;
}

export interface LapseInput {
  /** `ledger.canDo` — the claims, and nothing else. */
  claims: LedgerEntry[];
  mastery: Map<string, MasteryState>;
  now: string;
}

/**
 * Dated lapses for the things the learner can actually claim.
 *
 * Driven off the ledger rather than off mastery directly, because §24 E9's rule
 * is that a claim needs a marked hand-in behind it. A skill sitting above the
 * bar on answered questions alone is *unproven*, not claimed — telling someone
 * it "stops counting" would be the calendar mourning something they were never
 * given.
 */
export function claimLapses(input: LapseInput): DueSkill[] {
  return input.claims.flatMap((claim) => {
    const state = input.mastery.get(claim.skillSlug);
    if (!state) return [];

    const day = lapseDay(state, input.now);
    return day === null ? [] : [{ day, skillName: claim.name }];
  });
}
