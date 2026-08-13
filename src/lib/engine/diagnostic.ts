import { applyObservation, effectiveMastery, initialMastery } from "./bkt";
import type { BktPriors, MasteryState } from "./types";

/**
 * §24 E4 — the adaptive Skill Check, built to run with no LLM in the path.
 *
 * The whole check is deterministic: item selection is a pure function of the
 * current posterior, grading of closed items is an equality test, and every
 * mastery move goes through the same `applyObservation` the planner uses. That
 * is what makes it shippable before `ANTHROPIC_API_KEY` exists.
 *
 * The honest consequence, stated here because it shapes everything below: a
 * machine with no evaluator can only *verify* a closed item. Production items —
 * "explain this", "write this", "photograph this" — are still worth answering,
 * and the check still shows them, but the learner marks their own answer
 * against a revealed key. §7.2 calls that Tier 5, and §7.2's hard rule is that
 * a Tier 5 observation never raises mastery. So it does not. The check reports
 * what it could actually verify and says plainly what it could not, which is
 * the same promise the rest of the product makes.
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
}

export interface AskedItem {
  itemSlug: string;
  skillSlug: string;
  mode: "auto" | "self";
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
 * Picks the next question as a pure function of state.
 *
 * **Coverage first, information second.** Breadth is a hard rule rather than a
 * weight, because it kept losing to one: answering a skill correctly moves its
 * posterior *towards* 0.5, which is exactly where an item is most informative,
 * so a purely information-greedy check spends all nine questions deepening the
 * one skill it just asked about. That is the right policy for grading a single
 * skill and the wrong one for "find my gaps across photography", which is what
 * this check is for.
 *
 * So: fewest observations wins outright; among equals, the most informative
 * item; ties break on slug. The same state always yields the same question,
 * which matters when someone disputes a result.
 */
export function selectNextItem(
  state: DiagnosticState,
  items: DiagnosticItem[],
): DiagnosticItem | undefined {
  const seen = new Set(state.asked.map((a) => a.itemSlug));

  const candidates = items.filter(
    (item) =>
      !seen.has(item.slug) &&
      gradingModeFor(item.type) !== "excluded" &&
      state.mastery[item.skill] !== undefined,
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

export function recordResponse(
  state: DiagnosticState,
  item: DiagnosticItem,
  correct: boolean,
  priors: BktPriors,
  nowIso: string,
): DiagnosticState {
  const mode = gradingModeFor(item.type) === "auto" ? "auto" : "self";
  const current = state.mastery[item.skill]!;

  const { state: next } = applyObservation(
    current,
    priors,
    {
      correct,
      confidence: mode === "auto" ? AUTO_CONFIDENCE : 0.3,
      // §7.2 — a self-marked answer is self-report. Tier 5. The BKT refuses to
      // raise mastery on it, which is enforced there rather than trusted here.
      evidenceTier: mode === "auto" ? 1 : 5,
    },
    nowIso,
  );

  return {
    mastery: { ...state.mastery, [item.skill]: next },
    asked: [
      ...state.asked,
      { itemSlug: item.slug, skillSlug: item.skill, mode, correct },
    ],
  };
}

export function isComplete(
  state: DiagnosticState,
  items: DiagnosticItem[],
  budget = DEFAULT_BUDGET,
): boolean {
  return (
    state.asked.length >= budget || selectNextItem(state, items) === undefined
  );
}

export type VerdictBand = "likely-known" | "unclear" | "gap" | "not-assessed";

export interface SkillVerdict {
  skillSlug: string;
  name: string;
  band: VerdictBand;
  /** True only when a closed item actually decided it. */
  assessed: boolean;
  mastery: number;
  answered: number;
}

export interface DiagnosticSummary {
  verdicts: SkillVerdict[];
  /** Skills a closed item genuinely decided. */
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
 * where a closed item decided the skill, so the summary can distinguish "we
 * checked this" from "you told us how it went" without the two blurring into a
 * single reassuring number.
 */
export function summarise(
  state: DiagnosticState,
  skills: DiagnosticSkill[],
  nowIso: string,
): DiagnosticSummary {
  const verdicts = skills.map((skill) => {
    const answers = state.asked.filter((a) => a.skillSlug === skill.slug);
    const assessed = answers.some((a) => a.mode === "auto");
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
