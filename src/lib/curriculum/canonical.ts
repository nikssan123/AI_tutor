import { effectiveMastery } from "@/lib/engine/bkt";
import { buildIndex, prerequisitesOf } from "@/lib/engine/graph";
import type { EngineSkill, EngineSkillGraph, MasteryState } from "@/lib/engine";
import type {
  CurriculumDraft,
  CurriculumModule,
} from "@/lib/contracts/curriculum";
import { CURRICULUM_MASTERED_THRESHOLD, MIN_RUBRIC_CRITERIA } from "./validate";

/**
 * §14.9.5 — "curriculum validator fails twice → fall back to the pack's
 * canonical path."
 *
 * The fallback is pure code, and that is the whole point: it is what the
 * learner gets when the model could not produce something that passes, so it
 * cannot itself depend on a model. It is duller than a generated path — one
 * skill per module, the pack's own ordering — and it is always valid, which at
 * that moment is worth more.
 *
 * It is built to satisfy every *blocking* check by construction rather than by
 * luck: prerequisites come first because the ordering is topological, no skill
 * is hallucinated because every skill comes from the graph, nothing already
 * demonstrated is included because it is filtered out, and a project module is
 * only emitted when a rubric that qualifies actually exists.
 */

const LEVEL_RANK = {
  foundational: 0,
  core: 1,
  advanced: 2,
  specialist: 3,
} as const;

export interface CanonicalProject {
  /** Pack rubric slug. */
  rubricId: string;
  title: string;
  targetSkillIds: string[];
  estimatedMinutes: number;
}

export interface CanonicalInput {
  graph: EngineSkillGraph;
  requiredSkillIds: string[];
  mastery: MasteryState[];
  now: string;
  rubricCriteria: Map<string, number>;
  projects?: CanonicalProject[];
}

/**
 * Kahn's algorithm, with ties broken by (level, slug).
 *
 * The tiebreak is what makes the result both deterministic and gently ramped:
 * among skills whose prerequisites are all met, the most foundational goes
 * first. Two runs on the same graph always produce the same path, which matters
 * because this is the output a learner sees after something already went wrong.
 */
export function topologicalOrder(
  graph: EngineSkillGraph,
  skillIds: string[],
): string[] {
  const index = buildIndex(graph);
  const wanted = new Set(skillIds);
  const skills = new Map(graph.skills.map((s) => [s.id, s]));

  const blocking = new Map<string, Set<string>>();
  for (const id of wanted) {
    blocking.set(
      id,
      new Set(
        prerequisitesOf(index, id, "hard")
          .map((e) => e.fromSkillId)
          .filter((from) => wanted.has(from)),
      ),
    );
  }

  const rankOf = (id: string): number => {
    const skill = skills.get(id);
    return skill ? LEVEL_RANK[skill.level] : 0;
  };

  const ordered: string[] = [];
  while (blocking.size > 0) {
    const ready = [...blocking.entries()]
      .filter(([, needs]) => needs.size === 0)
      .map(([id]) => id)
      .sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b));

    // A cycle would leave nothing ready. Packs are cycle-checked at build time
    // (§14.4), so this can only fire on a graph that never passed validation —
    // emitting the remainder in a stable order beats looping forever.
    if (ready.length === 0) {
      ordered.push(...[...blocking.keys()].sort());
      break;
    }

    const next = ready[0]!;
    ordered.push(next);
    blocking.delete(next);
    for (const needs of blocking.values()) needs.delete(next);
  }

  return ordered;
}

function moduleFor(
  order: number,
  skill: EngineSkill,
): CurriculumModule {
  return {
    order,
    title: skill.name,
    targetSkillIds: [skill.id],
    estimatedHours: skill.estimatedHours,
    outputArtifact: "exercise",
    acceptanceCriteria: [skill.canDoStatement],
    rubricId: null,
  };
}

/** §14.9.2 — a curriculum is at least three modules or it is not one. */
export const MIN_MODULES = 3;

/**
 * Returns `null` when there is nothing to build a curriculum out of — fewer
 * than three skills left to teach. Padding to reach the floor would mean
 * inventing work, which is worse than saying there isn't a path.
 */
export function canonicalCurriculum(
  input: CanonicalInput,
): CurriculumDraft | null {
  const skills = new Map(input.graph.skills.map((s) => [s.id, s]));
  const effective = new Map(
    input.mastery.map((m) => [m.skillId, effectiveMastery(m, input.now)]),
  );

  const toTeach = input.requiredSkillIds.filter(
    (id) =>
      skills.has(id) &&
      (effective.get(id) ?? 0) <= CURRICULUM_MASTERED_THRESHOLD,
  );

  const modules = topologicalOrder(input.graph, toTeach).map((id, i) =>
    moduleFor(i, skills.get(id)!),
  );

  const covered = new Set(toTeach);
  for (const project of input.projects ?? []) {
    const criteria = input.rubricCriteria.get(project.rubricId);
    // Only a project the learner is actually equipped for, and only one whose
    // rubric would survive the validator's own coverage check.
    if (criteria === undefined || criteria < MIN_RUBRIC_CRITERIA) continue;
    if (!project.targetSkillIds.every((id) => covered.has(id))) continue;

    modules.push({
      order: modules.length,
      title: project.title,
      targetSkillIds: project.targetSkillIds.slice(0, 3),
      estimatedHours: project.estimatedMinutes / 60,
      outputArtifact: "project",
      acceptanceCriteria: [`Submit ${project.title} for grading.`],
      rubricId: project.rubricId,
    });
  }

  if (modules.length < MIN_MODULES) return null;

  return {
    modules: modules.slice(0, 40),
    totalHours:
      Math.round(
        modules.slice(0, 40).reduce((sum, m) => sum + m.estimatedHours, 0) * 10,
      ) / 10,
    rationale:
      "The pack's own path, in dependency order. Generated after the tailored curriculum failed validation twice, so it is deliberately plain: every skill you still need, in an order that works.",
  };
}
