import { describe, expect, it } from "vitest";
import {
  buildIndex,
  detectCycle,
  distancesToGoal,
  goalCriticality,
  prerequisitesOf,
  requiredClosure,
} from "@/lib/engine/graph";
import { dependency, graph, skill } from "./support";

/**
 * Edge direction is the thing most likely to be got backwards, so it is the
 * thing asserted first: `from` is the prerequisite, `to` is the dependent.
 */
const chain = graph(
  [skill("basics"), skill("joins"), skill("windows")],
  [dependency("basics", "joins"), dependency("joins", "windows")],
);

describe("buildIndex", () => {
  it("indexes prerequisites by the dependent skill", () => {
    const index = buildIndex(chain);
    expect(index.prerequisites.get("joins")?.map((e) => e.fromSkillId)).toEqual([
      "basics",
    ]);
    expect(index.dependents.get("basics")?.map((e) => e.toSkillId)).toEqual([
      "joins",
    ]);
  });

  it("gives every skill an entry even with no edges", () => {
    const index = buildIndex(graph([skill("lonely")]));
    expect(index.prerequisites.get("lonely")).toEqual([]);
    expect(index.dependents.get("lonely")).toEqual([]);
  });

  it("sorts skill ids so traversal order never depends on input order", () => {
    const a = buildIndex(graph([skill("c"), skill("a"), skill("b")]));
    const b = buildIndex(graph([skill("b"), skill("c"), skill("a")]));
    expect(a.skillIds).toEqual(["a", "b", "c"]);
    expect(a.skillIds).toEqual(b.skillIds);
  });

  it("ignores edges that reference an unknown skill", () => {
    const index = buildIndex(
      graph([skill("a")], [dependency("a", "ghost"), dependency("ghost", "a")]),
    );
    expect(index.dependents.get("a")).toEqual([]);
    expect(index.prerequisites.get("a")).toEqual([]);
  });
});

describe("prerequisitesOf", () => {
  const index = buildIndex(
    graph(
      [skill("a"), skill("b"), skill("c")],
      [dependency("a", "c", "hard"), dependency("b", "c", "soft")],
    ),
  );

  it("returns every prerequisite when no type is given", () => {
    expect(prerequisitesOf(index, "c").map((e) => e.fromSkillId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("filters by dependency type", () => {
    expect(prerequisitesOf(index, "c", "hard").map((e) => e.fromSkillId)).toEqual(
      ["a"],
    );
    expect(prerequisitesOf(index, "c", "soft").map((e) => e.fromSkillId)).toEqual(
      ["b"],
    );
  });

  it("returns an empty list for an unknown skill", () => {
    expect(prerequisitesOf(index, "nope")).toEqual([]);
  });
});

describe("distancesToGoal", () => {
  it("measures hops backward from the goal along prerequisite edges", () => {
    const distances = distancesToGoal(buildIndex(chain), ["windows"]);
    expect(distances.get("windows")).toBe(0);
    expect(distances.get("joins")).toBe(1);
    expect(distances.get("basics")).toBe(2);
  });

  it("omits skills that cannot reach any goal skill", () => {
    const g = graph(
      [skill("a"), skill("b"), skill("unrelated")],
      [dependency("a", "b")],
    );
    const distances = distancesToGoal(buildIndex(g), ["b"]);
    expect(distances.has("unrelated")).toBe(false);
  });

  it("takes the shortest path when several goals are reachable", () => {
    const g = graph(
      [skill("root"), skill("near"), skill("far")],
      [dependency("root", "near"), dependency("near", "far")],
    );
    const distances = distancesToGoal(buildIndex(g), ["far", "near"]);
    expect(distances.get("root")).toBe(1);
  });

  it("skips goal ids that are not in the graph", () => {
    const distances = distancesToGoal(buildIndex(chain), ["ghost", "joins"]);
    expect(distances.has("ghost")).toBe(false);
    expect(distances.get("joins")).toBe(0);
  });

  it("does not revisit a goal listed twice", () => {
    const distances = distancesToGoal(buildIndex(chain), ["joins", "joins"]);
    expect(distances.get("joins")).toBe(0);
    expect(distances.get("basics")).toBe(1);
  });
});

describe("goalCriticality", () => {
  it("scores a goal skill at 1 and decays with distance", () => {
    const distances = distancesToGoal(buildIndex(chain), ["windows"]);
    expect(goalCriticality(distances, "windows")).toBe(1);
    expect(goalCriticality(distances, "joins")).toBe(0.5);
    expect(goalCriticality(distances, "basics")).toBeCloseTo(1 / 3, 12);
  });

  it("scores an unreachable skill at 0", () => {
    expect(goalCriticality(new Map(), "anything")).toBe(0);
  });
});

describe("detectCycle", () => {
  it("passes a clean DAG", () => {
    expect(detectCycle(chain)).toEqual({ hasCycle: false, cycle: [] });
  });

  it("passes a diamond, which is not a cycle", () => {
    const diamond = graph(
      [skill("a"), skill("b"), skill("c"), skill("d")],
      [
        dependency("a", "b"),
        dependency("a", "c"),
        dependency("b", "d"),
        dependency("c", "d"),
      ],
    );
    expect(detectCycle(diamond).hasCycle).toBe(false);
  });

  it("names the cycle it found, so a failing build is actionable", () => {
    const cyclic = graph(
      [skill("a"), skill("b"), skill("c")],
      [dependency("a", "b"), dependency("b", "c"), dependency("c", "a")],
    );
    const report = detectCycle(cyclic);
    expect(report.hasCycle).toBe(true);
    // The path starts and ends on the same skill.
    expect(report.cycle[0]).toBe(report.cycle[report.cycle.length - 1]);
    expect(new Set(report.cycle)).toEqual(new Set(["a", "b", "c"]));
  });

  it("detects a self-loop", () => {
    const selfLoop = graph([skill("a")], [dependency("a", "a")]);
    expect(detectCycle(selfLoop)).toEqual({
      hasCycle: true,
      cycle: ["a", "a"],
    });
  });

  it("finds a cycle that is not reachable from the first skill visited", () => {
    const g = graph(
      [skill("aaa"), skill("x"), skill("y")],
      [dependency("x", "y"), dependency("y", "x")],
    );
    expect(detectCycle(g).hasCycle).toBe(true);
  });
});

describe("requiredClosure", () => {
  it("is everything the goal transitively depends on", () => {
    const closure = requiredClosure(buildIndex(chain), ["windows"]);
    expect([...closure].sort()).toEqual(["basics", "joins", "windows"]);
  });

  it("excludes skills off the goal path", () => {
    const g = graph(
      [skill("needed"), skill("goal"), skill("extra")],
      [dependency("needed", "goal")],
    );
    const closure = requiredClosure(buildIndex(g), ["goal"]);
    expect(closure.has("extra")).toBe(false);
  });
});
