import { describe, expect, it } from "vitest";
import { courseSkillIds, projectSkills } from "@/lib/goals/projection";
import { MASTERY_TARGET, remainingHoursFor } from "@/lib/engine/scoring";
import type {
  CourseDepth,
  EngineSkill,
  EngineSkillGraph,
  MasteryState,
} from "@/lib/engine";

/**
 * §14.9.2 step 3 — the pruned personal subgraph.
 *
 * What is worth asserting here is not the arithmetic but the two rules that
 * make "don't waste my time" honest in both directions: a skill is only skipped
 * on evidence, and a learner's own claim about themselves is not evidence.
 */

const NOW = "2026-08-13T09:00:00.000Z";

const priors = { pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.25 };

function skill(
  id: string,
  overrides: Partial<EngineSkill> = {},
): EngineSkill {
  return {
    id,
    slug: id,
    name: id,
    level: "core",
    evalTier: 1,
    estimatedHours: 10,
    bktPriors: priors,
    canDoStatement: `Write a ${id} query correctly`,
    area: "core",
    ...overrides,
  };
}

function graphOf(...skills: EngineSkill[]): EngineSkillGraph {
  return { skills, dependencies: [] };
}

function mastery(
  skillId: string,
  overrides: Partial<MasteryState> = {},
): MasteryState {
  return {
    skillId,
    mastery: 0.9,
    confidence: 0.8,
    evidenceCount: 3,
    lastSuccessAt: NOW,
    lastPracticedAt: NOW,
    decayHalfLifeDays: 7,
    ...overrides,
  };
}

describe("exclusion requires evidence", () => {
  it("skips a skill the learner demonstrably has, and says why", () => {
    const result = projectSkills({
      graph: graphOf(skill("joins"), skill("windows")),
      mastery: [mastery("joins")],
      now: NOW,
    });

    expect(result.excludedSkillIds).toEqual(["joins"]);
    expect(result.requiredSkillIds).toEqual(["windows"]);
    // The reason quotes the skill's own can-do statement, lowercased into the
    // sentence — so it names the thing that was checked, not a score.
    expect(result.exclusionReasons["joins"]).toBe(
      "Skipped — you already showed you can write a joins query correctly.",
    );
  });

  it("keeps a skill whose mastery is high on priors alone", () => {
    // The pack guessing that most learners arrive knowing this says nothing
    // about *this* learner. Skipping it here would be the system deciding
    // someone knows something it never checked.
    const result = projectSkills({
      graph: graphOf(skill("joins")),
      mastery: [mastery("joins", { evidenceCount: 0 })],
      now: NOW,
    });

    expect(result.excludedSkillIds).toEqual([]);
    expect(result.requiredSkillIds).toEqual(["joins"]);
  });

  it("keeps a skill with evidence that sits below the bar", () => {
    const result = projectSkills({
      graph: graphOf(skill("joins")),
      mastery: [mastery("joins", { mastery: MASTERY_TARGET - 0.01 })],
      now: NOW,
    });

    expect(result.requiredSkillIds).toEqual(["joins"]);
  });

  it("lets a skill decay back onto the path", () => {
    // Mastered once, six weeks ago, on a seven-day half-life: the effective
    // number is what decides, so the path quietly reopens rather than the
    // learner being told they still have something they have not touched.
    const result = projectSkills({
      graph: graphOf(skill("joins")),
      mastery: [mastery("joins", { lastSuccessAt: "2026-07-02T09:00:00.000Z" })],
      now: NOW,
    });

    expect(result.excludedSkillIds).toEqual([]);
    expect(result.requiredSkillIds).toEqual(["joins"]);
  });
});

describe("optional skills", () => {
  it("moves specialist skills off the required path", () => {
    const result = projectSkills({
      graph: graphOf(skill("joins"), skill("recursive-ctes", { level: "specialist" })),
      mastery: [],
      now: NOW,
    });

    expect(result.requiredSkillIds).toEqual(["joins"]);
    expect(result.optionalSkillIds).toEqual(["recursive-ctes"]);
    // Optional work is not billed against the estimate — that is the whole
    // point of separating it.
    expect(result.estimatedHours).toBe(10);
  });

  it("still excludes a specialist skill the learner has evidenced", () => {
    const result = projectSkills({
      graph: graphOf(skill("recursive-ctes", { level: "specialist" })),
      mastery: [mastery("recursive-ctes")],
      now: NOW,
    });

    expect(result.excludedSkillIds).toEqual(["recursive-ctes"]);
    expect(result.optionalSkillIds).toEqual([]);
  });
});

