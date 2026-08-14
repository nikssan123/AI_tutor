import { describe, expect, it } from "vitest";
import {
  brandCard,
  clamp,
  OG_SIZE,
  projectCard,
  subjectCard,
  titleFontSize,
} from "@/lib/seo/og";
import { maturityClaim } from "@/lib/claims";
import { findPack, findProject, topicSummary } from "@/lib/content";
import type { ProjectDetail, TopicSummary } from "@/lib/content";

/**
 * A share card is the one artefact that travels away from the page it describes,
 * so the thing worth testing is not that it renders — it is that it cannot say
 * a kinder thing than the page.
 */

const pack = findPack("sql-data-analysis")!;
const summary = topicSummary(pack);

describe("OG_SIZE", () => {
  it("is the 1.91:1 box every network crops from", () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
  });
});

describe("titleFontSize", () => {
  it("steps down as the title gets longer, so it cannot push the card open", () => {
    const sizes = ["Short one", "x".repeat(40), "x".repeat(80)].map(titleFontSize);
    expect(sizes).toEqual([76, 60, 48]);
    // Monotonic, which is the property that actually matters.
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  });

  it("holds the boundaries", () => {
    expect(titleFontSize("x".repeat(28))).toBe(76);
    expect(titleFontSize("x".repeat(29))).toBe(60);
    expect(titleFontSize("x".repeat(52))).toBe(60);
    expect(titleFontSize("x".repeat(53))).toBe(48);
  });
});

describe("clamp", () => {
  it("leaves anything short enough completely alone", () => {
    expect(clamp("Reading SQL", 40)).toBe("Reading SQL");
    expect(clamp("x".repeat(40), 40)).toBe("x".repeat(40));
  });

  it("cuts at a word boundary rather than mid-word", () => {
    expect(clamp("the quick brown fox jumps over", 20)).toBe("the quick brown fox…");
  });

  it("cuts hard when there is no usable boundary to cut at", () => {
    // One 40-character word: a boundary in the first half would throw away most
    // of the only word there is, so the hard cut is the better answer.
    expect(clamp(`ab ${"x".repeat(40)}`, 20)).toBe("ab xxxxxxxxxxxxxxxxx…");
  });
});

describe("brandCard", () => {
  it("says what the landing page says", () => {
    const card = brandCard();
    expect(card.title).toMatch(/prove you actually learned it/i);
    expect(card.badge).toBeNull();
    expect(card.facts).toEqual([]);
  });
});

describe("subjectCard", () => {
  it("carries the maturity badge, which is the point of generating it", () => {
    expect(subjectCard(summary).badge).toEqual(
      maturityClaim(summary.maturity, summary.reviewKind),
    );
  });

  /**
   * The share card is exactly where a claim gets quietly upgraded — nobody
   * scrolls a feed with the rubric open. This is the assertion that keeps the
   * card from saying a kinder thing than the page it links to.
   */
  it("never calls a model-reviewed pack hand-checked", () => {
    const byModel = { ...summary, maturity: "curated" as const, reviewKind: "model" as const };
    expect(subjectCard(byModel).badge?.label).not.toMatch(/by hand/i);
    expect(subjectCard(byModel).badge?.tone).not.toBe("verified");
  });

  it("quotes counts the page itself shows", () => {
    const card = subjectCard(summary);
    expect(card.facts).toEqual([
      `${summary.skillCount} skills`,
      `${summary.projectCount} graded projects`,
      `~${summary.totalHours} hours`,
    ]);
    expect(card.eyebrow).toBe("Subject");
    expect(card.title).toBe(pack.name);
  });

  it("drops the marking promise when there is nothing to mark", () => {
    // Reachable: a generated pack whose rubric author failed still has a skill
    // graph, still gets a page, and has no project to mark.
    const bare: TopicSummary = { ...summary, projectCount: 0 };
    const card = subjectCard(bare);

    expect(card.lead).not.toMatch(/marked/i);
    expect(card.facts).toEqual([
      `${summary.skillCount} skills`,
      `~${summary.totalHours} hours`,
    ]);
  });

  it("promises marking when there is something to mark", () => {
    expect(subjectCard(summary).lead).toMatch(/marked against a checklist/i);
  });

  it("clamps a subject name long enough to break the layout", () => {
    const long: TopicSummary = { ...summary, name: "Subject ".repeat(20) };
    expect(subjectCard(long).title.length).toBeLessThanOrEqual(91);
    expect(subjectCard(long).title.endsWith("…")).toBe(true);
  });
});

describe("projectCard", () => {
  const project = findProject(findPack("sql-data-analysis")!.projects[0]!.slug)!;

  it("states the tier's claim rather than the pack's maturity", () => {
    // The question asked of a brief is what "marked" will mean, and at tier 5
    // the honest answer is that it will not count.
    const tier5: ProjectDetail = { ...project, evalTier: 5 };
    expect(projectCard(tier5).badge?.label).toMatch(/doesn't count as proof/i);
  });

  it("counts the published criteria, which is what makes the brief strong", () => {
    const card = projectCard(project);
    expect(card.facts[0]).toBe(`${project.rubricDetail.criteria.length} criteria`);
    expect(card.facts).toHaveLength(3);
    expect(card.eyebrow).toBe(project.topicName);
  });

  it("clamps both a runaway title and a runaway subject name", () => {
    const long: ProjectDetail = {
      ...project,
      title: "Build ".repeat(30),
      topicName: "A very long subject name ".repeat(4),
    };
    const card = projectCard(long);
    expect(card.title.endsWith("…")).toBe(true);
    // A project always names the subject it belongs to, so this one is never
    // null — unlike the brand card's, which is deliberately absent.
    expect(card.eyebrow!.endsWith("…")).toBe(true);
    expect(card.eyebrow!.length).toBeLessThanOrEqual(41);
  });
});
