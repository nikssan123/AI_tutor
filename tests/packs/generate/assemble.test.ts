import { describe, expect, it } from "vitest";
import {
  GENERATED_QUALITY,
  MAX_REPORTED_ISSUES,
  assemblePack,
  enforceRatio,
  meetsQualityFloor,
} from "@/lib/packs/generate/assemble";
import { MAX_SLUG_LENGTH } from "@/lib/packs/types";
import { skillRef } from "@/lib/packs/generate/derive";
import { detectCycle } from "@/lib/engine/graph";
import { toEngineGraph } from "@/lib/packs/validate";
import type { CheckedResource } from "@/lib/packs/resources";
import type {
  DraftItem,
  DraftSkill,
  PackGraphDraft,
  RubricsDraft,
} from "@/lib/contracts/pack";

/**
 * `assemblePack` is where a model's three answers become something the engine
 * can run. It is pure, so all of this is exercised without a model — which is
 * the point: every rule the pack validator enforces is either satisfied here by
 * construction or the offending piece is dropped and reported.
 */

const skill = (
  i: number,
  over: Partial<DraftSkill> = {},
): DraftSkill => ({
  name: `Skill ${i}`,
  description: `A description for skill ${i} that is long enough.`,
  level: "core",
  area: `area-${i % 3}`,
  estimatedHours: 5,
  canDoStatement: `Do thing ${i} and produce something you can look at.`,
  observableEvidence: ["an artefact"],
  prerequisites: [],
  selfReportOnly: false,
  ...over,
});

const graphOf = (
  skills: DraftSkill[],
  over: Partial<PackGraphDraft> = {},
): PackGraphDraft => ({
  name: "Probe Subject",
  taxonomyParent: "technology",
  workspace: "code",
  skills,
  rationale: "because",
  ...over,
});

/** Three production items per skill, keyed by reference. */
const itemsFor = (skills: DraftSkill[]): DraftItem[] =>
  skills.flatMap((_, i) =>
    (["short_text", "explain", "micro_artifact"] as const).map((type, n) => ({
      skill: skillRef(i),
      type,
      difficulty: 0.2 + n * 0.2,
      prompt: `Prompt ${n} for skill ${i}, comfortably past the minimum.`,
      concepts: ["a checkable claim"],
    })),
  );

const RUBRICS: RubricsDraft = {
  rubrics: [
    {
      name: "The rubric",
      criteria: [1, 2, 3, 4].map((n) => ({
        name: `Criterion ${n}`,
        description: `What criterion ${n} judges, at length.`,
        weight: n,
        bands: {
          absent: "absent",
          developing: "developing",
          competent: "competent",
          strong: "strong",
        },
      })),
    },
  ],
  projects: [
    {
      title: "The project",
      brief: "A brief comfortably past the forty character minimum for briefs.",
      rubric: "The rubric",
      targetSkills: [skillRef(0)],
      evidenceType: "repo",
      difficulty: 0.5,
      estimatedMinutes: 120,
      acceptanceCriteria: ["it runs"],
    },
  ],
};

const resource = (over: Partial<CheckedResource> = {}): CheckedResource => ({
  url: "https://example.test/guide",
  title: "A Guide",
  publisher: "Example",
  kind: "tutorial",
  skills: ["s0"],
  assessment: "Good on the basics, stops before anything advanced.",
  publishedAt: "2025-01-15",
  reachable: true,
  checkedAt: "2026-08-15T00:00:00.000Z",
  ...over,
});

const assemble = (
  skills: DraftSkill[],
  over: {
    items?: DraftItem[];
    rubrics?: RubricsDraft;
    graph?: Partial<PackGraphDraft>;
    resources?: CheckedResource[];
  } = {},
) => {
  const { pack, report, dropped, reasons } = assemblePack({
    slug: "probe-subject",
    graph: graphOf(skills, over.graph),
    items: over.items ?? itemsFor(skills),
    rubrics: over.rubrics ?? RUBRICS,
    resources: over.resources ?? [],
  });

  /*
   * Narrowed once, here, rather than with a `!` at forty call sites. Every case
   * that uses this helper expects assembly to succeed; the two that expect it
   * to fail call `assemblePack` directly. A failure names its reasons, so a
   * regression reads as "assembly failed: items.20.slug: Too big" rather than
   * as a null dereference somewhere further down.
   */
  if (!pack || !report) {
    throw new Error(`assembly failed: ${reasons.join("; ")}`);
  }

  return { pack, report, dropped, reasons };
};

