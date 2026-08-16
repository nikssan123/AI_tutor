import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findPages,
  MAX_MATCHES,
  PAGES,
  score,
  stem,
  words,
} from "@/lib/assistant/pages";

/**
 * The route table.
 *
 * The assertion that earns this file is the last one: every path here is
 * checked against the filesystem, so a page that moves fails a test rather than
 * sending a learner to a 404 in a sentence the assistant sounded confident
 * about. The rest is about the one behaviour a lookup must have — being willing
 * to return nothing.
 */

describe("words", () => {
  it("takes lowercase words and drops the punctuation between them", () => {
    expect(words("Cancel Subscription!")).toEqual(["cancel", "subscription"]);
  });

  /** Single letters match everything and mean nothing. */
  it("ignores single characters", () => {
    expect(words("a b x")).toEqual([]);
  });

  /**
   * The stop list, from the outside. Without it "What you can do" was a page
   * title whose every word scored, so "how do I cancel…" found the mastery
   * page — a question word outranking the subject of the question.
   */
  it("drops the words that appear in every question", () => {
    expect(words("what can I do")).toEqual([]);
    expect(words("how do I cancel my subscription")).toEqual([
      "cancel",
      "subscription",
    ]);
  });

  it("has nothing to say about an empty question", () => {
    expect(words("   ")).toEqual([]);
  });
});

describe("stem", () => {
  it("reduces a plural to what it shares with its singular", () => {
    expect(stem("invoices")).toBe("invoice");
    expect(stem("skills")).toBe("skill");
  });

  it("leaves a short word alone rather than inventing a singular", () => {
    // "was" is not the plural of "wa".
    expect(stem("was")).toBe("was");
    expect(stem("calendar")).toBe("calendar");
  });
});

describe("score", () => {
  const billing = PAGES.find((page) => page.path === "/account/billing")!;

  it("weighs a page's own name above a word it merely covers", () => {
    expect(score(billing, ["billing"])).toBe(2);
    expect(score(billing, ["invoice"])).toBe(1);
  });

  it("adds up across the question", () => {
    expect(score(billing, ["billing", "invoice"])).toBe(3);
  });

  it("is zero for a page that has nothing to do with it", () => {
    expect(score(billing, ["photosynthesis"])).toBe(0);
  });
});

describe("findPages", () => {
  it("finds billing from the words a learner would actually use", () => {
    expect(findPages("how do I cancel my subscription")[0]!.path).toBe(
      "/account/billing",
    );
    expect(findPages("where are my invoices")[0]!.path).toBe("/account/billing");
  });

  it("finds the calendar from the page it is actually on", () => {
    expect(findPages("show me my calendar")[0]!.path).toBe("/progress");
  });

  it("finds what you have learned", () => {
    expect(findPages("what skills have I proved")[0]!.path).toBe("/mastery");
  });

  /**
   * §9.3 — "I can't see a page for that" has to be reachable, so the lookup
   * behind it has to be able to produce nothing. A best-effort third-choice
   * route would be worse than an honest miss.
   */
  it("returns nothing rather than guessing", () => {
    expect(findPages("what is the capital of Peru")).toEqual([]);
    expect(findPages("")).toEqual([]);
  });

  it("never returns more than a few destinations", () => {
    // "cancel my subscription and my session and my calendar and my skills"
    const many = findPages(
      "cancel subscription session calendar skills invite goal",
    );
    expect(many.length).toBeLessThanOrEqual(MAX_MATCHES);
  });

  it("puts the better match first", () => {
    const matches = findPages("billing invoice card");
    expect(matches[0]!.path).toBe("/account/billing");
  });
});

describe("the table itself", () => {
  it("points only at routes that exist", () => {
    for (const page of PAGES) {
      // `/account/billing` → src/app/(app)/account/billing/page.tsx
      expect(
        existsSync(`src/app/(app)${page.path}/page.tsx`),
        `${page.path} has no page.tsx`,
      ).toBe(true);
    }
  });

  it("gives every page something to say about itself", () => {
    for (const page of PAGES) {
      expect(page.title).not.toBe("");
      expect(page.blurb).not.toBe("");
      expect(page.keywords.length).toBeGreaterThan(0);
    }
  });

  it("has no two pages on the same path", () => {
    const paths = PAGES.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
