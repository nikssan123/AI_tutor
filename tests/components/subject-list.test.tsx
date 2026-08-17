// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SubjectList, startHref } from "@/components/subject-list";
import { CATEGORIES } from "@/lib/content/categories";
import type { TopicSummary } from "@/lib/content";

/**
 * The catalogue list's two shapes.
 *
 * It groups by §7.1's taxonomy branch, but only once there is more than one
 * branch to name — with everything in one group a heading would label what the
 * page has already labelled. Both halves of that decision need a test, and the
 * flat one stopped being reachable through the real catalogue the moment it
 * grew a second category.
 */

/** `categoryFor` matches a topic's `taxonomyParent` against the category slug. */
const BRANCHES = CATEGORIES.map((category) => category.slug);

function topic(overrides: Partial<TopicSummary> = {}): TopicSummary {
  return {
    slug: "photography-fundamentals",
    name: "Photography",
    maturity: "curated",
    reviewKind: null,
    taxonomyParent: BRANCHES[0]!,
    evalTier: 1,
    skillCount: 12,
    projectCount: 3,
    totalHours: 40,
    areas: ["Exposure", "Composition"],
    indexable: true,
    checkIndexable: true,
    ...overrides,
  };
}

afterEach(cleanup);

describe("startHref", () => {
  it("carries the name, not the slug", () => {
    // `/start` is free text read by the analyzer: "Photography" is what a
    // person would have typed, "photography-fundamentals" is not.
    expect(startHref(topic())).toBe("/start?topic=Photography");
  });

  it("escapes a name that would break the query string", () => {
    expect(startHref(topic({ name: "R&D / Stats" }))).toBe(
      "/start?topic=R%26D%20%2F%20Stats",
    );
  });
});

describe("SubjectList", () => {
  const checked = new Set<string>();

  it("stays flat when everything is in one branch", () => {
    render(
      <SubjectList
        topics={[
          topic(),
          topic({ slug: "sql-data-analysis", name: "SQL" }),
        ]}
        checked={checked}
      />,
    );

    expect(screen.getByText("Photography")).toBeDefined();
    expect(screen.getByText("SQL")).toBeDefined();
    // No group label: with one branch, it would name what the page just named.
    expect(screen.queryByText(CATEGORIES[0]!.name)).toBeNull();
  });

  it("groups once there is more than one branch", () => {
    render(
      <SubjectList
        topics={[
          topic(),
          topic({
            slug: "sql-data-analysis",
            name: "SQL",
            taxonomyParent: BRANCHES[1]!,
          }),
        ]}
        checked={checked}
      />,
    );

    expect(screen.getByText(CATEGORIES[0]!.name)).toBeDefined();
    expect(screen.getByText(CATEGORIES[1]!.name)).toBeDefined();
    expect(screen.getByText("Photography")).toBeDefined();
    expect(screen.getByText("SQL")).toBeDefined();
  });

  it("renders an empty catalogue without a heading", () => {
    const { container } = render(
      <SubjectList topics={[]} checked={checked} />,
    );

    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});