const EIGHT = Array.from({ length: 8 }, (_, i) => skill(i));

describe("assemblePack", () => {
  it("produces a pack that passes the validator", () => {
    const { pack, report } = assemble(EIGHT);
    expect(report.passed).toBe(true);
    expect(pack.skills).toHaveLength(8);
  });

  it("declares itself generated and unreviewed", () => {
    // §7.1 — depth is declared, never faked. A generated pack must never arrive
    // wearing a curated pack's badge.
    const { pack } = assemble(EIGHT);
    expect(pack.maturity).toBe("generated");
    expect(pack.quality).toEqual(GENERATED_QUALITY);
  });

  it("never claims tier 1, even in a machine-verifiable workspace", () => {
    const { pack } = assemble(EIGHT, { graph: { workspace: "code" } });
    expect(pack.evalTier).toBeGreaterThan(1);
    expect(pack.skills.every((s) => s.evalTier > 1)).toBe(true);
  });

  it("takes the pack's tier from its weakest skill", () => {
    // The badge cannot promise more than the least verifiable thing in the pack.
    const withSelfReport = [...EIGHT, skill(8, { selfReportOnly: true })];
    const { pack } = assemble(withSelfReport, {
      items: itemsFor(EIGHT),
    });
    expect(pack.evalTier).toBe(5);
  });

  it("seeds priors from the skill's level rather than from the model", () => {
    const { pack } = assemble([
      ...EIGHT.slice(0, 7),
      skill(7, { level: "foundational" }),
    ]);
    const foundational = pack.skills.find((s) => s.slug === "skill-7")!;
    expect(foundational.bktPriors.pInit).toBe(0.22);
  });

  describe("dependencies", () => {
    it("builds edges from prerequisites", () => {
      const skills = [skill(0), skill(1, { prerequisites: ["Skill 0"] })];
      const { pack } = assemble([...skills, ...EIGHT.slice(2)]);
      expect(pack.dependencies).toContainEqual({
        from: "skill-0",
        to: "skill-1",
        type: "hard",
        strength: 1,
      });
    });

    it("is acyclic by construction, whatever the model returned", () => {
      /*
       * The prompt asks for skills in dependency order with prerequisites named
       * from earlier in the list. A forward reference is dropped rather than
       * trusted, so an edge can only ever point backwards — and a graph whose
       * edges all point one way cannot contain a cycle.
       */
      const skills = [
        skill(0, { prerequisites: ["Skill 1"] }), // forward — must be dropped
        skill(1, { prerequisites: ["Skill 0"] }),
        ...EIGHT.slice(2),
      ];
      const { pack } = assemble(skills);
      expect(detectCycle(toEngineGraph(pack)).hasCycle).toBe(false);
    });

    it("reports a forward reference rather than silently ignoring it", () => {
      const skills = [
        skill(0, { prerequisites: ["Skill 1"] }),
        ...EIGHT.slice(1),
      ];
      const { dropped } = assemble(skills);
      expect(dropped.join(" ")).toContain("not earlier in the graph");
    });

    it("drops a prerequisite naming no skill in the pack", () => {
      const skills = [
        skill(0),
        skill(1, { prerequisites: ["Something Invented"] }),
        ...EIGHT.slice(2),
      ];
      const { pack, dropped } = assemble(skills);
      expect(dropped.join(" ")).toContain("names no skill");
      expect(pack.dependencies).toHaveLength(0);
    });

    it("keeps the first of two skills whose names collide when slugified", () => {
      // "Joins" and "JOINs" are different skills with the same loose form; the
      // prerequisite resolves to the one declared first rather than the later.
      const skills = [
        skill(0, { name: "Joins" }),
        skill(1, { name: "JOINs" }),
        skill(2, { prerequisites: ["joins"] }),
        ...EIGHT.slice(3),
      ];
      const { pack } = assemble(skills);
      expect(pack.dependencies).toContainEqual({
        from: "joins",
        to: "skill-2",
        type: "hard",
        strength: 1,
      });
    });

    it("resolves a prerequisite whose punctuation was tidied", () => {
      const skills = [
        skill(0, { name: "Ownership and `Copy`" }),
        skill(1, { prerequisites: ["Ownership and Copy"] }),
        ...EIGHT.slice(2),
      ];
      const { pack } = assemble(skills);
      expect(pack.dependencies).toHaveLength(1);
    });

    it("keeps a repeated edge only once", () => {
      const skills = [
        skill(0),
        skill(1, { prerequisites: ["Skill 0", "Skill 0"] }),
        ...EIGHT.slice(2),
      ];
      const { pack } = assemble(skills);
      expect(pack.dependencies).toHaveLength(1);
    });
  });

  describe("items", () => {
    it("resolves items by their skill reference", () => {
      const { pack } = assemble(EIGHT);
      expect(pack.items).toHaveLength(24);
      expect(new Set(pack.items.map((i) => i.skill)).size).toBe(8);
    });

    it("drops an item naming a skill that is not in the pack", () => {
      const items = [
        ...itemsFor(EIGHT),
        { ...itemsFor(EIGHT)[0]!, skill: "s99" },
      ];
      const { pack, dropped } = assemble(EIGHT, { items });
      expect(pack.items).toHaveLength(24);
      expect(dropped.join(" ")).toContain("unknown skill");
    });

    it("gives every item a unique slug", () => {
      const { pack } = assemble(EIGHT);
      expect(new Set(pack.items.map((i) => i.slug)).size).toBe(pack.items.length);
    });

    it("attaches options only to multiple choice", () => {
      const items: DraftItem[] = [
        ...itemsFor(EIGHT),
        {
          skill: skillRef(0),
          type: "mcq",
          difficulty: 0.5,
          prompt: "A multiple choice question, long enough to be valid.",
          options: ["a", "b", "c"],
          correct: 2,
        },
      ];
      const { pack } = assemble(EIGHT, { items });
      const mcq = pack.items.find((i) => i.type === "mcq")!;
      expect(mcq.options).toEqual(["a", "b", "c"]);
      expect(mcq.answerKey).toEqual({ correct: 2 });
      expect(pack.items.filter((i) => i.type !== "mcq").every((i) => i.options === undefined)).toBe(true);
    });

    it("drops a multiple-choice item with too few options", () => {
      const items: DraftItem[] = [
        ...itemsFor(EIGHT),
        {
          skill: skillRef(0),
          type: "mcq",
          difficulty: 0.5,
          prompt: "A broken multiple choice question with one option only.",
          options: ["a"],
        },
      ];
      const { pack, dropped } = assemble(EIGHT, { items });
      expect(pack.items.some((i) => i.type === "mcq")).toBe(false);
      expect(dropped.join(" ")).toContain("fewer than two options");
    });

    it("drops a multiple-choice item with no options at all", () => {
      const items: DraftItem[] = [
        ...itemsFor(EIGHT),
        {
          skill: skillRef(0),
          type: "mcq",
          difficulty: 0.5,
          prompt: "A multiple choice question the model gave no options for.",
        },
      ];
      const { pack, dropped } = assemble(EIGHT, { items });
      expect(pack.items.some((i) => i.type === "mcq")).toBe(false);
      expect(dropped.join(" ")).toContain("fewer than two options");
    });

    it("keeps a free-text item whose concepts the model omitted", () => {
      /*
       * An empty key means the learner marks themselves against nothing, which
       * is weak — but the prompt is still a real question, and the check's
       * self-mark step handles an empty key by showing no criteria rather than
       * by breaking. Dropping it would lose more than it saves.
       */
      const items: DraftItem[] = [
        ...itemsFor(EIGHT),
        {
          skill: skillRef(0),
          type: "short_text",
          difficulty: 0.5,
          prompt: "A written question the model gave no marking concepts for.",
        },
      ];
      const { pack } = assemble(EIGHT, { items });
      const orphan = pack.items.find((i) => i.slug === "skill-0-4")!;
      expect(orphan.answerKey).toEqual({ concepts: [] });
    });

    it("defaults a missing correct index rather than dropping the item", () => {
      const items: DraftItem[] = [
        ...itemsFor(EIGHT),
        {
          skill: skillRef(0),
          type: "mcq",
          difficulty: 0.5,
          prompt: "A multiple choice question whose key the model omitted.",
          options: ["a", "b"],
        },
      ];
      const { pack } = assemble(EIGHT, { items });
      expect(pack.items.find((i) => i.type === "mcq")!.answerKey).toEqual({
        correct: 0,
      });
    });
  });

  describe("rubrics and projects", () => {
    it("normalises criterion weights to sum to 1", () => {
      const { pack } = assemble(EIGHT);
      const sum = pack.rubrics[0]!.criteria.reduce((a, c) => a + c.weight, 0);
      expect(sum).toBe(1);
    });

    it("keeps a generated pack's briefs out of the public surface", () => {
      // §12.1 — a generated pack is never an SEO surface.
      const { pack } = assemble(EIGHT);
      expect(pack.projects.every((p) => !p.isPublic)).toBe(true);
    });

    it("drops a project naming a rubric that was not written", () => {
      const rubrics: RubricsDraft = {
        ...RUBRICS,
        projects: [
          { ...RUBRICS.projects[0]!, rubric: "A rubric nobody wrote" },
          RUBRICS.projects[0]!,
        ],
      };
      const { pack, dropped } = assemble(EIGHT, { rubrics });
      expect(pack.projects).toHaveLength(1);
      expect(dropped.join(" ")).toContain("which was not written");
    });

    it("drops an unresolvable skill from a project's target list", () => {
      const rubrics: RubricsDraft = {
        ...RUBRICS,
        projects: [
          {
            ...RUBRICS.projects[0]!,
            targetSkills: [skillRef(0), "s99"],
          },
        ],
      };
      const { pack, dropped } = assemble(EIGHT, { rubrics });
      expect(pack.projects[0]!.targetSkills).toEqual(["skill-0"]);
      expect(dropped.join(" ")).toContain("targets unknown skill");
    });

    it("drops a project that targets nothing the pack contains", () => {
      const rubrics: RubricsDraft = {
        ...RUBRICS,
        projects: [
          { ...RUBRICS.projects[0]!, targetSkills: ["s99"] },
          RUBRICS.projects[0]!,
        ],
      };
      const { pack, dropped } = assemble(EIGHT, { rubrics });
      expect(pack.projects).toHaveLength(1);
      expect(dropped.join(" ")).toContain("targets no skill");
    });

    it("resolves a rubric whose name the model tidied", () => {
      const rubrics: RubricsDraft = {
        rubrics: [{ ...RUBRICS.rubrics[0]!, name: "The “rubric”" }],
        projects: [{ ...RUBRICS.projects[0]!, rubric: "The rubric" }],
      };
      const { pack } = assemble(EIGHT, { rubrics });
      expect(pack.projects).toHaveLength(1);
    });
  });
});

