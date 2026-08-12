import type { BktPriors, EvalTier, MasteryState } from "./types";

/**
 * §16.2 — Bayesian Knowledge Tracing with decay.
 *
 * BKT still outperforms LLM-only approaches in production, and — unlike a model
 * asked to "estimate how well they know this" — it is inspectable, testable and
 * identical on every run. There is no LLM call anywhere in this file.
 */

export const MASTERY_FLOOR = 0;
export const MASTERY_CEILING = 1;

/** §16.2 — the expanding-interval mechanism. */
export const INITIAL_HALF_LIFE_DAYS = 7;
export const MAX_HALF_LIFE_DAYS = 180;

export function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export interface Observation {
  correct: boolean;
  /** 0..1 — how much this observation should move the belief (§7.2). */
  confidence: number;
  /** §7.2 — a tier-5 observation can never raise mastery. */
  evidenceTier: EvalTier;
}

export interface MasteryUpdateResult {
  prior: number;
  posterior: number;
  delta: number;
  /**
   * True when the observation was logged but deliberately did not move mastery.
   * §7.2's hard rule: "a Tier 5 observation can never raise a mastery score.
   * It is logged as engagement, nothing more."
   */
  ignoredAsEngagement: boolean;
}

/**
 * The BKT update from §16.2, verbatim:
 *
 *   pCorrect  = p·(1 − pSlip) + (1 − p)·pGuess
 *   posterior = correct ? p·(1 − pSlip)/pCorrect
 *                       : p·pSlip/(1 − pCorrect)
 *   p'        = posterior + (1 − posterior)·pLearn
 *   p_new     = p + c·(p' − p)
 *
 * The final line is the confidence blend: a Tier 3 verdict moves mastery less
 * than a Tier 1 one, because `c` carries the evidence tier's confidence.
 */
export function updateMastery(
  prior: number,
  priors: BktPriors,
  observation: Observation,
): MasteryUpdateResult {
  const p = clamp(prior);

  // §7.2 hard rule, enforced in code rather than in a prompt. This is the single
  // rule that stops the horizontal product from becoming a plausible-sounding lie.
  if (observation.evidenceTier === 5) {
    return {
      prior: p,
      posterior: p,
      delta: 0,
      ignoredAsEngagement: true,
    };
  }

  const { pSlip, pGuess, pLearn } = priors;
  const pCorrect = p * (1 - pSlip) + (1 - p) * pGuess;

  // Degenerate priors (pSlip = 1 with pGuess = 0, say) can drive pCorrect to 0
  // or 1, making the Bayes step divide by zero. Fall back to the prior rather
  // than emitting NaN — a NaN here would silently poison the whole ledger.
  let posterior: number;
  if (observation.correct) {
    posterior = pCorrect === 0 ? p : (p * (1 - pSlip)) / pCorrect;
  } else {
    posterior = pCorrect === 1 ? p : (p * pSlip) / (1 - pCorrect);
  }
  posterior = clamp(posterior);

  const learned = posterior + (1 - posterior) * pLearn;
  const blended = p + clamp(observation.confidence) * (learned - p);
  const next = clamp(blended);

  return {
    prior: p,
    posterior: next,
    delta: next - p,
    ignoredAsEngagement: false,
  };
}

/**
 * §16.2 — expanding intervals. The half-life doubles on each *successful*
 * spaced retrieval and is capped at 180 days; a failure resets it to the
 * starting interval, which is what makes an unreliable skill come back sooner.
 */
export function nextHalfLife(
  currentHalfLifeDays: number,
  succeeded: boolean,
): number {
  if (!succeeded) return INITIAL_HALF_LIFE_DAYS;
  return Math.min(MAX_HALF_LIFE_DAYS, currentHalfLifeDays * 2);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, (to - from) / 86_400_000);
}

/**
 * §16.2 — `mastery_effective = mastery × 0.5^(daysSinceLastSuccess / halfLife)`.
 *
 * Computed at read time rather than stored, so it is always current without a
 * decay cron. A skill with no successful observation yet has nothing to decay.
 */
export function effectiveMastery(state: MasteryState, nowIso: string): number {
  if (state.lastSuccessAt === null) return clamp(state.mastery);
  const days = daysBetween(state.lastSuccessAt, nowIso);
  const halfLife = state.decayHalfLifeDays > 0
    ? state.decayHalfLifeDays
    : INITIAL_HALF_LIFE_DAYS;
  return clamp(state.mastery * Math.pow(0.5, days / halfLife));
}

/**
 * The share of retention already lost to decay, 0..1. This is what drives
 * `retentionUrgency` in the planner (§16.1), which is why spaced repetition
 * falls out of the mastery model rather than being bolted on beside it.
 */
export function retentionDecayFraction(
  state: MasteryState,
  nowIso: string,
): number {
  if (state.evidenceCount === 0 || state.lastSuccessAt === null) return 0;
  const days = daysBetween(state.lastSuccessAt, nowIso);
  const halfLife = state.decayHalfLifeDays > 0
    ? state.decayHalfLifeDays
    : INITIAL_HALF_LIFE_DAYS;
  return clamp(1 - Math.pow(0.5, days / halfLife));
}

/** A fresh mastery row seeded from the skill's expert priors. */
export function initialMastery(
  skillId: string,
  priors: BktPriors,
): MasteryState {
  return {
    skillId,
    mastery: clamp(priors.pInit),
    confidence: 0.2,
    evidenceCount: 0,
    lastSuccessAt: null,
    lastPracticedAt: null,
    decayHalfLifeDays: INITIAL_HALF_LIFE_DAYS,
  };
}

/**
 * Applies one observation to a full mastery row, returning the new row plus the
 * audit record. Every mastery change in the product flows through here, which
 * is what makes §4.2 law 1 ("no mastery without evidence") mechanically true.
 */
export function applyObservation(
  state: MasteryState,
  priors: BktPriors,
  observation: Observation,
  atIso: string,
): { state: MasteryState; update: MasteryUpdateResult } {
  const update = updateMastery(state.mastery, priors, observation);

  if (update.ignoredAsEngagement) {
    // Practice is recorded — the learner did something — but neither mastery,
    // the evidence count, nor the retention schedule moves.
    return {
      state: { ...state, lastPracticedAt: atIso },
      update,
    };
  }

  return {
    state: {
      ...state,
      mastery: update.posterior,
      confidence: clamp(
        Math.max(state.confidence, observation.confidence),
      ),
      evidenceCount: state.evidenceCount + 1,
      lastSuccessAt: observation.correct ? atIso : state.lastSuccessAt,
      lastPracticedAt: atIso,
      decayHalfLifeDays: nextHalfLife(
        state.decayHalfLifeDays,
        observation.correct,
      ),
    },
    update,
  };
}
