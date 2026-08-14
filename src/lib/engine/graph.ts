import type { DependencyType, EngineDependency, EngineSkillGraph } from "./types";

/**
 * Skill-graph traversal (§14.4).
 *
 * Edge direction, fixed once here and relied on everywhere: `from` is the
 * prerequisite and `to` is the skill that depends on it. So the prerequisites
 * of X are the edges whose `toSkillId` is X, and following outgoing edges from
 * X walks *forward* toward the skills X unlocks.
 */

export interface GraphIndex {
  /** skillId -> incoming edges (its prerequisites). */
  prerequisites: Map<string, EngineDependency[]>;
  /** skillId -> outgoing edges (the skills it unlocks). */
  dependents: Map<string, EngineDependency[]>;
  skillIds: string[];
}

export function buildIndex(graph: EngineSkillGraph): GraphIndex {
  const prerequisites = new Map<string, EngineDependency[]>();
  const dependents = new Map<string, EngineDependency[]>();

  for (const skill of graph.skills) {
    prerequisites.set(skill.id, []);
    dependents.set(skill.id, []);
  }

  for (const edge of graph.dependencies) {
    // Both endpoints must exist. A half-dangling edge would otherwise let the
    // traversals walk to an id that has no entry — the pack validator rejects
    // these at build time, but the engine refuses to act on one regardless.
    if (!prerequisites.has(edge.toSkillId)) continue;
    if (!prerequisites.has(edge.fromSkillId)) continue;
    prerequisites.get(edge.toSkillId)!.push(edge);
    dependents.get(edge.fromSkillId)!.push(edge);
  }

  return {
    prerequisites,
    dependents,
    // Sorted so every traversal below is order-stable regardless of input order.
    skillIds: graph.skills.map((s) => s.id).sort(),
  };
}

export function prerequisitesOf(
  index: GraphIndex,
  skillId: string,
  type?: DependencyType,
): EngineDependency[] {
  const edges = index.prerequisites.get(skillId) ?? [];
  const filtered = type ? edges.filter((e) => e.type === type) : edges;
  return [...filtered].sort((a, b) =>
    a.fromSkillId.localeCompare(b.fromSkillId),
  );
}

/**
 * Breadth-first distance from each skill to the nearest goal skill, walking
 * forward along dependency edges. A goal skill is at distance 0; a skill that
 * cannot reach any goal skill is absent from the map entirely, which is what
 * the eligibility filter reads as "not on a path to a goal-required skill".
 */
export function distancesToGoal(
  index: GraphIndex,
  goalSkillIds: string[],
  type?: DependencyType,
): Map<string, number> {
  const distance = new Map<string, number>();

  // Walk backwards from the goals along incoming edges: everything that can
  // reach a goal is, by definition, a prerequisite of something on that path.
  const queue: string[] = [];
  for (const goalId of [...goalSkillIds].sort()) {
    if (!index.prerequisites.has(goalId)) continue;
    if (distance.has(goalId)) continue;
    distance.set(goalId, 0);
    queue.push(goalId);
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head]!;
    head += 1;
    const currentDistance = distance.get(current)!;

    for (const edge of prerequisitesOf(index, current, type)) {
      if (distance.has(edge.fromSkillId)) continue;
      distance.set(edge.fromSkillId, currentDistance + 1);
      queue.push(edge.fromSkillId);
    }
  }

  return distance;
}

/**
 * §16.1 — "shortest-path centrality to goal skills", normalised to 0..1.
 * A goal skill scores 1; each hop away halves the remaining distance term.
 */
export function goalCriticality(
  distances: Map<string, number>,
  skillId: string,
): number {
  const distance = distances.get(skillId);
  if (distance === undefined) return 0;
  return 1 / (1 + distance);
}

export interface CycleReport {
  hasCycle: boolean;
  /** The cycle as a skill-id path, first id repeated at the end. */
  cycle: string[];
}

/**
 * Depth-first cycle detection. §14.4: "A DAG, cycle-checked at pack build time;
 * a cycle is a build failure." The returned path is what the pack validator
 * prints, so a failing build names the cycle rather than just asserting one.
 */
export function detectCycle(graph: EngineSkillGraph): CycleReport {
  const index = buildIndex(graph);
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  function visit(skillId: string): string[] | null {
    const current = state.get(skillId);
    if (current === "done") return null;
    if (current === "visiting") {
      const start = stack.indexOf(skillId);
      return [...stack.slice(start), skillId];
    }

    state.set(skillId, "visiting");
    stack.push(skillId);

    const outgoing = [...index.dependents.get(skillId)!].sort((a, b) =>
      a.toSkillId.localeCompare(b.toSkillId),
    );
    for (const edge of outgoing) {
      const found = visit(edge.toSkillId);
      if (found) return found;
    }

    stack.pop();
    state.set(skillId, "done");
    return null;
  }

  for (const skillId of index.skillIds) {
    const cycle = visit(skillId);
    if (cycle) return { hasCycle: true, cycle };
  }

  return { hasCycle: false, cycle: [] };
}

/**
 * Skills reachable backwards from the goal set — i.e. everything the goal
 * actually depends on, transitively. Used by the deadline override to decide
 * what is essential and what can be cut (§16.1 step 3).
 */
export function requiredClosure(
  index: GraphIndex,
  goalSkillIds: string[],
): Set<string> {
  return new Set(distancesToGoal(index, goalSkillIds).keys());
}

/**
 * The same walk, restricted to `hard` edges: everything the seed set cannot be
 * learned without.
 *
 * This is what keeps a depth setting from producing an unlearnable course. The
 * eligibility filter (§16.1 step 1) gates on every hard prerequisite reaching
 * mastery ≥ 0.7, so a required skill whose hard prerequisite was dropped for
 * being "too advanced" is one the learner can never become eligible for — the
 * path would simply stop, with no screen able to say why.
 *
 * No curated pack has a hard edge running from a higher level to a lower one,
 * so for those this only ever returns the seed. It earns its place on generated
 * packs, where `level` is model-assigned and nothing guarantees the ordering.
 */
export function hardClosure(
  index: GraphIndex,
  seedSkillIds: string[],
): Set<string> {
  return new Set(distancesToGoal(index, seedSkillIds, "hard").keys());
}