describe("enforceRatio", () => {
  const item = (slug: string, type: "mcq" | "short_text") => ({
    slug,
    skill: "s",
    type,
    difficulty: 0.5,
    discrimination: 1,
    prompt: "a prompt long enough",
    answerKey: {},
  });

  it("leaves a bank that already holds the ratio alone", () => {
    const items = [
      item("a", "short_text"),
      item("b", "short_text"),
      item("c", "mcq"),
    ];
    expect(enforceRatio(items, [])).toHaveLength(3);
  });

  it("drops surplus multiple choice rather than failing the pack", () => {
    // §16.4 requires production to outnumber recognition 2:1, and the validator
    // blocks on it. Dropping is safe; keeping is not.
    const items = [
      item("a", "short_text"),
      item("b", "short_text"),
      item("c", "mcq"),
      item("d", "mcq"),
      item("e", "mcq"),
    ];
    const dropped: string[] = [];
    const kept = enforceRatio(items, dropped);

    const mcq = kept.filter((i) => i.type === "mcq").length;
    const production = kept.length - mcq;
    expect(production / mcq).toBeGreaterThanOrEqual(2);
    expect(dropped.join(" ")).toContain("production ratio");
  });

  it("keeps every production item", () => {
    const items = [
      item("a", "short_text"),
      item("b", "mcq"),
      item("c", "mcq"),
    ];
    const kept = enforceRatio(items, []);
    expect(kept.filter((i) => i.type === "short_text")).toHaveLength(1);
  });
});

