import { describe, expect, it } from "vitest";
import {
  CURRICULUM_MASTERED_THRESHOLD,
  lexicalSimilarity,
  runValidator,
  validateDeterministic,
  type SpotChecker,
  type ValidationInput,
} from "@/lib/curriculum/validate";
import { ALL_CHECKS, type CheckName } from "@/lib/contracts/curriculum";
import type {
  CurriculumDraft,
  CurriculumModule,
} from "@/lib/contracts/curriculum";
import type {
  EngineSkill,
  EngineSkillGraph,
  MasteryState,
} from "@/lib/engine";

/**
 * §14.6 — the anti-mediocrity gate.
 *
 * This is the file that decides whether a generated curriculum reaches a
 * learner, so what is tested here is not that the checks run but that each one
 * actually catches the thing it is named after. §24 E6's acceptance criteria
 * name three specific defects — a missing prerequisite, duplicate modules, and
 * 400 hours against a 20-hour budget — and each has its own case below.
 */

const NOW = "2026-08-13T09:00:00.000Z";
const priors = { pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.25 };

function skill(
  id: string,
  level: EngineSkill["level"] = "core",
): EngineSkill {
  return {
    id,
    slug: id,
    name: id,
    level,
    evalTier: 1,
    estimatedHours: 10,
    bktPriors: priors,
    canDoStatement: `Do ${id}`,
    area: "core",
  };
}

/** alpha → beta → gamma, all hard edges, plus an unconnected specialist. */
const GRAPH: EngineSkillGraph = {
  skills: [
    skill("alpha", "foundational"),
    skill("beta", "core"),
    skill("gamma", "advanced"),
    skill("delta", "specialist"),
  ],
  dependencies: [
    { fromSkillId: "alpha", toSkillId: "beta", type: "hard", strength: 1 },
    { fromSkillId: "beta", toSkillId: "gamma", type: "hard", strength: 1 },
  ],
};

function module(
  order: number,
  targetSkillIds: string[],
  overrides: Partial<CurriculumModule> = {},
): CurriculumModule {
  return {
    order,
    title: `Module ${order}: ${targetSkillIds.join(" and ")}`,
    targetSkillIds,
    estimatedHours: 10,
    outputArtifact: "exercise",
    acceptanceCriteria: [`You can do ${targetSkillIds.join(" and ")}`],
    rubricId: null,
    ...overrides,
  };
}

/** Three modules in dependency order — the clean baseline every case edits. */
function draft(
  modules: CurriculumModule[] = [
    module(0, ["alpha"]),
    module(1, ["beta"]),
    module(2, ["gamma"]),
  ],
  overrides: Partial<CurriculumDraft> = {},
): CurriculumDraft {
  return {
    modules,
    totalHours: modules.reduce((sum, m) => sum + m.estimatedHours, 0),
    rationale: "Build up from the foundations.",
    ...overrides,
  };
}

function mastery(
  skillId: string,
  value: number,
): MasteryState {
  return {
    skillId,
    mastery: value,
    confidence: 0.8,
    evidenceCount: 3,
    // Demonstrated now, so decay does not move the number out from under a test.
    lastSuccessAt: NOW,
    lastPracticedAt: NOW,
    decayHalfLifeDays: 7,
  };
}

function input(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    draft: draft(),
    graph: GRAPH,
    mastery: [],
    now: NOW,
    constraints: { weeklyHours: 5, deadline: null },
    rubricCriteria: new Map([["rubric-ok", 4]]),
    ...overrides,
  };
}

const find = (checks: ReturnType<typeof validateDeterministic>, name: CheckName) =>
  checks.find((c) => c.name === name)!;

const run = (overrides: Partial<ValidationInput> = {}) =>
  validateDeterministic(input(overrides));

const passing: SpotChecker = async () => ({
  passed: true,
  detail: "Nothing factually wrong found.",
});

