import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadPack } from "@/lib/packs/loader";
import {
  assertValid,
  MIN_PRODUCTION_TO_MCQ_RATIO,
  PackValidationError,
  toEngineGraph,
  validatePack,
} from "@/lib/packs/validate";
import { PRODUCTION_ITEM_TYPES } from "@/lib/packs/types";
import type { DomainPack } from "@/lib/packs/types";

const FIXTURES = "tests/fixtures/packs";
const fixture = (name: string) => loadPack(join(FIXTURES, name));

/** Blocking check names raised by a pack, for concise assertions. */
function blockingChecks(pack: DomainPack): string[] {
  return validatePack(pack)
    .issues.filter((i) => i.severity === "blocking")
    .map((i) => i.check)
    .sort();
}

describe("the control fixture", () => {
  it("passes every check", () => {
    const report = validatePack(fixture("valid-minimal"));
    expect(report.passed).toBe(true);
    expect(report.issues.filter((i) => i.severity === "blocking")).toEqual([]);
  });

  it("reports accurate statistics", () => {
    const { stats } = validatePack(fixture("valid-minimal"));
    expect(stats).toMatchObject({
      skills: 2,
      dependencies: 1,
      items: 4,
      productionItems: 3,
      mcqItems: 1,
      rubrics: 1,
      projects: 1,
      skillsWithoutItems: 0,
    });
  });
});

describe("§14.4 — a cycle is a build failure, not a warning", () => {
  it("catches a cycle and names the path", () => {
    const report = validatePack(fixture("cyclic"));
    expect(report.passed).toBe(false);

    const cycle = report.issues.find((i) => i.check === "dag_acyclic");
    expect(cycle?.severity).toBe("blocking");
    // Naming the path is the difference between a fixable failure and a riddle.
    expect(cycle?.message).toMatch(/alpha -> beta -> alpha/);
  });

  it("catches a self-dependency as both a self-loop and a cycle", () => {
    expect(blockingChecks(fixture("self-dependency"))).toContain(
      "no_self_dependency",
    );
    expect(blockingChecks(fixture("self-dependency"))).toContain("dag_acyclic");
  });
});

describe("hallucinated references", () => {
  it("catches a dependency on a skill that does not exist", () => {
    const report = validatePack(fixture("unknown-skill"));
    expect(report.passed).toBe(false);
    expect(
      report.issues.find((i) => i.check === "no_hallucinated_skills")?.message,
    ).toMatch(/does-not-exist/);
  });

  it("catches a dependency whose prerequisite does not exist", () => {
    const pack = fixture("valid-minimal");
    pack.dependencies.push({
      from: "ghost",
      to: "beta",
      type: "hard",
      strength: 1,
    });
    const message = validatePack(pack).issues.find(
      (i) => i.check === "no_hallucinated_skills",
    )?.message;
    expect(message).toContain("unknown prerequisite skill");
  });

  it("catches an item pointing at a missing skill", () => {
    const pack = fixture("valid-minimal");
    pack.items.push({ ...pack.items[0]!, slug: "ghost-item", skill: "ghost" });
    expect(blockingChecks(pack)).toContain("no_hallucinated_skills");
  });

  it("catches a project pointing at a missing rubric", () => {
    const pack = fixture("valid-minimal");
    pack.projects[0]!.rubric = "no-such-rubric";
    expect(blockingChecks(pack)).toContain("rubric_coverage");
  });

  it("catches a project targeting a missing skill", () => {
    const pack = fixture("valid-minimal");
    pack.projects[0]!.targetSkills = ["ghost"];
    expect(blockingChecks(pack)).toContain("no_hallucinated_skills");
  });
});