describe("a draft the schema will not accept", () => {
  /**
   * The run that cost 297¢ and produced nothing.
   *
   * ".NET development" produced skill names long enough that their slugs hit
   * `MAX_SLUG_LENGTH` exactly. Item slugs were built by appending `-1`, `-2`,
   * so every item on those skills was two characters over, the pack failed its
   * own schema, and `assemblePack` *threw* — past the quality floor, past the
   * drop log, out of `generatePack` entirely, and into the queue as a step
   * failure it retried twice more at ~100¢ a go.
   */
  const longSkills = Array.from({ length: 8 }, (_, i) =>
    skill(i, {
      // 64 characters exactly, distinct per skill: the boundary, not past it.
      name: `Configure and tune the ${"very ".repeat(6)}long subsystem ${i}`,
    }),
  );

  it("assembles a pack whose every slug the schema accepts", () => {
    const { pack, reasons } = assemble(longSkills);

    expect(reasons).toEqual([]);
    for (const item of pack.items) {
      expect(item.slug.length, item.slug).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    }
    // And they are still distinct, which is what the engine keys on.
    expect(new Set(pack.items.map((i) => i.slug)).size).toBe(pack.items.length);
  });

  it("reports rather than throws when a draft cannot be parsed", () => {
    /*
     * Forced through a shape assembly cannot rescue — an empty skill list,
     * which `PackManifest` requires at least one of. What matters is not this
     * particular complaint but that it *returns*: a throw here is what the
     * queue read as transient and paid for three times.
     */
    const result = () =>
      assemblePack({
        slug: "probe-subject",
        graph: graphOf([]),
        items: [],
        rubrics: RUBRICS,
        resources: [],
      });

    expect(result).not.toThrow();
    const { pack, report, reasons } = result();
    expect(pack).toBeNull();
    expect(report).toBeNull();
    expect(reasons.length).toBeGreaterThan(0);
  });

  it("says only as much as a reader needs", () => {
    // One bad slug produces one complaint per item that used it — the real run
    // had twenty-two identical messages. The first few say all of it.
    const { reasons } = assemblePack({
      slug: "probe-subject",
      graph: graphOf([]),
      items: [],
      rubrics: RUBRICS,
      resources: [],
    });
    expect(reasons.length).toBeLessThanOrEqual(MAX_REPORTED_ISSUES);
  });
});