describe("the report", () => {
  it("carries all nine checks, in the plan's order", async () => {
    // §24 E6: "all nine checks run and are reported". A check that quietly
    // stopped running is exactly what this asserts against.
    const report = await runValidator(input(), passing);
    expect(report.checks.map((c) => c.name)).toEqual([...ALL_CHECKS]);
    expect(report.checks).toHaveLength(9);
  });

  it("passes a clean curriculum", async () => {
    const report = await runValidator(input(), passing);
    expect(report.passed).toBe(true);
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
  });

  it("fails closed on a blocking check", async () => {
    const report = await runValidator(
      input({ draft: draft([module(0, ["invented-skill"]), module(1, ["beta"]), module(2, ["gamma"])]) }),
      passing,
    );
    expect(report.passed).toBe(false);
  });

  it("does not fail on warnings alone", async () => {
    // A warning is a thing to tell the learner about, not a reason to withhold
    // the curriculum — otherwise every path without a deadline would be blocked.
    const report = await runValidator(
      input({ constraints: { weeklyHours: 5, deadline: "2026-08-20" } }),
      passing,
    );
    const failed = report.checks.filter((c) => !c.passed);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((c) => c.severity === "warning")).toBe(true);
    expect(report.passed).toBe(true);
  });

  it("routes the factual spot-check through the injected model", async () => {
    const report = await runValidator(input(), async () => ({
      passed: false,
      detail: "Module 2 claims window functions predate SQL-92.",
    }));

    const spot = report.checks.find((c) => c.name === "factual_spotcheck")!;
    expect(spot.passed).toBe(false);
    expect(spot.detail).toContain("SQL-92");
    // §14.6's fail action is the human review queue — a model that missed a
    // factual error is not the thing to trust with repairing it.
    expect(spot.repair).toBeNull();
    expect(spot.severity).toBe("warning");
  });
});

describe("prerequisite completeness", () => {
  it("catches a module that starts before its hard prerequisite", () => {
    const checks = run({
      draft: draft([module(0, ["gamma"]), module(1, ["alpha"]), module(2, ["beta"])]),
    });
    const c = find(checks, "prereq_completeness");

    expect(c.passed).toBe(false);
    expect(c.severity).toBe("blocking");
    expect(c.detail).toContain("gamma needs beta");
    // §14.6's fail action is "insert the missing prerequisite", and the graph
    // says exactly which one — so the repair carries it.
    expect(c.repair).toEqual({
      insert: [{ order: 0, skillId: "gamma", needs: "beta" }],
    });
  });

  it("accepts a prerequisite the learner already holds", () => {
    const checks = run({
      draft: draft([module(0, ["beta"]), module(1, ["gamma"]), module(2, ["delta"])]),
      mastery: [mastery("alpha", 0.75)],
    });
    expect(find(checks, "prereq_completeness").passed).toBe(true);
  });

  it("lets one module bundle a skill with its prerequisite", () => {
    // §14.4 allows up to three skills per module, and teaching a skill together
    // with what it depends on is the most natural use of that.
    const checks = run({
      draft: draft([
        module(0, ["alpha", "beta"]),
        module(1, ["gamma"]),
        module(2, ["delta"]),
      ]),
    });
    expect(find(checks, "prereq_completeness").passed).toBe(true);
  });

  it("still catches a prerequisite that is nowhere in the path", () => {
    const checks = run({
      draft: draft([module(0, ["beta"]), module(1, ["gamma"]), module(2, ["delta"])]),
    });
    const c = find(checks, "prereq_completeness");
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("beta needs alpha");
  });
});

describe("no hallucinated skills", () => {
  it("rejects a skill the pack has never heard of", () => {
    const checks = run({
      draft: draft([
        module(0, ["alpha"]),
        module(1, ["prompt-engineering-mastery"]),
        module(2, ["gamma"]),
      ]),
    });
    const c = find(checks, "no_hallucinated_skills");

    expect(c.passed).toBe(false);
    expect(c.severity).toBe("blocking");
    expect(c.detail).toContain("prompt-engineering-mastery");
    // §14.6's fail action is "regenerate" — an invented skill cannot be
    // patched into existing.
    expect(c.repair).toBeNull();
  });

  it("passes when every skill is in the graph", () => {
    expect(find(run(), "no_hallucinated_skills").passed).toBe(true);
  });
});

