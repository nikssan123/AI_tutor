import { buildIndex, prerequisitesOf } from "@/lib/engine/graph";
import type { EngineSkillGraph } from "@/lib/engine/types";

/**
 * Layered layout for the pack graph viewer (§24 E2).
 *
 * Deliberately hand-rolled rather than pulled from a graph library: this renders
 * one internal admin page, the layout rule is four lines of logic, and §13.3
 * caps marketing JS at 80KB — a layout engine in the bundle for an admin route
 * is not a trade worth making.
 *
 * Depth is the longest path from any root, which puts every skill strictly below
 * all of its prerequisites. That is the property a reviewer is checking for when
 * they look at the graph at all.
 */

export interface LaidOutNode {
  id: string;
  name: string;
  depth: number;
  /** Position within the depth layer, left to right. */
  index: number;
  area: string;
  evalTier: number;
}

export interface LaidOutEdge {
  from: string;
  to: string;
  type: "hard" | "soft";
}

export interface GraphLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  /** Number of nodes in the widest layer, for sizing the viewport. */
  width: number;
  depth: number;
}

export function layoutGraph(graph: EngineSkillGraph): GraphLayout {
  const index = buildIndex(graph);
  const depths = new Map<string, number>();

  function depthOf(skillId: string, seen: Set<string>): number {
    const cached = depths.get(skillId);
    if (cached !== undefined) return cached;

    // A cycle would recurse forever. Packs are cycle-checked before they reach
    // the database, but this viewer also renders unvalidated drafts.
    if (seen.has(skillId)) return 0;
    seen.add(skillId);

    const prereqs = prerequisitesOf(index, skillId);
    const depth =
      prereqs.length === 0
        ? 0
        : Math.max(...prereqs.map((e) => depthOf(e.fromSkillId, seen) + 1));

    depths.set(skillId, depth);
    return depth;
  }

  for (const id of index.skillIds) depthOf(id, new Set());

  const byDepth = new Map<number, string[]>();
  for (const id of index.skillIds) {
    const depth = depths.get(id)!;
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), id]);
  }

  const skillsById = new Map(graph.skills.map((s) => [s.id, s]));
  const nodes: LaidOutNode[] = [];

  for (const [depth, ids] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    ids.sort().forEach((id, position) => {
      const skill = skillsById.get(id)!;
      nodes.push({
        id,
        name: skill.name,
        depth,
        index: position,
        area: skill.area,
        evalTier: skill.evalTier,
      });
    });
  }

  return {
    nodes,
    edges: graph.dependencies.map((d) => ({
      from: d.fromSkillId,
      to: d.toSkillId,
      type: d.type,
    })),
    width: Math.max(1, ...[...byDepth.values()].map((ids) => ids.length)),
    depth: Math.max(0, ...depths.values()) + 1,
  };
}
