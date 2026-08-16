import {
  PATH_BUILD_STAGES,
  type PathBuildStage,
} from "@/lib/curriculum/build-state";
import { stepStatesFor, type Step, type StepState } from "@/components/step-list";

/**
 * What the path build's wait says, kept out of the screen so it can be tested
 * as what it is: a mapping from a row in the database to three sentences.
 *
 * The same argument `/start/building` makes about pack authoring, arrived at
 * from the other end. That screen had one thing to say for three minutes and it
 * was reported as a hang; this screen had *nothing* to say for a minute or two,
 * because the build ran inside the request and left no trace anywhere the page
 * could read. Both are the same failure — a working machine that cannot show
 * its working — and both are fixed by writing the phase down and marking it off.
 *
 * None of it names a mechanism. "Cutting it into modules" is what the learner
 * gets; which model is asked for them, and whether one is asked at all, is our
 * problem and not something to put in front of somebody who is waiting.
 */

const COPY: Record<PathBuildStage, Step> = {
  planning: {
    title: "Cutting it into modules",
    note: "The order you will actually work in, shaped around what you have already proved rather than the order the subject happens to be written in.",
  },
  checking: {
    title: "Checking it holds together",
    note: "Nothing is asked of you before the things it needs, the hours fit the week you set aside, and every piece of work you hand in has something to be marked against.",
  },
  saving: {
    title: "Putting your path together",
    note: "The modules, and the piece of work each one ends in.",
  },
};

/**
 * A `Record` keyed by the stage rather than a second ordered list: the order is
 * `PATH_BUILD_STAGES`' to own — it is the order the pipeline runs in — and this
 * cannot fall out of step with it, because a stage without copy fails to
 * type-check and copy without a stage has nowhere to go.
 */
export const PATH_BUILD_STEPS: readonly Step[] = PATH_BUILD_STAGES.map(
  (stage) => COPY[stage],
);

export function pathStepStates(stage: PathBuildStage | null): StepState[] {
  return stepStatesFor(PATH_BUILD_STAGES, stage);
}

/**
 * Which step is running, or null while the row is queued and nothing has picked
 * it up yet. The screen counts "step 2 of 3" off this rather than off a second
 * traversal of its own.
 */
export function currentStep(states: readonly StepState[]): number | null {
  const at = states.indexOf("running");
  return at === -1 ? null : at;
}