describe("§16.4 — recall over recognition", () => {
  it("rejects an MCQ-heavy item bank", () => {
    const report = validatePack(fixture("mcq-heavy"));
    const issue = report.issues.find(
      (i) => i.check === "recall_over_recognition",
    );
    expect(issue?.severity).toBe("blocking");
    expect(issue?.message).toContain(`${MIN_PRODUCTION_TO_MCQ_RATIO}:1`);
  });

  it("accepts a bank with no multiple-choice at all", () => {
    // Dividing by zero MCQs must not fail the check.
    const pack = fixture("valid-minimal");
    pack.items = pack.items.filter((i) => i.type !== "mcq");
    expect(blockingChecks(pack)).not.toContain("recall_over_recognition");
  });

  it("counts every production type toward the ratio", () => {
    const pack = fixture("valid-minimal");
    pack.items = PRODUCTION_ITEM_TYPES.map((type, index) => ({
      ...pack.items[0]!,
      slug: `item-${index}`,
      type,
      options: undefined,
    }));
    const { stats } = validatePack(pack);
    expect(stats.productionItems).toBe(PRODUCTION_ITEM_TYPES.length);
    expect(stats.mcqItems).toBe(0);
  });
});

describe("§7.1 — depth is declared, so severity depends on maturity", () => {
  it("blocks a curated pack with an unassessable skill", () => {
    // A Curated pack shows a "Deeply supported" badge. A skill the diagnostic
    // cannot place a learner on makes that badge a lie.
    const report = validatePack(fixture("orphan-skill"));
    const issue = report.issues.find((i) => i.check === "item_coverage");
    expect(issue?.severity).toBe("blocking");
    expect(issue?.message).toContain("beta");
  });

  it("only warns for a standard pack with the same gap", () => {
    const pack = fixture("orphan-skill");
    pack.maturity = "standard";
    const issue = validatePack(pack).issues.find(
      (i) => i.check === "item_coverage",
    );
    expect(issue?.severity).toBe("warning");
  });

  it("warns rather than blocks on a thin bank in a generated pack", () => {
    const pack = fixture("valid-minimal");
    pack.maturity = "generated";
    const issue = validatePack(pack).issues.find(
      (i) => i.check === "item_minimum",
    );
    expect(issue?.severity).toBe("warning");
    expect(validatePack(pack).passed).toBe(true);
  });
});

describe("rubrics", () => {
  it("rejects criterion weights that do not sum to 1", () => {
    const report = validatePack(fixture("bad-weights"));
    const issue = report.issues.find((i) => i.check === "rubric_weights");
    expect(issue?.severity).toBe("blocking");
    expect(issue?.message).toContain("1.500");
  });

  it("rejects duplicate criterion ids within a rubric", () => {
    const pack = fixture("valid-minimal");
    const first = pack.rubrics[0]!.criteria[0]!;
    pack.rubrics[0]!.criteria[1] = { ...first, weight: 0.2 };
    expect(blockingChecks(pack)).toContain("unique_criteria");
  });

  it("accepts weights within floating-point tolerance", () => {
    const pack = fixture("valid-minimal");
    pack.rubrics[0]!.criteria = pack.rubrics[0]!.criteria.map((c) => ({
      ...c,
      weight: 1 / 4,
    }));
    expect(blockingChecks(pack)).not.toContain("rubric_weights");
  });
});

describe("duplicates", () => {
  it.each([
    ["skill", (p: DomainPack) => p.skills.push({ ...p.skills[0]! })],
    ["item", (p: DomainPack) => p.items.push({ ...p.items[0]! })],
    ["rubric", (p: DomainPack) => p.rubrics.push({ ...p.rubrics[0]! })],
    ["project", (p: DomainPack) => p.projects.push({ ...p.projects[0]! })],
  ])("rejects a duplicate %s slug", (_label, mutate) => {
    const pack = fixture("valid-minimal");
    mutate(pack);
    expect(blockingChecks(pack)).toContain("unique_slugs");
  });

  it("rejects a duplicate dependency edge", () => {
    const pack = fixture("valid-minimal");
    pack.dependencies.push({ ...pack.dependencies[0]! });
    expect(blockingChecks(pack)).toContain("unique_edges");
  });
});

