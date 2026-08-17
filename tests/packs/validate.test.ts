import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadAllPacks, loadPack } from "@/lib/packs/loader";
import {
  assertValid,
  MIN_PRODUCTION_TO_MCQ_RATIO,
  PackValidationError,
  toEngineGraph,
  toEngineItems,
  toEngineProjects,
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
});

/**
 * The real defect: across the seven shipped packs the correct option was never
 * in position A and was in position B 76% of the time, 6/6 in two packs. Every
 * item was individually right, so nothing that reads one item at a time could
 * see it — which is the argument for checking it here rather than in review.
 */
describe("multiple-choice answer position", () => {
  function withAnswers(positions: number[]) {
    const pack = fixture("valid-minimal");
    const mcq = pack.items.find((i) => i.type === "mcq")!;
    pack.items = [
      ...pack.items.filter((i) => i.type !== "mcq"),
      ...positions.map((correct, index) => ({
        ...mcq,
        slug: `mcq-${index}`,
        options: ["a", "b", "c", "d"],
        answerKey: { correct },
      })),
    ];
    return pack;
  }

  it("rejects a pack where one position holds most of the answers", () => {
    const report = validatePack(withAnswers([1, 1, 1, 1, 1, 1]));
    const issue = report.issues.find((i) => i.check === "mcq_answer_position");
    expect(issue?.severity).toBe("blocking");
    // Reported as the option a learner sees (1-based), not the stored index.
    expect(issue?.message).toContain("option 2");
    expect(issue?.message).toContain("100%");
  });

  it("accepts an evenly spread bank", () => {
    expect(blockingChecks(withAnswers([0, 1, 2, 3, 0, 2]))).not.toContain(
      "mcq_answer_position",
    );
  });

  it("allows exactly half, and rejects one more than half", () => {
    expect(blockingChecks(withAnswers([0, 0, 1, 2]))).not.toContain(
      "mcq_answer_position",
    );
    expect(blockingChecks(withAnswers([0, 0, 0, 1]))).toContain(
      "mcq_answer_position",
    );
  });

  /**
   * Below four MCQs the share is noise — three items cannot be spread across
   * four positions, and failing a small honest pack would push authors toward
   * padding the bank rather than balancing it.
   */
  it("ignores a bank too small for the share to mean anything", () => {
    expect(blockingChecks(withAnswers([1, 1, 1]))).not.toContain(
      "mcq_answer_position",
    );
  });

  it("holds for every pack in the repository", () => {
    for (const pack of loadAllPacks()) {
      expect(blockingChecks(pack), pack.slug).not.toContain(
        "mcq_answer_position",
      );
    }
  });

  /**
   * The rule stops short of demanding the impossible.
   *
   * Spreading `n` answers over `k` positions cannot get the busiest one below
   * `ceil(n / k) / n`. Three or more options always leave that at or under a
   * half, so nothing about an ordinary bank changes — but two options with an
   * odd count put the floor *above* a half, and the flat rule then failed a
   * pack that no rewrite could have saved. A gate nothing can pass only spends
   * money: it cost one build 149¢ before it was measured.
   */
  it("asks for the best achievable when half is arithmetically impossible", () => {
    const twoWay = (positions: number[]) => {
      const pack = withAnswers(positions);
      for (const item of pack.items) {
        if (item.type === "mcq") item.options = ["true", "false"];
      }
      return pack;
    };

    // Five true/false answers can only ever split 3–2. That is 60%, and it is
    // the best there is, so it passes.
    expect(blockingChecks(twoWay([0, 0, 0, 1, 1]))).not.toContain(
      "mcq_answer_position",
    );
    // 4 of 5 is not the best there is, and is still refused.
    expect(blockingChecks(twoWay([0, 0, 0, 0, 1]))).toContain(
      "mcq_answer_position",
    );
    // And an even bank of them keeps the ordinary half rule.
    expect(blockingChecks(twoWay([0, 0, 0, 1]))).toContain(
      "mcq_answer_position",
    );
    expect(blockingChecks(twoWay([0, 0, 1, 1]))).not.toContain(
      "mcq_answer_position",
    );
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
    // A Curated pack shows a "Written and checked by hand" badge. A skill the diagnostic
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

describe("§7.1 — the resource index", () => {
  it("blocks a resource covering a skill the pack does not have", () => {
    const pack = fixture("valid-minimal");
    pack.resources[0]!.skills = ["gamma"];
    expect(blockingChecks(pack)).toContain("no_hallucinated_skills");
  });

  it("warns — never blocks — on a link that did not resolve", () => {
    /*
     * The finding is that a page did not answer when the checker looked, which
     * is a reason to stop recommending it and not a reason to refuse to load
     * the pack: the rest of it still teaches. Assembly drops these before a
     * generated pack is written, so a warning here means a link died *after*
     * authoring — exactly what a re-check is for.
     */
    const pack = fixture("valid-minimal");
    pack.resources[0]!.reachable = false;
    const issue = validatePack(pack).issues.find(
      (i) => i.check === "resource_reachable",
    );

    expect(issue?.severity).toBe("warning");
    expect(validatePack(pack).passed).toBe(true);
    // The date is the point: "did not resolve" with no when is not a finding.
    expect(issue?.message).toContain("2026-08-01");
  });

  it("says so plainly when nobody has ever checked the link", () => {
    const pack = fixture("valid-minimal");
    pack.resources[1]!.reachable = false;
    const issue = validatePack(pack).issues.find(
      (i) => i.check === "resource_reachable",
    );
    expect(issue?.message).toContain("did not resolve when last checked");
    expect(issue?.message).not.toContain("(");
  });

  it("warns when two resources cite the same page", () => {
    const pack = fixture("valid-minimal");
    pack.resources[1]!.url = pack.resources[0]!.url;
    const issue = validatePack(pack).issues.find(
      (i) => i.check === "unique_resources",
    );
    expect(issue?.severity).toBe("warning");
  });

  it("blocks two resources sharing a slug, because the engine keys on it", () => {
    const pack = fixture("valid-minimal");
    pack.resources[1]!.slug = pack.resources[0]!.slug;
    expect(blockingChecks(pack)).toContain("unique_slugs");
  });

  it("counts them, so a reviewer can see a pack nobody researched", () => {
    expect(validatePack(fixture("valid-minimal")).stats.resources).toBe(2);
    expect(
      validatePack({ ...fixture("valid-minimal"), resources: [] }).stats
        .resources,
    ).toBe(0);
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

describe("toEngineItems", () => {
  it("hands the planner every authored question, with what marks it", () => {
    const items = toEngineItems(fixture("valid-minimal"));

    expect(items.map((i) => i.itemId)).toEqual([
      "alpha-write",
      "alpha-explain",
      "beta-write",
      "beta-pick",
    ]);
    // The types come through untouched — the composer decides which of them a
    // textarea can ask, and it is the only thing that should decide.
    expect(items[0]).toMatchObject({
      skillId: "alpha",
      type: "short_text",
      difficulty: 0.2,
      prompt: "Write out how you would do the alpha thing.",
    });
    // No answer key on this one, so `expected` falls back to the can-do
    // statement rather than leaving a grader with nothing to mark against.
    expect(items[0]!.expected).toBe(
      fixture("valid-minimal").skills[0]!.canDoStatement,
    );
  });

  it("drops an item whose skill is not in the pack", () => {
    // The validator rejects such a pack, so this is the hand-edited case: the
    // alternative is serving a question against a skill that does not exist,
    // and marking the answer into nothing.
    const pack = fixture("valid-minimal");
    const items = toEngineItems({
      ...pack,
      items: [...pack.items, { ...pack.items[0]!, slug: "ghost", skill: "gone" }],
    });

    expect(items.map((i) => i.itemId)).not.toContain("ghost");
    expect(items).toHaveLength(pack.items.length);
  });
});

describe("toEngineProjects", () => {
  it("carries the rubric onto the work, so the brief and the marking agree", () => {
    const pack = fixture("valid-minimal");
    const projects = toEngineProjects(pack);

    expect(projects).toHaveLength(pack.projects.length);
    expect(projects[0]).toMatchObject({
      projectId: pack.projects[0]!.slug,
      rubricId: pack.projects[0]!.rubric,
      title: pack.projects[0]!.title,
      brief: pack.projects[0]!.brief,
      estimatedMinutes: pack.projects[0]!.estimatedMinutes,
    });
    // The three things a learner is owed before they start.
    expect(projects[0]!.acceptanceCriteria).toEqual(
      pack.projects[0]!.acceptanceCriteria,
    );
  });

  it("drops a project whose rubric is not in the pack", () => {
    // A project with no rubric cannot be marked, and offering work nobody can
    // mark is worse than offering none. The validator rejects such a pack, so
    // this is the hand-edited case.
    const pack = fixture("valid-minimal");
    const projects = toEngineProjects({
      ...pack,
      projects: [
        ...pack.projects,
        { ...pack.projects[0]!, slug: "orphan", rubric: "no-such-rubric" },
      ],
    });

    expect(projects.map((p) => p.projectId)).not.toContain("orphan");
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
    // §7.1 sets the bar for the "Written and checked by hand" badge; §23 Phase 0 sets the
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

/**
 * §24 E8.5 — the fit between a rubric and the brief that publishes it.
 *
 * Every one of these is a defect no single criterion contains, which is why
 * they are validator rules rather than schema constraints: each is only visible
 * when you read a project and its rubric together. `reconcileEvidence`
 * satisfies all three by construction for a generated pack; these make them
 * true of a hand-authored one as well.
 *
 * The control fixture ships a written-only project and text-only criteria, so
 * every case below is a mutation away from a pack that passes.
 */
describe("evidence and what judges it", () => {
  const withImages = (pack: DomainPack) => {
    pack.projects[0]!.evidence = { image: "required", images: 2 };
    return pack;
  };

  it("passes a pack whose photographs are asked for and judged", () => {
    const pack = withImages(fixture("valid-minimal"));
    pack.rubrics[0]!.criteria[0]!.marks = "both";
    expect(blockingChecks(pack)).toEqual([]);
  });

  describe("a criterion may only judge a photograph its project asks for", () => {
    it("blocks one on a written-only brief", () => {
      const pack = fixture("valid-minimal");
      pack.rubrics[0]!.criteria[0]!.marks = "image";

      const report = validatePack(pack);
      expect(blockingChecks(pack)).toContain("criterion_evidence");
      expect(
        report.issues.find((i) => i.check === "criterion_evidence")?.message,
      ).toContain("asks for none");
    });

    it("blocks `both` for the same reason as `image`", () => {
      // Half of `both` is still a claim to have looked at something that will
      // never be handed in.
      const pack = fixture("valid-minimal");
      pack.rubrics[0]!.criteria[0]!.marks = "both";
      expect(blockingChecks(pack)).toContain("criterion_evidence");
    });

    it("blocks one in a rubric no project hands work in against", () => {
      const pack = fixture("valid-minimal");
      pack.rubrics.push({
        ...pack.rubrics[0]!,
        slug: "orphan-rubric",
        criteria: pack.rubrics[0]!.criteria.map((c, i) =>
          i === 0 ? { ...c, marks: "image" as const } : c,
        ),
      });

      const report = validatePack(pack);
      expect(
        report.issues.find((i) => i.check === "criterion_evidence")?.message,
      ).toContain("no project hands work in");
    });

    it("takes the strict reading when two projects share a rubric", () => {
      /*
       * One of them takes no photographs, so the criterion would be judging
       * something half its submissions cannot contain. "Its project" has a
       * single answer only if it means every project marked by that rubric.
       */
      const pack = withImages(fixture("valid-minimal"));
      pack.rubrics[0]!.criteria[0]!.marks = "image";
      pack.projects.push({
        ...pack.projects[0]!,
        slug: "prose-only-project",
        evidence: { image: "none", images: 1 },
      });

      expect(blockingChecks(pack)).toContain("criterion_evidence");
    });
  });

  describe("every rubric keeps something the verifier can anchor to", () => {
    it("blocks a rubric that reads nothing from the write-up", () => {
      /*
       * §14.5's check asks whether a quote appears in the submitted text, and a
       * photograph has no text spans. Every criterion would be invalidated and
       * the evaluation would collapse rather than degrade — a 0% that is about
       * us rather than about the learner's work.
       */
      const pack = withImages(fixture("valid-minimal"));
      for (const criterion of pack.rubrics[0]!.criteria) criterion.marks = "image";

      const report = validatePack(pack);
      expect(blockingChecks(pack)).toContain("rubric_anchor");
      expect(
        report.issues.find((i) => i.check === "rubric_anchor")?.message,
      ).toContain("no quote could be checked");
    });

    it("counts `both`, because it quotes the write-up like any other", () => {
      // The rule protects the deterministic check having text to run against,
      // not the presence of the word `text` in a field.
      const pack = withImages(fixture("valid-minimal"));
      for (const criterion of pack.rubrics[0]!.criteria) criterion.marks = "image";
      pack.rubrics[0]!.criteria[0]!.marks = "both";

      expect(blockingChecks(pack)).not.toContain("rubric_anchor");
    });

    it("says nothing about a rubric with no criteria", () => {
      // Empty is caught by the schema's own minimum, not by this rule.
      const pack = withImages(fixture("valid-minimal"));
      pack.rubrics[0]!.criteria = [];
      expect(blockingChecks(pack)).not.toContain("rubric_anchor");
    });
  });

  describe("a required photograph must change some band", () => {
    it("blocks a brief that demands one no criterion judges", () => {
      /*
       * The `one-vegetable-four-cuts` defect in different clothes: that project
       * targeted `food-safety` and no criterion assessed it, so a learner's
       * mastery of not poisoning anyone moved on how evenly they diced a
       * carrot. A photograph nothing looks at is the same bargain — work
       * demanded that cannot affect the verdict.
       */
      const pack = withImages(fixture("valid-minimal"));

      const report = validatePack(pack);
      expect(blockingChecks(pack)).toContain("required_image_unjudged");
      expect(
        report.issues.find((i) => i.check === "required_image_unjudged")?.message,
      ).toContain("no criterion");
    });

    it("allows an optional photograph nothing judges", () => {
      // Offered as context rather than demanded, so nothing was asked for that
      // cannot count.
      const pack = fixture("valid-minimal");
      pack.projects[0]!.evidence = { image: "optional", images: 1 };
      expect(blockingChecks(pack)).toEqual([]);
    });

    it("says nothing when the rubric is missing entirely", () => {
      // `rubric_coverage` is the check for that, and reporting both would name
      // one defect twice.
      const pack = withImages(fixture("valid-minimal"));
      pack.projects[0]!.rubric = "no-such-rubric";

      expect(blockingChecks(pack)).toContain("rubric_coverage");
      expect(blockingChecks(pack)).not.toContain("required_image_unjudged");
    });
  });

  it("passes every pack in the repository", () => {
    // The rules were written after the packs, so this is the assertion that
    // says they describe what we already believed rather than a new opinion.
    for (const pack of loadAllPacks()) {
      expect(blockingChecks(pack), pack.slug).toEqual([]);
    }
  });
});
