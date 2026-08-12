import { describe, expect, it } from "vitest";
import { layoutGraph } from "@/lib/packs/layout";
import { loadPack } from "@/lib/packs/loader";
import { toEngineGraph } from "@/lib/packs/validate";
import type { EngineSkillGraph } from "@/lib/engine/types";
import { dependency, graph, skill } from "../engine/support";

describe("layoutGraph", () => {
  it("puts every skill strictly below all of its prerequisites", () => {
    // This is the only property a reviewer is actually checking when they look
    // at the graph, so it is the property under test.
    const g = graph(
      [skill("a"), skill("b"), skill("c")],
      [dependency("a", "b"), dependency("b", "c")],
    );
    const layout = layoutGraph(g);
    const depth = new Map(layout.nodes.map((n) => [n.id, n.depth]));
    expect(depth.get("a")).toBe(0);
    expect(depth.get("b")).toBe(1);
    expect(depth.get("c")).toBe(2);
  });

  it("uses the longest path, not the shortest", () => {
    // A skill with a direct edge from the root *and* a two-hop path must sit
    // below both, or an edge would point upward on screen.
    const g = graph(
      [skill("root"), skill("mid"), skill("leaf")],
      [
        dependency("root", "mid"),
        dependency("mid", "leaf"),
        dependency("root", "leaf"),
      ],
    );
    const depth = new Map(layoutGraph(g).nodes.map((n) => [n.id, n.depth]));
    expect(depth.get("leaf")).toBe(2);
  });

  it("places every root at depth 0", () => {
    const g = graph([skill("x"), skill("y")]);
    expect(layoutGraph(g).nodes.every((n) => n.depth === 0)).toBe(true);
  });

  it("indexes nodes left to right within a layer, sorted for stability", () => {
    const g = graph([skill("zebra"), skill("alpha")]);
    const layout = layoutGraph(g);
    expect(layout.nodes.map((n) => n.id)).toEqual(["alpha", "zebra"]);
    expect(layout.nodes.map((n) => n.index)).toEqual([0, 1]);
  });

  it("reports the widest layer and the total depth", () => {
    const g = graph(
      [skill("a"), skill("b"), skill("c"), skill("d")],
      [dependency("a", "c"), dependency("b", "c"), dependency("c", "d")],
    );
    const layout = layoutGraph(g);
    expect(layout.width).toBe(2);
    expect(layout.depth).toBe(3);
  });

  it("carries the fields the viewer renders", () => {
    const g = graph([skill("a", { name: "Alpha", area: "basics", evalTier: 3 })]);
    expect(layoutGraph(g).nodes[0]).toMatchObject({
      id: "a",
      name: "Alpha",
      area: "basics",
      evalTier: 3,
    });
  });

  it("preserves edge type so hard and soft render differently", () => {
    const g = graph(
      [skill("a"), skill("b")],
      [dependency("a", "b", "soft", 0.5)],
    );
    expect(layoutGraph(g).edges).toEqual([
      { from: "a", to: "b", type: "soft" },
    ]);
  });

  it("terminates on a cyclic graph rather than recursing forever", () => {
    // Validated packs are acyclic, but this viewer also renders unvalidated
    // drafts — which is exactly when someone needs to see the cycle.
    const cyclic: EngineSkillGraph = graph(
      [skill("a"), skill("b")],
      [dependency("a", "b"), dependency("b", "a")],
    );
    expect(() => layoutGraph(cyclic)).not.toThrow();
    expect(layoutGraph(cyclic).nodes).toHaveLength(2);
  });

  it("handles an empty graph", () => {
    const layout = layoutGraph(graph([]));
    expect(layout.nodes).toEqual([]);
    expect(layout.width).toBe(1);
  });

  it("lays out the real SQL pack with no edge pointing upward", () => {
    const layout = layoutGraph(toEngineGraph(loadPack("packs/sql-data-analysis")));
    const depth = new Map(layout.nodes.map((n) => [n.id, n.depth]));

    expect(layout.nodes).toHaveLength(26);
    for (const edge of layout.edges) {
      expect(
        depth.get(edge.from)!,
        `${edge.from} -> ${edge.to}`,
      ).toBeLessThan(depth.get(edge.to)!);
    }
  });
});