describe("item shape", () => {
  it("rejects a multiple-choice item with fewer than two options", () => {
    const pack = fixture("valid-minimal");
    const mcq = pack.items.find((i) => i.type === "mcq")!;
    mcq.options = undefined;
    expect(blockingChecks(pack)).toContain("mcq_needs_options");
  });

  it("warns when a non-MCQ item carries options", () => {
    const pack = fixture("valid-minimal");
    pack.items[0]!.options = ["a", "b"];
    const issue = validatePack(pack).issues.find(
      (i) => i.check === "options_only_on_mcq",
    );
    expect(issue?.severity).toBe("warning");
  });
});

describe("§7.2 — tier claims must be backed", () => {
  it("warns when a Tier 1 pack ships nothing to machine-verify", () => {
    const pack = fixture("valid-minimal");
    pack.evalTier = 1;
    pack.projects = [];
    const issue = validatePack(pack).issues.find(
      (i) => i.check === "tier_1_needs_projects",
    );
    expect(issue?.severity).toBe("warning");
  });
});

describe("toEngineGraph", () => {
  it("maps slugs to engine ids and preserves edge direction", () => {
    const graph = toEngineGraph(fixture("valid-minimal"));
    expect(graph.skills.map((s) => s.id)).toEqual(["alpha", "beta"]);
    expect(graph.dependencies[0]).toEqual({
      fromSkillId: "alpha",
      toSkillId: "beta",
      type: "hard",
      strength: 1,
    });
  });

  it("carries the fields the planner scores on", () => {
    const [alpha] = toEngineGraph(fixture("valid-minimal")).skills;
    expect(alpha).toMatchObject({
      area: "basics",
      evalTier: 2,
      estimatedHours: 1,
      level: "foundational",
    });
    expect(alpha!.bktPriors.pInit).toBe(0.2);
  });
});

describe("assertValid", () => {
  it("returns the report for a valid pack", () => {
    expect(assertValid(fixture("valid-minimal")).passed).toBe(true);
  });

  it("throws a PackValidationError listing every blocking issue", () => {
    try {
      assertValid(fixture("cyclic"));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PackValidationError);
      const message = (error as PackValidationError).message;
      expect(message).toContain("cyclic");
      expect(message).toContain("dag_acyclic");
      expect((error as PackValidationError).report.passed).toBe(false);
    }
  });
});

describe("the real SQL pack", () => {
  const pack = loadPack("packs/sql-data-analysis");
  const report = validatePack(pack);

  it("passes validation", () => {
    expect(report.issues.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("is a genuine Curated pack, not a stub", () => {
    // §7.1 sets the bar for the "Deeply supported" badge; §23 Phase 0 sets the
    // shape: ~25 skills, ~40 items, 4 projects with full rubrics.
    expect(pack.maturity).toBe("curated");
    expect(report.stats.skills).toBeGreaterThanOrEqual(25);
    expect(report.stats.items).toBeGreaterThanOrEqual(40);
    expect(report.stats.projects).toBe(4);
    expect(report.stats.rubrics).toBe(4);
  });

  it("assesses every skill it claims to teach", () => {
    expect(report.stats.skillsWithoutItems).toBe(0);
  });

  it("clears the recall-over-recognition bar with room to spare", () => {
    expect(report.stats.productionItems / report.stats.mcqItems).toBeGreaterThan(
      MIN_PRODUCTION_TO_MCQ_RATIO,
    );
  });

  it("gives every project a rubric with at least four criteria", () => {
    for (const project of pack.projects) {
      const rubric = pack.rubrics.find((r) => r.slug === project.rubric);
      expect(rubric, `rubric for ${project.slug}`).toBeDefined();
      expect(rubric!.criteria.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("spreads skills across several areas so interleaving has somewhere to go", () => {
    const areas = new Set(pack.skills.map((s) => s.area));
    expect(areas.size).toBeGreaterThanOrEqual(5);
  });
});
