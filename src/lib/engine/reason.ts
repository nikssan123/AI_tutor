import { WEIGHTS } from "./scoring";
import type { EngineSkill, ScoreComponents, ScoredSkill } from "./types";

/**
 * §16.1 step 5 — "Explain the choice."
 *
 * Template-filled from the score components, **not** LLM-generated. Two reasons
 * the plan is emphatic about this: it must be truthful (the sentence has to
 * describe the actual arithmetic that picked this skill, not a plausible story
 * about it), and it must be free (this renders on /today for every learner
 * every day, so a per-render model call would be a recurring cost for prose).
 */

/** The component that contributed most, and how it reads to a human. */
export type ComponentKey = keyof ScoreComponents;

/**
 * Exported so the copy itself can be tested. These sentences are the product's
 * voice on the screen a learner sees every day; they deserve assertions, not
 * just incidental coverage through whichever branch happens to fire.
 */
export const POSITIVE_PHRASES: Record<
  ComponentKey,
  (skill: EngineSkill) => string
> = {
  goalCriticality: (s) => `${s.name} is directly on the path to your goal`,
  masteryGap: (s) => `${s.name} is the biggest gap between where you are and where you need to be`,
  prereqReadiness: (s) => `you've got the groundwork for ${s.name} in place`,
  retentionUrgency: (s) => `${s.name} is fading — it's been a while since you got it right`,
  momentum: (s) => `you're mid-flow on ${s.name}`,
  interleavingBonus: (s) => `switching to ${s.name} gives yesterday's material time to settle`,
  frustrationRisk: (s) => `${s.name} has been rough lately`,
  timeFit: (s) => `${s.name} fits the time you have`,
  recentlyFailedTwice: (s) => `${s.name} hasn't gone well twice running`,
};

/**
 * Ranked by *absolute* contribution, so a dominant negative term is allowed to
 * lead the sentence. Ranking by signed value instead would let the planner tell
 * a learner who just failed twice that "you've got the groundwork in place" —
 * technically the largest positive term, and completely misleading. §4.2 law 3
 * exists to stop exactly that.
 */
/**
 * Used when a negatively-weighted term is what actually dominated the choice.
 * These have to be honest without being discouraging — the learner already
 * knows it went badly; the sentence's job is to show that the system noticed.
 */
export const NEGATIVE_PHRASES: Record<
  ComponentKey,
  (skill: EngineSkill) => string
> = {
  goalCriticality: (s) => `${s.name} is a detour from your goal`,
  masteryGap: (s) => `${s.name} is close to solid`,
  prereqReadiness: (s) => `the groundwork for ${s.name} is still thin`,
  retentionUrgency: (s) => `${s.name} is still fresh`,
  momentum: (s) => `${s.name} is a fresh start`,
  interleavingBonus: (s) => `${s.name} keeps you in the same area as last time`,
  frustrationRisk: (s) => `${s.name} has been rough lately`,
  timeFit: (s) => `${s.name} is a stretch for the time you have`,
  recentlyFailedTwice: (s) => `${s.name} hasn't gone well twice running`,
};

function contributions(
  components: ScoreComponents,
): Array<{ key: ComponentKey; contribution: number }> {
  return (Object.keys(components) as ComponentKey[])
    .map((key) => ({
      key,
      contribution: WEIGHTS[key] * components[key],
    }))
    .sort((a, b) => {
      const byMagnitude = Math.abs(b.contribution) - Math.abs(a.contribution);
      return byMagnitude !== 0 ? byMagnitude : a.key.localeCompare(b.key);
    });
}

export interface ReasonInput {
  top: ScoredSkill;
  skill: EngineSkill;
  minutes: number;
  isApplySession: boolean;
  retrievalCount: number;
  /** True when the session backed off after repeated failure (§16.1). */
  backingOff: boolean;
}

/**
 * Builds the one-sentence explanation shown on /today.
 *
 * Shape: [what's driving the choice] — [what today actually is].
 * Example: "Two of your last three joins had the wrong grain, so today is
 * 25 minutes on join grain, then a real query to grade."
 */
export function buildReason(input: ReasonInput): string {
  const ordered = contributions(input.top.components);
  const driver = ordered[0];

  let lead: string;
  if (!driver || driver.contribution === 0) {
    lead = `${input.skill.name} is the next thing worth your time`;
  } else if (driver.contribution > 0) {
    lead = POSITIVE_PHRASES[driver.key](input.skill);
  } else {
    lead = NEGATIVE_PHRASES[driver.key](input.skill);
  }

  const opening =
    input.retrievalCount > 0
      ? `${input.retrievalCount} quick recall question${input.retrievalCount === 1 ? "" : "s"} first, then `
      : "";

  let body: string;
  if (input.backingOff) {
    // Backing off is a deliberate, explainable decision — say it plainly rather
    // than dressing a lighter session up as a normal one.
    body = `${input.minutes} minutes going back over it, with nothing to submit`;
  } else if (input.isApplySession) {
    body = `${input.minutes} minutes producing something real for us to grade`;
  } else {
    body = `${input.minutes} minutes on ${input.skill.name}`;
  }

  // Sentence case, single sentence, no trailing double punctuation.
  const sentence = `${capitalise(lead)}, so today is ${opening}${body}.`;
  return sentence.replace(/\s+/g, " ").trim();
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * §16.1 step 3 — when the plan is compressed against a deadline, the learner is
 * told, and told what was cut. Silent scope reduction would break the honesty
 * the whole product is positioned on (§4.2 law 5).
 */
export function buildCompressionMessage(
  droppedSkills: EngineSkill[],
  deadline: string,
): string {
  if (droppedSkills.length === 0) {
    return `Your plan is compressed to hit ${deadline}. Nothing has been cut yet — you're on the essentials already.`;
  }

  const names = droppedSkills.map((s) => s.name);
  const listed =
    names.length <= 3
      ? formatList(names)
      : `${formatList(names.slice(0, 3))} and ${names.length - 3} more`;

  return `To hit ${deadline}, your plan is now essentials only. Dropped: ${listed}. You can add them back by moving the deadline.`;
}

/** Only ever called with a non-empty list — see buildCompressionMessage. */
function formatList(items: string[]): string {
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]!}`;
}