describe("no redundancy", () => {
  it("catches duplicate modules", () => {
    // §24 E6's acceptance case: the same module emitted twice.
    const duplicate = module(2, ["gamma"]);
    const checks = run({
      draft: draft([
        module(0, ["alpha"]),
        module(1, ["beta"]),
        { ...duplicate, order: 2 },
        { ...duplicate, order: 3, title: duplicate.title },
      ]),
    });
    const c = find(checks, "no_redundancy");

    expect(c.passed).toBe(false);
    expect(c.severity).toBe("warning");
    expect(c.repair).toEqual({ merge: [{ a: 2, b: 3, similarity: 1 }] });
  });

  it("leaves genuinely different modules alone", () => {
    expect(find(run(), "no_redundancy").passed).toBe(true);
  });
});

describe("lexical similarity", () => {
  it("is 1 for identical text and 0 for disjoint text", () => {
    expect(lexicalSimilarity("write a join", "write a join")).toBe(1);
    expect(lexicalSimilarity("write joins", "photograph birds")).toBe(0);
  });

  it("counts shared filler words, which is why the bar sits at 0.85", () => {
    // "a" is the only thing these two have in common. A lexical measure cannot
    // tell a shared idea from a shared article, so the threshold is set high
    // enough that filler alone can never trip it.
    expect(lexicalSimilarity("write a join", "photograph a bird")).toBeCloseTo(
      0.33,
      2,
    );
  });

  it("ignores case and punctuation", () => {
    expect(lexicalSimilarity("Write a JOIN!", "write, a join")).toBe(1);
  });

  it("scores partial overlap between the two", () => {
    const score = lexicalSimilarity("write a join query", "write a window query");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("treats empty text as unrelated rather than identical", () => {
    expect(lexicalSimilarity("", "")).toBe(0);
    expect(lexicalSimilarity("", "anything")).toBe(0);
  });
});

describe("length sanity", () => {
  it("catches 400 hours against a 20-hour budget", () => {
    // §24 E6's acceptance case, and the one a learner would otherwise discover
    // in week six.
    const checks = run({
      draft: draft(undefined, { totalHours: 400 }),
      constraints: { weeklyHours: 5, deadline: "2026-09-10" },
    });
    const c = find(checks, "length_sanity");

    expect(c.passed).toBe(false);
    expect(c.detail).toContain("400h");
    // §14.6: "rescope; tell the user honestly" — so the honest number rides on
    // the repair rather than being left for the learner to work out.
    // Four weeks of a five-hour-a-week budget, to the day.
    expect(c.repair).toEqual({ targetHours: 19.7 });
  });

  it("accepts a total inside the ±25% band", () => {
    const checks = run({
      draft: draft(undefined, { totalHours: 22 }),
      constraints: { weeklyHours: 5, deadline: "2026-09-10" },
    });
    expect(find(checks, "length_sanity").passed).toBe(true);
  });

  it("says plainly that there is nothing to check without a deadline", () => {
    const c = find(run(), "length_sanity");
    expect(c.passed).toBe(true);
    expect(c.detail).toContain("No deadline");
  });

  it("fails a curriculum whose deadline has already passed", () => {
    const checks = run({
      constraints: { weeklyHours: 5, deadline: "2026-08-01" },
    });
    expect(find(checks, "length_sanity").passed).toBe(false);
  });
});

describe("difficulty ramp", () => {
  it("catches a path that steps back down", () => {
    const checks = run({
      draft: draft([
        module(0, ["alpha"]),
        module(1, ["gamma"]),
        module(2, ["beta"]),
      ]),
    });
    const c = find(checks, "difficulty_ramp");
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("steps back down");
  });

  it("catches a jump of more than two levels", () => {
    const checks = run({
      draft: draft([
        module(0, ["alpha"]),
        module(1, ["delta"]),
        module(2, ["delta"], { title: "Deeper specialist work" }),
      ]),
    });
    const c = find(checks, "difficulty_ramp");
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("jumps 3 levels");
  });

  it("accepts a monotonic ramp", () => {
    expect(find(run(), "difficulty_ramp").passed).toBe(true);
  });

  it("ignores a skill the graph does not know, leaving that to its own check", () => {
    const checks = run({
      draft: draft([
        module(0, ["alpha"]),
        module(1, ["ghost"]),
        module(2, ["gamma"]),
      ]),
    });
    expect(find(checks, "difficulty_ramp").passed).toBe(true);
    expect(find(checks, "no_hallucinated_skills").passed).toBe(false);
  });
});

describe("nothing already mastered", () => {
  it("catches a module teaching something the learner proved", () => {
    const checks = run({ mastery: [mastery("beta", 0.95)] });
    const c = find(checks, "no_already_mastered");

    expect(c.passed).toBe(false);
    // Blocking: "don't waste my time learning what I know" is the promise the
    // diagnostic exists to keep.
    expect(c.severity).toBe("blocking");
    expect(c.repair).toEqual({
      drop: [{ order: 1, skillId: "beta", mastery: 0.95 }],
    });
  });

  it("leaves a skill sitting exactly on the threshold", () => {
    const checks = run({
      mastery: [mastery("beta", CURRICULUM_MASTERED_THRESHOLD)],
    });
    expect(find(checks, "no_already_mastered").passed).toBe(true);
  });
});

describe("resource freshness", () => {
  it("says plainly that nothing has been researched yet", () => {
    const c = find(run(), "resource_freshness");
    expect(c.passed).toBe(true);
    expect(c.detail).toContain("Resource Researcher has not run");
  });

  it("passes reachable, current resources", () => {
    const checks = run({
      resources: [
        { url: "https://example.test/a", publishedAt: "2026-01-01", reachable: true },
      ],
    });
    expect(find(checks, "resource_freshness").passed).toBe(true);
  });

  it("flags unreachable and stale resources", () => {
    const checks = run({
      resources: [
        { url: "https://dead.test/x", publishedAt: "2026-01-01", reachable: false },
        { url: "https://old.test/y", publishedAt: "2019-01-01", reachable: true },
        { url: "https://ok.test/z", publishedAt: null, reachable: true },
      ],
    });
    const c = find(checks, "resource_freshness");

    expect(c.passed).toBe(false);
    expect(c.repair).toEqual({
      replace: ["https://dead.test/x", "https://old.test/y"],
    });
  });
});

describe("rubric coverage", () => {
  const project = (order: number, rubricId: string | null) =>
    module(order, ["gamma"], { outputArtifact: "project", rubricId });

  it("requires a project module to have a rubric", () => {
    const checks = run({
      draft: draft([module(0, ["alpha"]), module(1, ["beta"]), project(2, null)]),
    });
    const c = find(checks, "rubric_coverage");

    expect(c.passed).toBe(false);
    // §4.2 law 2 — the bar is published before the work starts.
    expect(c.severity).toBe("blocking");
    expect(c.detail).toContain("no rubric");
  });

  it("rejects a rubric that does not exist", () => {
    const checks = run({
      draft: draft([module(0, ["alpha"]), module(1, ["beta"]), project(2, "ghost")]),
    });
    expect(find(checks, "rubric_coverage").detail).toContain("does not exist");
  });

  it("rejects a rubric with too few criteria", () => {
    const checks = run({
      draft: draft([module(0, ["alpha"]), module(1, ["beta"]), project(2, "thin")]),
      rubricCriteria: new Map([["thin", 3]]),
    });
    expect(find(checks, "rubric_coverage").detail).toContain("needs 4");
  });

  it("accepts a project with a full rubric", () => {
    const checks = run({
      draft: draft([module(0, ["alpha"]), module(1, ["beta"]), project(2, "rubric-ok")]),
    });
    expect(find(checks, "rubric_coverage").passed).toBe(true);
  });

  it("does not demand a rubric from a non-project module", () => {
    expect(find(run(), "rubric_coverage").passed).toBe(true);
  });
});
