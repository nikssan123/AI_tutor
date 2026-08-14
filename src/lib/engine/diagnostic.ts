import { applyObservation, effectiveMastery, initialMastery } from "./bkt";
import {
  ARTEFACT_CONFIDENCE,
  CHECK_CONFIDENCE,
  evidenceTierFor,
  MASTERY_TARGET,
} from "./scoring";
import type { BktPriors, EvalTier, MasteryState } from "./types";

/**
 * §24 E4 — the adaptive Skill Check.
 *
 * **The decisions are still deterministic and always will be.** Item selection
 * is a pure function of the current posterior, closed grading is an equality
 * test, and every mastery move goes through the same `applyObservation` the
 * planner uses. §14.1's rule holds exactly: the model is a sensor, never the
 * decision.
 *
 * What changed is what the sensor can see. This module was written to run with
 * no LLM in the path at all — shippable before `ANTHROPIC_API_KEY` existed —
 * and the honest consequence was that a machine with no evaluator can only
 * verify a *closed* item. Production items ("explain this", "write this") were
 * shown, answered, and then marked by the learner against a revealed key, which
 * §7.2 calls Tier 5 and therefore never moved mastery.
 *
 * That was the right call while it was true and it stopped being true. Measured
 * across the seven packs: **only 15–35% of skills carry even one closed item,
 * and no skill anywhere carries three** — so a check that can only verify
 * closed items reports on four to seven skills of a twenty-six-skill subject
 * and cannot lift any of them to the bar the planner skips at. §14.2's
 * Assessment Agent ("Haiku 4.5 *only* to grade free-text") is the piece that
 * was always meant to close that, and `session/grade.ts` had already built it
 * for the signed-in session.
 *
 * So an answer now has four possible fates, and the mode is recorded rather
 * than inferred: `auto` when a closed item was checked, `graded` when the model
 * marked prose, `artefact` when it marked a piece of work the learner made
 * (§7.3's photograph, on the deep check), and `self` when none of those could
 * happen — no key, no budget, or a call that failed. **The Tier 5 rule is
 * untouched**: a self-marked answer still moves nothing, and the check still
 * says plainly which of its answers counted.
 */

/** How a response to this item can honestly be judged with no evaluator. */
export type GradingMode = "auto" | "self" | "excluded";

/**
 * `mcq` carries a correct-option index, so it is decidable. Everything else
 * either has a concept list rather than an answer (`short_text`, `code_read`),
 * is open prose (`explain`), or is a piece of work that has to be produced and
 * looked at (`micro_artifact`) — that last one belongs to a project brief, not
 * to a ten-minute check, so it is left out entirely.
 */
export function gradingModeFor(type: string): GradingMode {
  if (type === "mcq") return "auto";
  if (type === "micro_artifact") return "excluded";
  return "self";
}

export interface DiagnosticItem {
  slug: string;
  skill: string;
  type: string;
  difficulty: number;
  discrimination: number;
  prompt: string;
  options?: string[] | undefined;
  answerKey?: unknown;
}

export interface DiagnosticSkill {
  slug: string;
  name: string;
  priors: BktPriors;
  /**
   * §7.2's tier for the skill itself, so a marked written answer cannot claim
   * more than the domain allows: `evidenceTierFor` caps a written answer at
   * Tier 2, and a Tier 3 photography skill stays Tier 3 however well the
   * learner writes about it.
   */
  evalTier: EvalTier;
}

export interface AskedItem {
  itemSlug: string;
  skillSlug: string;
  /**
   * How the answer was decided. `auto` is an equality test on a closed item,
   * `graded` is §14.2's Assessment Agent marking prose, `artefact` is the same
   * agent marking a piece of work the learner made, and `self` is the learner
   * marking themselves against a revealed key — which §7.2 calls Tier 5 and
   * which therefore never moves mastery.
   */
  mode: "auto" | "graded" | "artefact" | "self";
  correct: boolean;
}

export interface DiagnosticState {
  mastery: Record<string, MasteryState>;
  asked: AskedItem[];
}

/** §8 screen 3 — "eight to twelve minutes", which is about nine items. */
export const DEFAULT_BUDGET = 9;

/**
 * The same figure as a duration, for the copy and for the `Quiz` markup.
 *
 * A constant because it is now said in two places that are validated by
 * different things — a sentence a person reads, and a `timeRequired` Google
 * reads — and §13.3's rule is that the markup must not claim anything the page
 * does not. Two literals would satisfy that rule on the day they were written
 * and nobody would check again.
 */
export const CHECK_MINUTES = 10;

/**
 * A closed item is checked, so it is Tier 1 evidence — but a single
 * multiple-choice answer is recognition, not production, so it moves the belief
 * at partial confidence rather than fully. The guessing correction itself lives
 * in the BKT's `pGuess`, not here.
 */
const AUTO_CONFIDENCE = 0.7;

