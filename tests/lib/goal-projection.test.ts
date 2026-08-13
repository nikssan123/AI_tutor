import { describe, expect, it } from "vitest";
import { projectSkills } from "@/lib/goals/projection";
import { MASTERY_TARGET, remainingHoursFor } from "@/lib/engine/scoring";
import type {
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