describe("the resource index", () => {
  it("resolves skill references and derives a slug from the title", () => {
    const { pack } = assemble(EIGHT, {
      resources: [resource({ title: "The Rust Book", skills: ["s0", "s2"] })],
    });

    expect(pack.resources).toHaveLength(1);
    expect(pack.resources[0]!.slug).toBe("the-rust-book");
    expect(pack.resources[0]!.skills).toEqual([
      pack.skills[0]!.slug,
      pack.skills[2]!.slug,
    ]);
  });

  it("drops a link the checker could not reach, and says which", () => {
    // The whole reason this call searches rather than recalls is to cite a page
    // that exists. Writing one the checker just disproved would be worse than
    // citing nothing.
    const { pack, dropped } = assemble(EIGHT, {
      resources: [
        resource({ title: "Gone", url: "https://example.test/404", reachable: false }),
        resource({ title: "Live" }),
      ],
    });

    expect(pack.resources.map((r) => r.title)).toEqual(["Live"]);
    expect(dropped.join(" ")).toContain("did not resolve");
  });

  it("drops a second citation of the same URL", () => {
    const { pack, dropped } = assemble(EIGHT, {
      resources: [
        resource({ title: "First" }),
        resource({ title: "Second" }),
      ],
    });

    expect(pack.resources).toHaveLength(1);
    expect(dropped.join(" ")).toContain("repeats");
  });

  it("drops a resource whose skills are all outside the pack", () => {
    const { pack, dropped } = assemble(EIGHT, {
      resources: [resource({ skills: ["s99"] })],
    });

    expect(pack.resources).toHaveLength(0);
    expect(dropped.join(" ")).toContain("covers no skill this pack contains");
  });

  it("prunes the unknown skills off a resource that still covers a real one", () => {
    // A resource good for three skills and wrong about a fourth is still good
    // for the three.
    const { pack } = assemble(EIGHT, {
      resources: [resource({ skills: ["s1", "s404"] })],
    });

    expect(pack.resources[0]!.skills).toEqual([pack.skills[1]!.slug]);
  });

  it("carries the dates through untouched", () => {
    // `publishedAt` is what §14.6 ages out and `checkedAt` is what makes
    // `reachable` readable as a finding. Either one invented here is a lie the
    // freshness check would then act on.
    const { pack } = assemble(EIGHT, {
      resources: [resource({ publishedAt: null })],
    });

    expect(pack.resources[0]!.publishedAt).toBeNull();
    expect(pack.resources[0]!.checkedAt).toBe("2026-08-15T00:00:00.000Z");
    expect(pack.resources[0]!.reachable).toBe(true);
  });

  it("leaves the pack valid when the research call returned nothing", () => {
    const { pack, report } = assemble(EIGHT, { resources: [] });
    expect(pack.resources).toEqual([]);
    expect(report.passed).toBe(true);
  });
});

