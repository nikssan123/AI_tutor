import { describe, expect, it } from "vitest";
import { plan, serialisePlan, stableStringify } from "@/lib/engine/planner";
import { explainRatio, isApplySession } from "@/lib/engine/session-composer";
import { SCENARIOS } from "./fixtures/scenarios";
import { plannerInput } from "./support";

/**
 * §24 E5 acceptance criteria, asserted rather than assumed:
 *   - 20 hand-written scenarios
 *   - fully deterministic: identical inputs give byte-identical output
 *   - runs in <50ms
 *   - no LLM call in this path
 */

describe("planner scenarios", () => {
  it("covers all 20 scenarios from the acceptance criteria", () => {
    expect(SCENARIOS).toHaveLength(20);
    expect(new Set(SCENARIOS.map((s) => s.name)).size).toBe(20);
  });

  for (const scenario of SCENARIOS) {
    describe(scenario.name, () => {
      it(scenario.intent, () => {
        expect(serialisePlan(plan(scenario.input))).toMatchSnapshot();
      });

      it("is byte-identical on a repeat run", () => {
        // Determinism is the property that makes the plan explainable to a
        // learner and debuggable by us — so it is checked on every scenario,
        // not spot-checked on one.
        const first = serialisePlan(plan(scenario.input));
        const second = serialisePlan(plan(scenario.input));
        const third = serialisePlan(plan(structuredClone(scenario.input)));
        expect(second).toBe(first);
        expect(third).toBe(first);
      });

      it("never schedules more time than the learner has", () => {
        const result = plan(scenario.input);
        expect(result.totalMinutes).toBeLessThanOrEqual(
          scenario.input.constraints.availableMinutes,
        );
      });

      it("keeps explain blocks at or under half the session", () => {
        expect(explainRatio(plan(scenario.input).blocks)).toBeLessThanOrEqual(
          0.5,
        );
      });

      it("produces a gradeable artefact when it is an apply session", () => {
        const result = plan(scenario.input);
        if (
          isApplySession(scenario.input.sessionIndex) &&
          result.targetSkillIds.length > 0
        ) {
          expect(result.blocks.some((b) => b.type === "apply")).toBe(true);
        }
      });

      it("always explains itself in one sentence", () => {
        const { reason } = plan(scenario.input);
        expect(reason.length).toBeGreaterThan(0);
        expect(reason.trim()).toBe(reason);
        expect(reason.endsWith(".")).toBe(true);
      });
    });
  }
});

describe("performance (§24 E5: runs in <50ms)", () => {
  it("plans the widest scenario well inside the budget", () => {
    const wide = SCENARIOS.find((s) => s.name === "20-wide-graph")!;
    // Warm up so the measurement is of the planner, not of first-call JIT.
    for (let i = 0; i < 5; i += 1) plan(wide.input);

    const started = performance.now();
    for (let i = 0; i < 20; i += 1) plan(wide.input);
    const perRun = (performance.now() - started) / 20;

    expect(perRun).toBeLessThan(50);
  });

  it("plans every scenario inside the budget", () => {
    for (const scenario of SCENARIOS) {
      const started = performance.now();
      plan(scenario.input);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });
});

describe("planner behaviour", () => {
  it("plans for the injected date, never the wall clock", () => {
    // If this ever read Date.now(), the snapshot suite would rot overnight.
    const result = plan(
      plannerInput({ now: "2029-01-15T22:30:00.000Z", goalId: "g" }),
    );
    expect(result.plannedFor).toBe("2029-01-15");
  });

  it("says so honestly when nothing is unlocked", () => {
    const result = plan(
      plannerInput({ goalSkillIds: ["missing"], sessionIndex: 1 }),
    );
    expect(result.ranked).toEqual([]);
    expect(result.blocks).toEqual([]);
    expect(result.reason).toContain("Nothing is unlocked");
  });

  it("reports no compression when the plan is not compressed", () => {
    expect(plan(plannerInput()).compression).toBeNull();
  });

  it("carries the goal id and session index through unchanged", () => {
    const result = plan(
      plannerInput({ goalId: "goal-xyz", sessionIndex: 7 }),
    );
    expect(result.goalId).toBe("goal-xyz");
    expect(result.sessionIndex).toBe(7);
  });
});

describe("stableStringify", () => {
  it("sorts keys so two equivalent objects serialise identically", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts nested keys too", () => {
    expect(stableStringify({ outer: { z: 1, a: 2 } })).toBe(
      '{"outer":{"a":2,"z":1}}',
    );
  });

  it("preserves array order, which is meaningful", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("passes primitives and null through", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("x")).toBe('"x"');
    expect(stableStringify(true)).toBe("true");
  });

  it("sorts keys inside arrays of objects", () => {
    expect(stableStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });
});

describe("no LLM in the planner path (§14.9.1)", () => {
  it("makes no network call while planning", async () => {
    // "The planner appears twice and contains no LLM call — the loop is closed
    // by code, not by a model." Asserted, because a stray call here would be
    // invisible in the output but would show up on the bill and in the latency.
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      throw new Error("the planner must not make network calls");
    }) as typeof fetch;

    try {
      for (const scenario of SCENARIOS) {
        plan(scenario.input);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toBe(0);
  });
});
