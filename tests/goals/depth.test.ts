import { describe, expect, it } from "vitest";
import { depthOptions } from "@/lib/goals/depth";
import { projectSkills } from "@/lib/goals/projection";
import { MASTERY_TARGET } from "@/lib/engine/scoring";
import type {
  CourseDepth,
  EngineSkill,
  EngineSkillGraph,
  MasteryState,
} from "@/lib/engine";

/**
 * The depth dial as the path screen sees it (PLAN-ADAPTATION).
 *
 * The screen makes two promises: the hours shown are *this* learner's, and
 * switching cannot cost them something they proved. Both are asserted here
 * rather than trusted, because both are sentences printed on the page.
 */

const NOW = "2026-08-13T09:00:00.000Z";
const priors = { pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.25 };

function skill(id: string, overrides: Partial<EngineSkill> = {}): EngineSkill {
  return {
    id,
    slug: id,
    name: id,
    level: "core",
    evalTier: 1,
    estimatedHours: 4,
    bktPriors: priors,
    canDoStatement: `Do ${id} correctly`,
    area: "core",
    ...overrides,
  };
}

function mastery(
  skillId: string,
  overrides: Partial<MasteryState> = {},
): MasteryState {
  return {
    skillId,
    mastery: 0.95,
    confidence: 0.8,
    evidenceCount: 3,
    lastSuccessAt: NOW,
    lastPracticedAt: NOW,
    decayHalfLifeDays: 7,
    ...overrides,
  };
}

const graph = (): EngineSkillGraph => ({
  skills: [
    skill("basics", { level: "foundational", estimatedHours: 2 }),
    skill("joins", { level: "core", estimatedHours: 4 }),
    skill("windows", { level: "advanced", estimatedHours: 8 }),
    skill("tuning", { level: "specialist", estimatedHours: 16 }),
  ],
  dependencies: [],
});

describe("depthOptions", () => {
  it("prices all three depths, in order", () => {
    const options = depthOptions({
      graph: graph(),
      mastery: [],
      now: NOW,
      current: "standard",
    });

    expect(options.map((o) => o.depth)).toEqual([
      "sprint",
      "standard",
      "mastery",
    ]);
    expect(options.map((o) => o.skillCount)).toEqual([2, 3, 4]);
    expect(options.map((o) => o.estimatedHours)).toEqual([6, 14, 30]);
  });

  it("marks exactly one option as the current course", () => {
    const options = depthOptions({
      graph: graph(),
      mastery: [],
      now: NOW,
      current: "sprint",
    });

    expect(options.filter((o) => o.current).map((o) => o.depth)).toEqual([
      "sprint",
    ]);
  });

  /**
   * The reason the options are projected rather than described. A learner who
   * has proved the core sees a sprint that is genuinely short *for them* — if
   * this ever returned the brochure number, the button would promise hours the
   * path screen would then contradict.
   */
  it("prices against what the learner has already proved", () => {
    const options = depthOptions({
      graph: graph(),
      mastery: [mastery("joins")],
      now: NOW,
      current: "standard",
    });

    const sprint = options.find((o) => o.depth === "sprint")!;
    // `basics` only — `joins` is excluded on evidence, not counted.
    expect(sprint.skillCount).toBe(1);
    expect(sprint.estimatedHours).toBe(2);
  });

  it("names what switching down stops asking for", () => {
    const options = depthOptions({
      graph: graph(),
      mastery: [],
      now: NOW,
      current: "mastery",
    });

    const sprint = options.find((o) => o.depth === "sprint")!;
    expect(sprint.dropped).toEqual(["windows", "tuning"]);
    expect(sprint.added).toEqual([]);
  });

  it("names what switching up takes on", () => {
    const options = depthOptions({
      graph: graph(),
      mastery: [],
      now: NOW,
      current: "sprint",
    });

    const mastered = options.find((o) => o.depth === "mastery")!;
    expect(mastered.added).toEqual(["windows", "tuning"]);
    expect(mastered.dropped).toEqual([]);
  });

  it("has nothing to add or drop for the depth already set", () => {
    for (const current of ["sprint", "standard", "mastery"] as const) {
      const options = depthOptions({
        graph: graph(),
        mastery: [],
        now: NOW,
        current,
      });
      const self = options.find((o) => o.depth === current)!;
      expect(self.dropped).toEqual([]);
      expect(self.added).toEqual([]);
    }
  });

  it("agrees with the header the path screen already prints", () => {
    const options = depthOptions({
      graph: graph(),
      mastery: [],
      now: NOW,
      current: "standard",
    });
    const standard = options.find((o) => o.current)!;

    // The card and the header read the same projection, so a learner cannot be
    // shown two different sizes for the course they are actually on.
    expect(standard.skillCount).toBe(3);
    expect(standard.estimatedHours).toBe(14);
  });
});

/**
 * The sentence the path screen prints: "switching never takes away a skill
 * you've already proved."
 *
 * Asserted here rather than guarded in production code, because it is a
 * property of `projectSkills` — exclusion is decided on evidence and never
 * consults depth — and a runtime check for it could only ever return true.
 */
describe("what a switch cannot cost", () => {
  const excludedAt = (m: MasteryState[], depth: CourseDepth) =>
    projectSkills({ graph: graph(), mastery: m, now: NOW, depth })
      .excludedSkillIds;

  it("excludes exactly the same proved skills at every depth", () => {
    const proved = [mastery("joins"), mastery("windows")];

    expect(excludedAt(proved, "sprint")).toEqual(["joins", "windows"]);
    expect(excludedAt(proved, "standard")).toEqual(["joins", "windows"]);
    expect(excludedAt(proved, "mastery")).toEqual(["joins", "windows"]);
  });

  it("keeps a claim on a skill the new depth stops requiring", () => {
    // `tuning` is specialist: optional at sprint, required at mastery. Proved
    // either way, so switching down cannot un-prove it.
    const proved = [mastery("tuning")];

    for (const depth of ["sprint", "standard", "mastery"] as const) {
      expect(excludedAt(proved, depth)).toEqual(["tuning"]);
    }
  });

  it("holds at the bar itself", () => {
    const atBar = [mastery("tuning", { mastery: MASTERY_TARGET })];

    for (const depth of ["sprint", "standard", "mastery"] as const) {
      expect(excludedAt(atBar, depth)).toEqual(["tuning"]);
    }
  });
});