export function startDiagnostic(skills: DiagnosticSkill[]): DiagnosticState {
  const mastery: Record<string, MasteryState> = {};
  for (const skill of skills) {
    mastery[skill.slug] = initialMastery(skill.slug, skill.priors);
  }
  return { mastery, asked: [] };
}

/** Peaks at 0.5, where the belief is least settled and a question tells us most. */
export function uncertainty(posterior: number): number {
  return 1 - Math.abs(2 * posterior - 1);
}

export function observationsFor(state: DiagnosticState, skillSlug: string): number {
  return state.asked.filter((a) => a.skillSlug === skillSlug).length;
}

/** How much a single item would tell us about a skill sitting at `posterior`. */
export function informationValue(
  item: DiagnosticItem,
  posterior: number,
): number {
  const fit = 1 - Math.abs(item.difficulty - posterior);
  return uncertainty(posterior) * fit * item.discrimination;
}

/**
 * What this particular check is allowed to ask for.
 *
 * The engine picks the most informative *answerable* item, and what is
 * answerable is a property of the surface rather than of the engine. A
 * ten-minute check across a whole subject cannot ask someone to go and take a
 * photograph; a check for one skill, which somebody opened deliberately to
 * prove that skill, can.
 */
export interface CheckScope {
  /**
   * Whether `micro_artifact` items are on the table — the ones that ask for a
   * piece of work rather than an answer. Off by default, which is the broad
   * check's behaviour and was the engine's only behaviour.
   */
  artefacts?: boolean;
}

/**
 * A skill nothing more can be learned about by asking again.
 *
 * Two ways to be settled, and both are worth stopping on: the belief has
 * cleared the bar the planner skips at, so more questions cannot change what
 * happens next; or the check has already spent `MAX_PER_SKILL` questions on it,
 * which on a nine-question budget is most of the check.
 *
 * This is the concentration rule. Without it a check will happily ask a second
 * question about a skill it has already decided while another skill has none —
 * which is the whole of what "adaptive" was supposed to prevent.
 */
export const MAX_PER_SKILL = 5;

export function settled(state: DiagnosticState, skillSlug: string): boolean {
  // Asserted: every caller has already established that the skill is in the
  // state — `selectNextItem` filters on it in the same expression, and the page
  // asks about the skill it started the diagnostic with.
  return (
    state.mastery[skillSlug]!.mastery >= MASTERY_TARGET ||
    observationsFor(state, skillSlug) >= MAX_PER_SKILL
  );
}

/**
 * Picks the next question as a pure function of state.
 *
 * **Coverage first, information second, and nothing at all about a skill that
 * is already decided.** Breadth is a hard rule rather than a weight, because it
 * kept losing to one: answering a skill correctly moves its posterior *towards*
 * 0.5, which is exactly where an item is most informative, so a purely
 * information-greedy check spends all nine questions deepening the one skill it
 * just asked about.
 *
 * So: settled skills are out; among the rest, fewest observations wins
 * outright; among equals, the most informative item; ties break on slug. The
 * same state always yields the same question, which matters when someone
 * disputes a result.
 */
export function selectNextItem(
  state: DiagnosticState,
  items: DiagnosticItem[],
  scope: CheckScope = {},
): DiagnosticItem | undefined {
  const seen = new Set(state.asked.map((a) => a.itemSlug));

  const candidates = items.filter(
    (item) =>
      !seen.has(item.slug) &&
      (gradingModeFor(item.type) !== "excluded" || scope.artefacts === true) &&
      state.mastery[item.skill] !== undefined &&
      !settled(state, item.skill),
  );

  let best: { item: DiagnosticItem; asked: number; info: number } | undefined;

  for (const item of candidates) {
    const asked = observationsFor(state, item.skill);
    const info = informationValue(item, state.mastery[item.skill]!.mastery);

    const better =
      !best ||
      asked < best.asked ||
      (asked === best.asked &&
        (info > best.info || (info === best.info && item.slug < best.item.slug)));

    if (better) best = { item, asked, info };
  }

  return best?.item;
}

/**
 * Grades a closed item. Returns `false` for anything it cannot decide rather
 * than guessing — a check that awards credit it cannot justify is the exact
 * failure §4.2 law 3 exists to prevent.
 */
export function gradeAuto(item: DiagnosticItem, response: string): boolean {
  if (gradingModeFor(item.type) !== "auto") return false;

  const key = item.answerKey;
  if (typeof key !== "object" || key === null) return false;

  const correct = (key as { correct?: unknown }).correct;
  return typeof correct === "number" && String(correct) === response;
}

/**
 * What decided an open answer, when something other than the learner did.
 *
 * Passed in rather than inferred, because the same item can be marked either
 * way in the same product: §14.2's Assessment Agent marks it when it is
 * reachable and within budget, and the learner marks it themselves when it is
 * not. The cookie records which happened, so a replay reconstructs the mastery
 * the learner was actually shown rather than a second, kinder version of it.
 */
