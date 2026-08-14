import { effectiveMastery } from "@/lib/engine/bkt";
import { MASTERY_TARGET, remainingHoursFor } from "@/lib/engine/scoring";
import { buildIndex, hardClosure } from "@/lib/engine/graph";
import {
  DEFAULT_COURSE_DEPTH,
  DEPTH_LEVELS,
  type CourseDepth,
  type EngineSkillGraph,
  type MasteryState,
} from "@/lib/engine";
import type { SkillProjection } from "@/lib/contracts/goal";

/**
 * §14.9.2 step 3 — the personal skill subgraph, computed rather than generated.
 *
 * §24 E3 lists "pruned personal skill subgraph" as an output of goal intake and
 * §8 screen 5 says the path screen must "explicitly list what was skipped and
 * why". Neither of those needs a model: the pack already declares the graph, and
 * mastery already says what the learner can do. So this is pure code, which
 * makes it free, instant, and identical every time someone reloads the page
 * asking why a skill disappeared.
 *
 * **Self-report is not evidence here.** The intake form asks for a stated level
 * because §8 screen 3 asks for one, but §7.2 puts self-report at Tier 5 and
 * Tier 5 can never raise mastery — so nothing in this file reads it. A learner
 * who calls themselves advanced is projected exactly like one who calls
 * themselves a beginner until something is actually checked. That is the whole
 * difference between "don't waste my time" and "tell me what I want to hear".
 */

export interface ProjectionInput {
  graph: EngineSkillGraph;
  mastery: MasteryState[];
  /** ISO-8601. Injected rather than read, so a projection is reproducible. */
  now: string;
  /** How much of the pack this goal is for. Omitted means `standard`. */
  depth?: CourseDepth | undefined;
}

/**
 * The skills a depth setting makes required, before anything the learner has
 * already proved is taken out.
 *
 * Two steps, and the second is the one that matters. First, keep the levels the
 * depth is for — a sprint is the foundations and the core, and stops. Then close
 * that set under hard prerequisites, so nothing kept depends on something
 * dropped. Without the closure, a sprint could require a skill whose hard
 * prerequisite is optional, and §16.1's eligibility filter would never unlock
 * it: the course would quietly dead-end.
 *
 * Everything outside the returned set stays in the graph and stays learnable.
 * It is optional, not deleted — that is the difference between "you can come
 * back to this" and "we decided you don't need it".
 */
export function keptSkillIds(
  graph: EngineSkillGraph,
  depth: CourseDepth = DEFAULT_COURSE_DEPTH,
): Set<string> {
  const levels = new Set(DEPTH_LEVELS[depth]);
  const seed = graph.skills
    .filter((skill) => levels.has(skill.level))
    .map((skill) => skill.id);

  return hardClosure(buildIndex(graph), seed);
}

/**
 * Every skill this course is *for* — the whole non-optional set, not the part
 * still to do.
 *
 * `requiredSkillIds` answers "what is left", and shrinks as a learner proves
 * things: a skill leaves it at `MASTERY_TARGET`, which is the same bar the
 * ledger claims it at. So "every required skill is claimed" is a question that
 * can never be answered yes — the two sets are disjoint by construction, and a
 * finished course has an *empty* required list, which is also what a learner who
 * aced the diagnostic has.
 *
 * This is the set that does not move, so it is the one a finished course can be
 * measured against. Exported for `isAchieved`, which is the only caller that
 * needs the course rather than the remainder.
 *
 * **Pass the goal's own depth.** A sprint that is measured against the standard
 * course set can never be achieved: the learner would claim every skill their
 * course contains and still be told they are not finished, because the yardstick
 * counted skills their course never required.
 */
export function courseSkillIds(
  graph: EngineSkillGraph,
  depth: CourseDepth = DEFAULT_COURSE_DEPTH,
): string[] {
  const kept = keptSkillIds(graph, depth);
  return graph.skills.filter((s) => kept.has(s.id)).map((s) => s.id);
}

/**
 * "Write a SQL query…" → "write a SQL query…", for mid-sentence use.
 *
 * Exported for the outline, which sets the same `canDoStatement` into a
 * different sentence. One helper, so the two screens cannot start disagreeing
 * about where the capital letter goes.
 */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function projectSkills(input: ProjectionInput): SkillProjection {
  const byId = new Map(input.mastery.map((m) => [m.skillId, m]));
  const kept = keptSkillIds(input.graph, input.depth ?? DEFAULT_COURSE_DEPTH);

  const requiredSkillIds: string[] = [];
  const optionalSkillIds: string[] = [];
  const excludedSkillIds: string[] = [];
  const exclusionReasons: Record<string, string> = {};
  let estimatedHours = 0;

  // Pack order, which is authoring order: stable across runs, and already
  // roughly dependency-ordered, so the path reads top to bottom.
  for (const skill of input.graph.skills) {
    const state = byId.get(skill.id);
    const effective = state ? effectiveMastery(state, input.now) : 0;

    // Exclusion requires *evidence*, not just a high number. A pack whose
    // priors happen to start a skill above the bar has told us nothing about
    // this learner, and skipping it on that basis would be the system deciding
    // someone knows something it never checked.
    if (state && state.evidenceCount > 0 && effective >= MASTERY_TARGET) {
      excludedSkillIds.push(skill.id);
      exclusionReasons[skill.id] =
        `Skipped — you already showed you can ${lowerFirst(skill.canDoStatement)}.`;
      continue;
    }

    if (!kept.has(skill.id)) {
      optionalSkillIds.push(skill.id);
      continue;
    }

    requiredSkillIds.push(skill.id);
    estimatedHours += remainingHoursFor(skill, effective);
  }

  return {
    requiredSkillIds,
    optionalSkillIds,
    excludedSkillIds,
    exclusionReasons,
    // One decimal: the input is expert-estimated hours, so quoting
    // 41.7239 hours would be precision the number does not have.
    estimatedHours: Math.round(estimatedHours * 10) / 10,
  };
}
