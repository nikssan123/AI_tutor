import { BUILD_STAGES, type BuildStage } from "@/lib/packs/build";
import { stepStatesFor, type StepState } from "@/components/step-list";

export type { StepState };

/**
 * What the wait screen says, kept out of the screen itself so it can be tested
 * as what it is: a mapping from a row in the database to four sentences.
 *
 * §7.1's Generated tier takes several minutes, and for all of that time the
 * screen had one thing to say — that it was still going. That is
 * indistinguishable from a page that has hung, and it was reported as exactly
 * that. What follows is the honest alternative: the phases the build actually
 * moves through, marked off as it reaches them, rather than a bar filling on a
 * timer that knows nothing about the run.
 */

/**
 * How long an authoring run takes, as a range, in the words the screen uses.
 *
 * **It was a single number, and the number was wrong.** "About three minutes"
 * described the best case as though it were the only case: a measured run took
 * 7m18s on its first attempt alone, and a build that fails the quality floor
 * gets a second one. So the screen told people three minutes, went quiet past
 * five, and left anybody on an ordinary two-attempt build watching a page that
 * had — by its own account — already overrun. A promise that specific is worse
 * than no promise, because it is the thing they measure the wait against.
 *
 * The range is what the pipeline actually does. The floor is a clean single
 * attempt: the graph, then the longest of the bank, the rubrics and the reading
 * list, which now genuinely run together. The ceiling is that plus a second
 * attempt, which re-authors everything except the reading list — it is carried,
 * so a retry no longer pays the slowest call in the run twice.
 *
 * Both ends move if the pipeline does. `RESOURCE_BUDGET_MS` bounds the slowest
 * call, and `tests/packs/resources.test.ts` holds the whole thing under
 * `BUILD_TIMEOUT_MINUTES` — past which this screen stops calling it a wait and
 * starts calling it stopped.
 */
export const TYPICAL_MINUTES = 3;

/** The other end of it — a build that needed its second attempt. */
export const TYPICAL_MAX_MINUTES = 8;

/**
 * When to say out loud that this one is slow.
 *
 * Past this the screen stops repeating the usual figure and explains the
 * overrun instead. Set above `TYPICAL_MAX_MINUTES` rather than at it, so an
 * ordinary two-attempt build never sees it — a reassurance shown to everybody
 * is not reassurance, it is noise that trains people to expect a problem. That
 * was the old value's real fault: at five minutes it fired on builds that were
 * behaving exactly as designed.
 */
export const SLOW_AFTER_MINUTES = 9;

export interface BuildStep {
  stage: BuildStage;
  /** What is happening, in five words at the top of a row. */
  title: string;
  /** What that means for the course they will get. */
  note: string;
}

/**
 * The phases in the learner's language.
 *
 * A `Record` keyed by the stage rather than a second ordered list: the order is
 * `BUILD_STAGES`' to own — it is the order the pipeline runs in — and this
 * cannot fall out of step with it, because a stage without copy fails to
 * type-check and copy without a stage has nowhere to go.
 *
 * None of it names a mechanism. "Writing the questions" is what the learner
 * gets; which model is being asked for them is our problem, not something to
 * put on a screen somebody is waiting in front of.
 */
const COPY: Record<BuildStage, Omit<BuildStep, "stage">> = {
  graph: {
    title: "Working out the skills",
    note: "Everything the subject is made of, and what has to come before what.",
  },
  writing: {
    title: "Writing the questions",
    note: "The check that finds what you can already do, and the guides your handed-in work gets marked against.",
  },
  checking: {
    title: "Checking every source",
    note: "We open each page we point you at. Anything that doesn’t answer is dropped rather than cited.",
  },
  saving: {
    title: "Putting it together",
    note: "The finished course, held to the same bar as the ones we write by hand.",
  },
};

export const BUILD_STEPS: readonly BuildStep[] = BUILD_STAGES.map((stage) => ({
  stage,
  ...COPY[stage],
}));

/**
 * Where each step stands, given the phase the row says the build is in.
 *
 * The rule — a queued build has not started working out the skills, and a
 * screen that lights the first step anyway is telling a small lie that makes
 * the rest of it worth nothing — is `stepStatesFor`'s, shared with the path
 * screen's wait. This is the pack pipeline's stages bound to it, kept so the
 * page and its tests call one function with one argument.
 */
export function stepStates(stage: BuildStage | null): StepState[] {
  return stepStatesFor(BUILD_STAGES, stage);
}

/**
 * How long it has been going, in bands rather than in seconds.
 *
 * The page reloads itself every few seconds, so a live seconds count would
 * rewrite itself on every refresh — motion that carries no news, on the one
 * screen whose whole job is to be calm about waiting. Minutes change when
 * something has changed.
 */
export function elapsedWords(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