export interface Marking {
  /** §7.2's tier for the skill, so a written answer cannot outrank its domain. */
  skillTier: EvalTier;
  /**
   * Whether what was marked was a piece of work rather than an answer about
   * one. A photograph that shows the thing is direct evidence and moves the
   * belief further — see `ARTEFACT_CONFIDENCE`.
   */
  artefact?: boolean;
}

export function recordResponse(
  state: DiagnosticState,
  item: DiagnosticItem,
  correct: boolean,
  priors: BktPriors,
  nowIso: string,
  /** Set only when a model marked this answer; absent means the learner did. */
  marking?: Marking,
): DiagnosticState {
  const auto = gradingModeFor(item.type) === "auto";
  const mode = auto
    ? "auto"
    : marking === undefined
      ? "self"
      : marking.artefact === true
        ? "artefact"
        : "graded";
  const current = state.mastery[item.skill]!;

  /*
   * Three ways of deciding one answer, and three honest weights.
   *
   * `auto` is a closed item, checked — recognition rather than production, so
   * 0.7 rather than 1. `graded` is prose a model marked: production, and worth
   * the same as the session's own recall grading, which is where
   * `CHECK_CONFIDENCE` is set. `self` is the learner marking themselves, which
   * §7.2 calls Tier 5 and the BKT therefore refuses to let raise anything.
   */
  const observation =
    mode === "auto"
      ? { correct, confidence: AUTO_CONFIDENCE, evidenceTier: 1 as EvalTier }
      : mode === "self"
        ? { correct, confidence: 0.3, evidenceTier: 5 as EvalTier }
        : {
            correct,
            confidence:
              mode === "artefact" ? ARTEFACT_CONFIDENCE : CHECK_CONFIDENCE,
            evidenceTier: evidenceTierFor(marking!.skillTier),
          };

  const { state: next } = applyObservation(current, priors, observation, nowIso);

  return {
    mastery: { ...state.mastery, [item.skill]: next },
    asked: [
      ...state.asked,
      { itemSlug: item.slug, skillSlug: item.skill, mode, correct },
    ],
  };
}

/**
 * A check ends when the budget is gone or there is nothing left worth asking —
 * and the second half is what concentration buys. A deep check on one skill
 * stops the moment the skill is decided, rather than spending the rest of its
 * questions confirming what it already knows.
 */
export function isComplete(
  state: DiagnosticState,
  items: DiagnosticItem[],
  budget = DEFAULT_BUDGET,
  scope: CheckScope = {},
): boolean {
  return (
    state.asked.length >= budget ||
    selectNextItem(state, items, scope) === undefined
  );
}

export type VerdictBand = "likely-known" | "unclear" | "gap" | "not-assessed";

export interface SkillVerdict {
  skillSlug: string;
  name: string;
  band: VerdictBand;
  /** True when something other than the learner decided it. */
  assessed: boolean;
  mastery: number;
  answered: number;
}

export interface DiagnosticSummary {
  verdicts: SkillVerdict[];
  /** Skills something other than the learner genuinely decided. */
  assessedCount: number;
  /** Answered, self-marked, and deliberately not counted (§7.2). */
  selfMarkedCount: number;
  gaps: SkillVerdict[];
}

export function bandFor(mastery: number, assessed: boolean): VerdictBand {
  if (!assessed) return "not-assessed";
  if (mastery >= 0.7) return "likely-known";
  if (mastery >= 0.4) return "unclear";
  return "gap";
}

/**
 * The result screen's data. `assessed` is deliberately narrow: it is true only
 * where *we* decided the skill — a closed item checked, or an open answer a
 * model marked — so the summary can distinguish "we checked this" from "you
 * told us how it went" without the two blurring into a single reassuring
 * number. A self-marked answer stays out of it however confident the learner
 * was, which is the same rule §7.2 applies to the mastery it also cannot move.
 */
export function summarise(
  state: DiagnosticState,
  skills: DiagnosticSkill[],
  nowIso: string,
): DiagnosticSummary {
  const verdicts = skills.map((skill) => {
    const answers = state.asked.filter((a) => a.skillSlug === skill.slug);
    const assessed = answers.some((a) => a.mode !== "self");
    const mastery = effectiveMastery(state.mastery[skill.slug]!, nowIso);

    return {
      skillSlug: skill.slug,
      name: skill.name,
      band: bandFor(mastery, assessed),
      assessed,
      mastery,
      answered: answers.length,
    };
  });

  return {
    verdicts,
    assessedCount: verdicts.filter((v) => v.assessed).length,
    selfMarkedCount: state.asked.filter((a) => a.mode === "self").length,
    gaps: verdicts.filter((v) => v.band === "gap" || v.band === "unclear"),
  };
}