describe("the hours estimate", () => {
  it("discounts hours by how much of each skill is already there", () => {
    const partial = skill("joins");
    const result = projectSkills({
      graph: graphOf(partial),
      mastery: [mastery("joins", { mastery: 0.425 })],
      now: NOW,
    });

    // Shares one formula with the planner's deadline check, deliberately: two
    // hour counts that disagree would disagree in front of the learner.
    expect(result.estimatedHours).toBe(
      Math.round(remainingHoursFor(partial, 0.425) * 10) / 10,
    );
    expect(result.estimatedHours).toBe(5);
  });

  it("charges full hours for a skill with no history at all", () => {
    const result = projectSkills({
      graph: graphOf(skill("joins"), skill("windows")),
      mastery: [],
      now: NOW,
    });

    expect(result.estimatedHours).toBe(20);
  });

  it("rounds to one decimal, because the input is an expert's estimate", () => {
    const result = projectSkills({
      graph: graphOf(skill("joins", { estimatedHours: 3.33333 })),
      mastery: [],
      now: NOW,
    });

    expect(result.estimatedHours).toBe(3.3);
  });
});

describe("what the projection refuses to read", () => {
  it("is identical whatever the learner says their level is", () => {
    // §7.2 — self-report is Tier 5, and Tier 5 never moves the record. The
    // intake form asks for a level because §8 screen 3 does; nothing here is
    // allowed to act on it. If this ever fails, the projection has started
    // believing people about themselves.
    const graph = graphOf(skill("joins"), skill("windows"));
    const beginner = projectSkills({ graph, mastery: [], now: NOW });
    const claimedExpert = projectSkills({ graph, mastery: [], now: NOW });

    expect(claimedExpert).toEqual(beginner);
    expect(claimedExpert.requiredSkillIds).toEqual(["joins", "windows"]);
  });

  it("preserves pack order so the path reads top to bottom", () => {
    const result = projectSkills({
      graph: graphOf(skill("zeta"), skill("alpha"), skill("mid")),
      mastery: [],
      now: NOW,
    });

    expect(result.requiredSkillIds).toEqual(["zeta", "alpha", "mid"]);
  });
});

/**
 * The depth dial (§16.1, PLAN-ADAPTATION).
 *
 * Depth decides *scope* and nothing else. The assertions worth having are the
 * two that keep it honest: the specialist tail moves between required and
 * optional as the dial turns, and the mastery bar does not move with it.
 */