describe("meetsQualityFloor", () => {
  it("passes a pack with enough items across enough skills", () => {
    const { pack, report } = assemble(EIGHT);
    expect(meetsQualityFloor(pack, report)).toEqual({ passed: true, reasons: [] });
  });

  it("fails a pack whose item bank is too thin to place anyone", () => {
    /*
     * The validator lets a Generated pack ship thin on purpose (§7.1 declares
     * depth rather than faking it). This is the generator's own floor, which is
     * a different question: is there enough here to be worth someone's time.
     */
    const { pack, report } = assemble(EIGHT, { items: itemsFor(EIGHT).slice(0, 6) });
    const floor = meetsQualityFloor(pack, report);
    expect(floor.passed).toBe(false);
    expect(floor.reasons.join(" ")).toContain("at least 24");
  });

  it("fails a pack where most skills cannot be assessed at all", () => {
    const items = itemsFor(EIGHT).filter((i) =>
      [skillRef(0), skillRef(1)].includes(i.skill),
    );
    const padded = [...items, ...Array.from({ length: 20 }, (_, n) => ({
      skill: skillRef(0),
      type: "short_text" as const,
      difficulty: 0.5,
      prompt: `Filler prompt number ${n}, long enough to be accepted.`,
      concepts: ["a claim"],
    }))];

    const floor = (() => { const a = assemble(EIGHT, { items: padded }); return meetsQualityFloor(a.pack, a.report); })();
    expect(floor.passed).toBe(false);
    expect(floor.reasons.join(" ")).toContain("assessable skills");
  });

  it("does not count self-report skills as gaps", () => {
    // §7.2 tier 5 cannot be assessed by anything, so having no items for it is
    // correct rather than a hole in the bank.
    const skills = [...EIGHT, skill(8, { selfReportOnly: true })];
    const { pack, report } = assemble(skills, { items: itemsFor(EIGHT) });
    expect(meetsQualityFloor(pack, report).passed).toBe(true);
  });

  it("rejects a pack the validator blocked, however good the bank is", () => {
    /*
     * `assemblePack` builds a pack that satisfies every blocking rule, so this
     * cannot happen today. It is the gate that means a regression in assembly
     * gets rejected instead of reaching a learner, and it is checked here with
     * a hand-made report rather than left as a branch nothing exercises.
     */
    const { pack } = assemble(EIGHT);
    const floor = meetsQualityFloor(pack, {
      packSlug: pack.slug,
      passed: false,
      issues: [
        {
          check: "dag_acyclic",
          severity: "blocking",
          message: "skill graph contains a cycle: a -> b -> a",
        },
        { check: "item_coverage", severity: "warning", message: "thin" },
      ],
      stats: {
        skills: 8,
        dependencies: 0,
        items: 24,
        productionItems: 24,
        mcqItems: 0,
        rubrics: 1,
        projects: 1,
        resources: 0,
        skillsWithoutItems: 0,
      },
    });

    expect(floor.passed).toBe(false);
    expect(floor.reasons).toEqual(["skill graph contains a cycle: a -> b -> a"]);
  });

  it("fails a pack whose every skill is self-reported", () => {
    // Nothing assessable at all: coverage is 0 rather than a division by zero.
    const skills = Array.from({ length: 8 }, (_, i) =>
      skill(i, { selfReportOnly: true }),
    );
    const { pack, report } = assemble(skills, {
      items: itemsFor(skills).concat(
        Array.from({ length: 20 }, (_, n) => ({
          skill: skillRef(0),
          type: "short_text" as const,
          difficulty: 0.5,
          prompt: `Filler prompt ${n}, long enough to be accepted here.`,
          concepts: ["a claim"],
        })),
      ),
    });

    expect(meetsQualityFloor(pack, report).passed).toBe(false);
  });

  it("fails a pack with nothing to grade", () => {
    const rubrics: RubricsDraft = {
      ...RUBRICS,
      projects: [{ ...RUBRICS.projects[0]!, targetSkills: ["s99"] }],
    };
    const floor = (() => { const a = assemble(EIGHT, { rubrics }); return meetsQualityFloor(a.pack, a.report); })();
    expect(floor.passed).toBe(false);
    expect(floor.reasons.join(" ")).toContain("nothing can be graded");
  });
});
