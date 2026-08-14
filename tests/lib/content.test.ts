import { describe, expect, it } from "vitest";
import {
  allPacks,
  allProjects,
  allTopics,
  findPack,
  findProject,
  findSkill,
  isTopicIndexable,
  projectDetails,
  resetContentCache,
  search,
  skillDetails,
  SKILL_CHECKS_ARE_NEVER_INDEXED,
  topicSummary,
} from "@/lib/content";
import { MAX_TIER_WITHOUT_EXECUTION } from "@/lib/evaluation/tier";
import type { DomainPack } from "@/lib/packs/types";

/**
 * The marketing content model. The property that matters most is §12.1's
 * structural defence: a page is indexable only when the thing it describes
 * genuinely exists and works. Nothing here may default to true.
 */

const pack = findPack("sql-data-analysis")!;

describe("allPacks", () => {
  it("loads the real packs and caches them", () => {
    expect(allPacks()).toBe(allPacks());
    expect(allPacks().map((p) => p.slug).sort()).toEqual([
      "business-writing",
      "home-cooking",
      "personal-finance",
      "photography",
      "python-fundamentals",
      "spanish-reading-writing",
      "sql-data-analysis",
      "statistics-data-literacy",
    ]);
  });

  /**
   * §7.1's whole premise is that this is horizontal — "all kinds of users can
   * sign up to learn all kinds of skills". That claim is only true if the
   * catalogue actually spans domains, so it is asserted rather than assumed:
   * one technical, one professional, one creative, across three evaluation
   * tiers and three workspaces.
   *
   * If this ever fails because the catalogue collapsed back to a single
   * technical subject, the product has quietly become a developer tool.
   */
  it("spans domains, tiers and workspaces (§7.1)", () => {
    // Asserted as "contains", not "equals". The guard is against the catalogue
    // *collapsing* to a single technical subject, and equality made every
    // addition a failure — a new workspace is the thing this test wants, not a
    // regression it should report.
    const packs = allPacks();
    const has = <T,>(values: T[], required: T[]) => {
      for (const value of required) expect(new Set(values)).toContain(value);
    };

    has(packs.map((p) => p.taxonomyParent), [
      "technology",
      "business",
      "creative",
    ]);
    has(packs.map((p) => p.evalTier), [1, 2, 3]);
    has(packs.map((p) => p.workspace), ["query-sheet", "text", "media"]);
    expect(packs.filter((p) => p.taxonomyParent !== "technology").length)
      .toBeGreaterThanOrEqual(2);
  });

  /**
   * §4.2 law 3 — never overclaim. Tier 3 promises "technical feedback;
   * aesthetic judgement is yours", so a photography rubric that scored beauty
   * would break the promise the page makes. Enforced here because a rubric is
   * data, and data has no type system to stop it.
   */
  it("keeps Tier 3 rubrics off aesthetic judgement (§7.2)", () => {
    const aesthetic = /\b(beaut|artist|creativ|pleasing|striking|tasteful|evocative)/i;
    for (const pack of allPacks().filter((p) => p.evalTier >= 3)) {
      for (const rubric of pack.rubrics) {
        for (const criterion of rubric.criteria) {
          expect(
            aesthetic.test(`${criterion.name} ${criterion.description}`),
            `${pack.slug}/${rubric.slug}: "${criterion.name}"`,
          ).toBe(false);
        }
      }
    }
  });

  it("rebuilds after a reset", () => {
    const first = allPacks();
    resetContentCache();
    expect(allPacks()).not.toBe(first);
  });
});

describe("findPack", () => {
  it("finds a pack by slug", () => {
    expect(findPack("sql-data-analysis")?.name).toBe("SQL & Data Analysis");
  });

  it("returns undefined for an unknown slug", () => {
    expect(findPack("no-such-pack")).toBeUndefined();
  });
});

describe("§12.1 — indexing is earned, never granted", () => {
  /**
   * Asserted against synthetic packs rather than whichever real pack happens to
   * be signed off today. This test used the SQL pack as its example of an
   * unreviewed one and inverted the moment SQL was reviewed — a gate test that
   * depends on content state is testing the content, not the gate.
   */
  it("refuses to index a pack with no recorded reviewer", () => {
    const unsigned = {
      ...pack,
      maturity: "curated" as const,
      quality: { ...pack.quality, reviewedBy: "unreviewed" },
    };
    expect(isTopicIndexable(unsigned)).toBe(false);
  });

  it("indexes a Curated pack once a reviewer is recorded", () => {
    const reviewed = {
      ...pack,
      quality: { ...pack.quality, reviewedBy: "nixon" },
    };
    expect(isTopicIndexable(reviewed)).toBe(true);
  });

  /**
   * **The gate checks that a reviewer is named, not that they are human.**
   *
   * §7.1 calls the Curated tier "human-reviewed" and the badge says "checked by
   * hand", so the string in `reviewedBy` is load-bearing in a way the code
   * cannot enforce — anything other than the literal "unreviewed" opens it.
   * `sql-data-analysis` is currently signed by a model review, at Nikolay's
   * request and recorded as such in its own `quality` block.
   *
   * Pinned here so the discrepancy is visible in the suite rather than only in
   * a YAML comment: if the badge is ever to mean what it says, this is the seam
   * to close.
   */
  it("cannot tell a human reviewer from any other kind", () => {
    const byModel = {
      ...pack,
      quality: { ...pack.quality, reviewedBy: "Claude Opus 5 (model review)" },
    };
    expect(isTopicIndexable(byModel)).toBe(true);
  });

  it("never indexes a Standard or Generated pack, reviewed or not", () => {
    for (const maturity of ["standard", "generated"] as const) {
      const other: DomainPack = {
        ...pack,
        maturity,
        quality: { ...pack.quality, reviewedBy: "nixon" },
      };
      expect(isTopicIndexable(other), maturity).toBe(false);
    }
  });

  it("keeps the per-skill check out of the index until that tool exists", () => {
    // §2.6 calls the skill-assessment SERP "the crack in the wall", and E4 built
    // the tool that earns it — for a whole subject. A check for one skill on its
    // own is still unbuilt, and that page still says so, so it stays out.
    expect(SKILL_CHECKS_ARE_NEVER_INDEXED).toBe(false);
  });
});