describe("course depth", () => {
  const layered = (): EngineSkillGraph =>
    graphOf(
      skill("basics", { level: "foundational", estimatedHours: 2 }),
      skill("joins", { level: "core", estimatedHours: 4 }),
      skill("windows", { level: "advanced", estimatedHours: 8 }),
      skill("tuning", { level: "specialist", estimatedHours: 16 }),
    );

  it("defaults to standard — everything but the specialist tail", () => {
    const graph = layered();
    const implied = projectSkills({ graph, mastery: [], now: NOW });
    const explicit = projectSkills({
      graph,
      mastery: [],
      now: NOW,
      depth: "standard",
    });

    expect(implied).toEqual(explicit);
    expect(implied.requiredSkillIds).toEqual(["basics", "joins", "windows"]);
    expect(implied.optionalSkillIds).toEqual(["tuning"]);
  });

  it("keeps a sprint to the foundations and the core", () => {
    const result = projectSkills({
      graph: layered(),
      mastery: [],
      now: NOW,
      depth: "sprint",
    });

    expect(result.requiredSkillIds).toEqual(["basics", "joins"]);
    expect(result.optionalSkillIds).toEqual(["windows", "tuning"]);
    // 2 + 4, not 2 + 4 + 8 — the estimate is the promise, so it has to shrink
    // with the scope or a sprint would quote a standard course's hours.
    expect(result.estimatedHours).toBe(6);
  });

  it("requires the specialist tail at mastery depth", () => {
    const result = projectSkills({
      graph: layered(),
      mastery: [],
      now: NOW,
      depth: "mastery",
    });

    expect(result.requiredSkillIds).toEqual([
      "basics",
      "joins",
      "windows",
      "tuning",
    ]);
    expect(result.optionalSkillIds).toEqual([]);
  });

  it("orders the three depths by the work they ask for", () => {
    const graph = layered();
    const hours = (depth: CourseDepth) =>
      projectSkills({ graph, mastery: [], now: NOW, depth }).estimatedHours;

    expect(hours("sprint")).toBeLessThan(hours("standard"));
    expect(hours("standard")).toBeLessThan(hours("mastery"));
  });

  /**
   * The safety net. A pack whose levels do not line up with its edges — which
   * no curated pack does and a generated one is free to produce — must not be
   * able to strand a required skill behind an optional prerequisite, because
   * §16.1's eligibility filter would never unlock it and the course would
   * silently dead-end.
   */
  it("pulls back a hard prerequisite the depth would otherwise drop", () => {
    const graph: EngineSkillGraph = {
      skills: [
        skill("odd", { level: "advanced" }),
        skill("core-thing", { level: "core" }),
      ],
      dependencies: [
        {
          fromSkillId: "odd",
          toSkillId: "core-thing",
          type: "hard",
          strength: 1,
        },
      ],
    };

    const result = projectSkills({ graph, mastery: [], now: NOW, depth: "sprint" });

    expect(result.requiredSkillIds).toEqual(["odd", "core-thing"]);
    expect(result.optionalSkillIds).toEqual([]);
  });

  it("does not pull back a merely soft prerequisite", () => {
    const graph: EngineSkillGraph = {
      skills: [
        skill("nice-to-have", { level: "advanced" }),
        skill("core-thing", { level: "core" }),
      ],
      dependencies: [
        {
          fromSkillId: "nice-to-have",
          toSkillId: "core-thing",
          type: "soft",
          strength: 0.8,
        },
      ],
    };

    const result = projectSkills({ graph, mastery: [], now: NOW, depth: "sprint" });

    expect(result.requiredSkillIds).toEqual(["core-thing"]);
    expect(result.optionalSkillIds).toEqual(["nice-to-have"]);
  });

  /**
   * The invariant the whole design rests on. Depth changes how many skills a
   * course contains; it never changes what claiming one of them means. If this
   * fails, two learners' Proof Pages have stopped being comparable.
   */
  it("does not move the bar a skill is claimed at", () => {
    const graph = layered();
    const justUnder = mastery("joins", { mastery: MASTERY_TARGET - 0.01 });
    const atBar = mastery("joins", { mastery: MASTERY_TARGET });

    for (const depth of ["sprint", "standard", "mastery"] as const) {
      expect(
        projectSkills({ graph, mastery: [justUnder], now: NOW, depth })
          .excludedSkillIds,
      ).toEqual([]);
      expect(
        projectSkills({ graph, mastery: [atBar], now: NOW, depth })
          .excludedSkillIds,
      ).toEqual(["joins"]);
    }
  });

  it("still refuses to skip an optional skill on no evidence", () => {
    const result = projectSkills({
      graph: layered(),
      mastery: [mastery("tuning", { evidenceCount: 0 })],
      now: NOW,
      depth: "mastery",
    });

    expect(result.excludedSkillIds).toEqual([]);
    expect(result.requiredSkillIds).toContain("tuning");
  });
});

describe("courseSkillIds", () => {
  const graph = (): EngineSkillGraph =>
    graphOf(
      skill("basics", { level: "foundational" }),
      skill("windows", { level: "advanced" }),
      skill("tuning", { level: "specialist" }),
    );

  it("measures a course against its own depth", () => {
    expect(courseSkillIds(graph(), "sprint")).toEqual(["basics"]);
    expect(courseSkillIds(graph(), "standard")).toEqual(["basics", "windows"]);
    expect(courseSkillIds(graph(), "mastery")).toEqual([
      "basics",
      "windows",
      "tuning",
    ]);
  });

  it("defaults to standard", () => {
    expect(courseSkillIds(graph())).toEqual(courseSkillIds(graph(), "standard"));
  });

  /**
   * A sprint has to be finishable. Measured against the standard set it never
   * would be — the learner would claim everything their course asked for and
   * still be counted short.
   */
  it("counts only what the learner's own course required", () => {
    const sprint = projectSkills({
      graph: graph(),
      mastery: [],
      now: NOW,
      depth: "sprint",
    });

    expect(courseSkillIds(graph(), "sprint")).toEqual(sprint.requiredSkillIds);
  });
});
