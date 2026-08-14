import { describe, expect, it } from "vitest";
import { projectStartHref, topicStartHref } from "@/lib/goals/project-start";

/**
 * The exits from the two marketing pages search actually delivers people to.
 *
 * Both assert the decoded sentence rather than only the encoded string: what
 * matters is what the analyzer reads as the learner's opening message, and a
 * test that only checked for `?topic=` would pass on a seed that named neither
 * the subject nor the brief.
 */
const seedOf = (href: string): string =>
  new URL(href, "https://example.test").searchParams.get("topic") ?? "";

describe("projectStartHref", () => {
  it("opens the intake with the subject and the brief in one sentence", () => {
    expect(
      seedOf(projectStartHref("Sales dashboard", "SQL & Data Analysis")),
    ).toBe(
      'I want to learn SQL & Data Analysis so I can do the "Sales dashboard" project.',
    );
  });

  it("encodes a title and subject a pack can really carry", () => {
    // Ampersands and quotes both appear in real pack copy, and unencoded the
    // first truncates the parameter — the learner then arrives at `/start`
    // having asked for half a subject.
    const href = projectStartHref("Q&A bot", "R&D / statistics");
    expect(href.startsWith("/start?topic=")).toBe(true);
    expect(href).not.toContain(" ");
    expect(seedOf(href)).toContain("R&D / statistics");
    expect(seedOf(href)).toContain("Q&A bot");
  });
});

describe("topicStartHref", () => {
  it("names the subject as a sentence rather than a bare noun", () => {
    // A bare "SQL" is what `customPathHref` sends when a search box is the
    // source. Here the reader pressed a button on the subject's own page, and
    // the opening line should read like something a person said.
    expect(seedOf(topicStartHref("SQL"))).toBe("I want to learn SQL.");
  });
});