describe("the tier a public page is allowed to quote", () => {
  /**
   * The bug this exists for: the SQL pack declares `evalTier: 1`, the evaluator
   * caps at 2 because nothing executes a learner's work, and every public
   * surface read the declared number — so /learn, /projects, /check and the
   * share cards all said "We run your work and check the answer is right."
   * True nowhere. §4.2 law 3, on the pages the product is sold from.
   */
  it("never hands out tier 1, because nothing executes anything", () => {
    expect(pack.evalTier).toBe(1);
    expect(topicSummary(pack).evalTier).toBe(MAX_TIER_WITHOUT_EXECUTION);
  });

  it("caps the briefs and the skills too, not just the subject", () => {
    for (const project of projectDetails(pack)) {
      expect(project.evalTier, project.slug).toBeGreaterThanOrEqual(
        MAX_TIER_WITHOUT_EXECUTION,
      );
    }
    for (const skill of skillDetails(pack)) {
      expect(skill.evalTier, skill.slug).toBeGreaterThanOrEqual(
        MAX_TIER_WITHOUT_EXECUTION,
      );
    }
  });

  it("leaves a weaker declared tier exactly where it is", () => {
    // The cap only ever moves a claim *down*. A tier-5 skill does not become
    // tier 2 because we would like it to.
    const weak = { ...pack, evalTier: 5 as const };
    expect(topicSummary(weak).evalTier).toBe(5);
  });

  it("holds for every pack that ships, not only for SQL", () => {
    for (const topic of allTopics()) {
      expect(topic.evalTier, topic.slug).toBeGreaterThanOrEqual(
        MAX_TIER_WITHOUT_EXECUTION,
      );
    }
  });
});

describe("topicSummary", () => {
  const summary = topicSummary(pack);

  it("counts skills, projects and hours from the pack itself", () => {
    expect(summary.skillCount).toBe(26);
    expect(summary.projectCount).toBe(4);
    expect(summary.totalHours).toBeGreaterThan(40);
  });

  it("lists the areas in graph order without duplicates", () => {
    expect(summary.areas.length).toBeGreaterThanOrEqual(5);
    expect(new Set(summary.areas).size).toBe(summary.areas.length);
    expect(summary.areas[0]).toBe("foundations");
  });

  it("carries the declared maturity through unchanged", () => {
    // Maturity is a fact about how the pack was written and passes through.
    // The tier deliberately does not — see the tier describe above. This
    // assertion used to require `evalTier === 1`, which is how the overclaim
    // survived: the bug was not merely untested, it was pinned in place.
    expect(summary.maturity).toBe("curated");
  });
});

