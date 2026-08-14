import { COURSE_DEPTHS, type CourseDepth } from "@/lib/engine";
import type { EngineSkillGraph, MasteryState } from "@/lib/engine";
import { projectSkills } from "./projection";

/**
 * The depth dial, priced (PLAN-ADAPTATION).
 *
 * §8 screen 5 is the "honest expectation-set", and a dial the learner cannot see
 * the cost of is not honest. So each option is projected properly — against this
 * learner's own mastery, at this moment — rather than described in the abstract.
 * Someone who has already proved half the core sees a sprint that is genuinely
 * short for *them*, not the brochure number.
 *
 * Three full projections is three passes over a graph of at most a few dozen
 * skills. It is free, and it means the number on the button is the number the
 * path will show after they press it.
 */

export interface DepthOption {
  depth: CourseDepth;
  /** Skills still to do at this depth — the same count the path header shows. */
  skillCount: number;
  estimatedHours: number;
  /** The depth the goal is currently set to. */
  current: boolean;
  /**
   * Skills this depth would stop asking for, that the current one requires.
   * Empty when the option is the current depth or is deeper than it.
   */
  dropped: string[];
  /** Skills this depth would add that the current one treats as optional. */
  added: string[];
}

export interface DepthOptionsInput {
  graph: EngineSkillGraph;
  mastery: MasteryState[];
  /** ISO-8601, injected so the same inputs always price the same way. */
  now: string;
  current: CourseDepth;
}

/**
 * What each depth would cost this learner, in pack order: sprint, standard,
 * mastery.
 *
 * `dropped` and `added` are the honest part. A learner switching down is told
 * what stops being asked of them, by name — not "a shorter course" — and one
 * switching up is told what they are taking on. §8's rule is that the screen
 * lists what was skipped *and why*; this is the same promise applied to a
 * choice they have not made yet.
 */
export function depthOptions(input: DepthOptionsInput): DepthOption[] {
  const projectionFor = (depth: CourseDepth) =>
    projectSkills({
      graph: input.graph,
      mastery: input.mastery,
      now: input.now,
      depth,
    });

  const currentRequired = new Set(projectionFor(input.current).requiredSkillIds);

  return COURSE_DEPTHS.map((depth) => {
    const projection = projectionFor(depth);
    const required = new Set(projection.requiredSkillIds);

    return {
      depth,
      skillCount: projection.requiredSkillIds.length,
      estimatedHours: projection.estimatedHours,
      current: depth === input.current,
      dropped: [...currentRequired].filter((id) => !required.has(id)),
      added: projection.requiredSkillIds.filter(
        (id) => !currentRequired.has(id),
      ),
    };
  });
}
