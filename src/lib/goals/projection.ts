import { effectiveMastery } from "@/lib/engine/bkt";
import { MASTERY_TARGET, remainingHoursFor } from "@/lib/engine/scoring";
import type { EngineSkill, EngineSkillGraph, MasteryState } from "@/lib/engine";
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
}

/**
 * Skills the pack itself declares as depth beyond the core path. They stay in
 * the graph and stay learnable; they are simply not counted against the
 * estimate, because promising someone the specialist tail is how a 20-hour goal
 * becomes a 60-hour one.
 */
function isOptional(skill: EngineSkill): boolean {
  return skill.level === "specialist";
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
 */
export function courseSkillIds(graph: EngineSkillGraph): string[] {
  return graph.skills.filter((s) => !isOptional(s)).map((s) => s.id);
}

/** "Write a SQL query…" → "write a SQL query…", for mid-sentence use. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function projectSkills(input: ProjectionInput): SkillProjection {
  const byId = new Map(input.mastery.map((m) => [m.skillId, m]));

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

    if (isOptional(skill)) {
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
