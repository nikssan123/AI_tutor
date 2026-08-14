import { describe, expect, it } from "vitest";
import {
  PROJECT_PARAM,
  projectStartHref,
  projectStartSeed,
  topicStartHref,
} from "@/lib/goals/project-start";

/**
 * The exits from the marketing pages search actually delivers people to.
 *
 * Both of these shipped as *sentences* in `?topic=`, and both were wrong in the
 * same way: that parameter is the one a search box fills, and `/start` compares
 * it against the subject it is holding and renders it inside `Start on “…”?`.
 * A sentence never matches a subject, so every arrival collided, and the
 * heading asked whether the reader wanted to start on a full sentence with its
 * quotes and full stop intact.
 */

describe("topicStartHref", () => {
  it("carries the subject's name and nothing else", () => {
    // What every consumer of `?topic=` already expects. The sentence version
    // ("I want to learn SQL.") is what broke the collision check.
    expect(topicStartHref("SQL")).toBe("/start?topic=SQL");
  });

  it("still encodes a subject a pack can really carry", () => {
    expect(topicStartHref("R&D / statistics")).toBe(
      "/start?topic=R%26D%20%2F%20statistics",
    );
  });
});

describe("projectStartHref", () => {
  it("names the brief by slug rather than describing it", () => {
    expect(projectStartHref("sales-dashboard")).toBe(
      "/start?project=sales-dashboard",
    );
  });

  it("uses the parameter /start reads, so the two cannot drift", () => {
    expect(projectStartHref("x")).toContain(`${PROJECT_PARAM}=`);
  });

  it("encodes the slug, because a query string is not a trusted channel", () => {
    // Slugs are validated on the way into a pack, so this is defence against a
    // hand-typed URL rather than against our own content. `/start` resolves it
    // and ignores anything that is not a project we publish, so nothing a
    // visitor writes here is ever rendered back to them.
    expect(projectStartHref("a b&c")).toBe("/start?project=a%20b%26c");
  });
});

describe("projectStartSeed", () => {
  /**
   * This one stays a sentence, and the distinction is the whole fix: it is
   * posted as the learner's opening reply to the analyzer, never compared
   * against a stored subject and never rendered as a heading.
   */
  it("names the subject for the matcher and the brief for the plan", () => {
    expect(projectStartSeed("Sales dashboard", "SQL & Data Analysis")).toBe(
      'I want to learn SQL & Data Analysis so I can do the "Sales dashboard" project.',
    );
  });
});