describe("allTopics", () => {
  it("sorts by name so the listing is stable", () => {
    /*
     * Compared with the same comparator `allTopics` uses. This asserted against
     * a bare `.sort()`, which orders by UTF-16 code unit — so it agreed only
     * while no two names differed by case in their first few characters. "SQL &
     * Data Analysis" and "Spanish: Reading & Writing" are the pair that broke
     * it: a bare sort puts SQL first because 'Q' (81) precedes 'p' (112), and a
     * reader looking for an alphabetical list expects Spanish first.
     */
    const names = allTopics().map((t) => t.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});

describe("skillDetails", () => {
  const skills = skillDetails(pack);
  const joinGrain = skills.find((s) => s.slug === "join-grain")!;

  it("resolves hard and soft prerequisites separately", () => {
    // The planner gates on hard edges only; conflating them would lock
    // learners out of material they could handle.
    expect(joinGrain.hardPrerequisites).toContain("outer-joins");
    expect(joinGrain.hardPrerequisites).toContain("group-by-grain");
    expect(joinGrain.softPrerequisites).toContain("distinct-and-duplicates");
    expect(joinGrain.hardPrerequisites).not.toContain(
      "distinct-and-duplicates",
    );
  });

  it("resolves what a skill unlocks", () => {
    expect(joinGrain.unlocks).toContain("query-performance");
    expect(joinGrain.unlocks).toContain("result-validation");
  });

  it("counts the item bank behind each skill", () => {
    expect(joinGrain.itemCount).toBeGreaterThan(0);
    // A Curated pack assesses every skill it claims to teach.
    expect(skills.every((s) => s.itemCount > 0)).toBe(true);
  });

  it("carries the can-do statement, which is the bar the page states", () => {
    expect(joinGrain.canDoStatement).toContain("grain");
  });

  it("reports no prerequisites for a starting-point skill", () => {
    const start = skills.find((s) => s.slug === "select-projection")!;
    expect(start.hardPrerequisites).toEqual([]);
    expect(start.softPrerequisites).toEqual([]);
  });
});

describe("findSkill", () => {
  it("finds a skill within a topic", () => {
    expect(findSkill("sql-data-analysis", "join-grain")?.skill.name).toBe(
      "Join grain and fan-out",
    );
  });

  it("returns undefined for an unknown topic", () => {
    expect(findSkill("nope", "join-grain")).toBeUndefined();
  });

  it("returns undefined for an unknown skill in a real topic", () => {
    expect(findSkill("sql-data-analysis", "nope")).toBeUndefined();
  });
});

describe("projectDetails", () => {
  const projects = projectDetails(pack);

  it("attaches the full rubric each project is graded against", () => {
    // §4.2 law 2 — the rubric is public *before* the work is done, so it has to
    // be on the page, not behind a signup.
    for (const project of projects) {
      expect(project.rubricDetail.criteria.length).toBeGreaterThanOrEqual(4);
      for (const criterion of project.rubricDetail.criteria) {
        expect(criterion.bands.absent.length).toBeGreaterThan(0);
        expect(criterion.bands.strong.length).toBeGreaterThan(0);
      }
    }
  });

  it("resolves target skills to names and can-do statements", () => {
    const funnel = projects.find((p) => p.slug === "sales-funnel-analysis")!;
    expect(funnel.skills.map((s) => s.slug)).toContain("join-grain");
    expect(funnel.skills[0]!.canDoStatement.length).toBeGreaterThan(10);
  });

  it("drops a target skill that is not in the pack rather than rendering a hole", () => {
    const broken = {
      ...pack,
      projects: [{ ...pack.projects[0]!, targetSkills: ["ghost"] }],
    };
    expect(projectDetails(broken)[0]!.skills).toEqual([]);
  });

  it("throws if a project points at a rubric that does not exist", () => {
    // The validator makes this unreachable in production; failing loudly beats
    // rendering a brief with no rubric, which would break §4.2 law 2.
    const broken = {
      ...pack,
      projects: [{ ...pack.projects[0]!, rubric: "no-such-rubric" }],
    };
    expect(() => projectDetails(broken)).toThrow(/missing rubric/);
  });

  it("requires both public *and* an indexable topic to be indexable", () => {
    const reviewed = {
      ...pack,
      quality: { ...pack.quality, reviewedBy: "nixon" },
    };
    expect(projectDetails(reviewed).every((p) => p.indexable)).toBe(true);

    const privateProject = {
      ...reviewed,
      projects: [{ ...reviewed.projects[0]!, isPublic: false }],
    };
    expect(projectDetails(privateProject)[0]!.indexable).toBe(false);
  });
});

describe("allProjects / findProject", () => {
  it("orders projects easiest first", () => {
    const difficulties = allProjects().map((p) => p.difficulty);
    expect([...difficulties].sort((a, b) => a - b)).toEqual(difficulties);
  });

  it("finds a project by slug", () => {
    expect(findProject("slow-query-rescue")?.title).toContain("slow query");
  });

  it("returns undefined for an unknown slug", () => {
    expect(findProject("nope")).toBeUndefined();
  });
});

describe("search", () => {
  it("finds skills by name and by can-do statement", () => {
    const hits = search("join");
    expect(hits.some((h) => h.title === "Inner joins")).toBe(true);
    // Matched on the can-do statement rather than the title.
    expect(hits.some((h) => h.title === "NULL semantics")).toBe(true);
  });

  it("finds a topic by name", () => {
    expect(search("SQL").some((h) => h.kind === "topic")).toBe(true);
  });

  it("finds a project by title and by brief", () => {
    expect(search("cohort").some((h) => h.kind === "project")).toBe(true);
    expect(search("dashboard query takes 40").some((h) => h.kind === "project")).toBe(
      true,
    );
  });

  it("finds skills by area", () => {
    expect(search("windows").some((h) => h.kind === "skill")).toBe(true);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(search("  JOIN GRAIN  ").length).toBeGreaterThan(0);
  });

  it("returns nothing for an empty query", () => {
    expect(search("")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });

  it("returns nothing for a subject the product does not teach", () => {
    // The autocomplete must never promise something that does not exist.
    expect(search("underwater basket weaving")).toEqual([]);
  });

  it("links every hit to a real route", () => {
    for (const hit of search("join")) {
      expect(hit.href).toMatch(/^\/(learn|check|projects)\//);
      expect(hit.detail.length).toBeGreaterThan(0);
    }
  });
});
