import { describe, expect, it } from "vitest";
import { findPack } from "@/lib/content";
import {
  budgetFor,
  cookieFor,
  narrow,
  pathFor,
  scopeFor,
} from "@/lib/check/run";
import {
  DEFAULT_BUDGET,
  gradingModeFor,
  MAX_PER_SKILL,
} from "@/lib/engine/diagnostic";

/**
 * The difference between the two checks, in one file.
 *
 * The broad check spends nine questions across a whole subject and can only
 * *locate* a learner: no skill gets the three-to-five observations the BKT
 * needs to clear `MASTERY_TARGET`, so nothing it finds is ever proof. The deep
 * check spends its whole budget on one skill, so it can — and that is the whole
 * of the answer to §24 E4's remaining half.
 *
 * Everything that differs between them lives here, so a third caller cannot
 * invent a third set of rules.
 */

const pack = () => findPack("photography")!;
const broad = { topic: "photography" };
const deep = { topic: "photography", skill: "depth-of-field" };

describe("which check is running", () => {
  it("keeps a separate cookie per check", () => {
    // Sharing one would mean a deep check on shutter speed silently eating the
    // questions a later broad check was going to ask.
    expect(cookieFor(broad)).toBe("check_photography");
    expect(cookieFor(deep)).toBe("check_photography--depth-of-field");
    expect(cookieFor(broad)).not.toBe(cookieFor(deep));
  });

  it("strips anything that is not a slug out of a cookie name", () => {
    // The topic reaches this from a URL segment, so it is untrusted.
    expect(cookieFor({ topic: "a/b; drop", skill: "x y" })).toBe(
      "check_abdrop--xy",
    );
  });

  it("returns each check to its own URL", () => {
    expect(pathFor(broad)).toBe("/check/photography");
    expect(pathFor(deep)).toBe("/check/photography/depth-of-field");
  });
});

describe("the budget", () => {
  it("is nine questions across a subject", () => {
    expect(budgetFor(broad, narrow(pack(), broad).items)).toBe(DEFAULT_BUDGET);
  });

  /**
   * The deep budget is `MAX_PER_SKILL` — the same number `settled` stops at —
   * so the check ends when the skill is decided or the bank runs out, whichever
   * comes first, and never asks a question that cannot change the answer.
   */
  it("is capped at what one skill can settle, or at what is written", () => {
    const items = narrow(pack(), deep).items;
    expect(budgetFor(deep, items)).toBe(Math.min(MAX_PER_SKILL, items.length));
    expect(budgetFor(deep, items)).toBeLessThanOrEqual(MAX_PER_SKILL);

    // And it is bounded by the bank, not by the ceiling: today's packs are thin
    // enough that this is the binding constraint, which is why the offer quotes
    // this number rather than the ceiling.
    expect(budgetFor(deep, items.slice(0, 1))).toBe(1);
  });
});

describe("the pool a check draws from", () => {
  it("narrows to one skill for a deep check, and to none other", () => {
    const { skills, items } = narrow(pack(), deep);

    expect(skills.map((s) => s.slug)).toEqual(["depth-of-field"]);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.skill).toBe("depth-of-field");
  });

  it("is the whole subject for a broad check", () => {
    const { skills, items } = narrow(pack(), broad);
    expect(skills).toHaveLength(pack().skills.length);
    expect(new Set(items.map((i) => i.skill)).size).toBeGreaterThan(1);
  });

  /**
   * §4.2 law 3, on the question type neither check can ask yet.
   *
   * A `micro_artifact` asks for a piece of work — "photograph a scene that
   * exceeds your sensor's range". Printing that over a textarea asks for a
   * *description* of a photograph, which is a different and much weaker thing,
   * and marking it as though it were the work is the overclaim. Photography
   * carries fifteen of them, so this is not a hypothetical filter.
   */
  it("leaves out work nobody can hand in from a check", () => {
    expect(scopeFor(deep).artefacts).toBe(false);
    expect(scopeFor(broad).artefacts).toBe(false);

    const excluded = pack().items.filter(
      (i) => gradingModeFor(i.type) === "excluded",
    );
    expect(excluded.length).toBeGreaterThan(0);

    const offered = new Set(narrow(pack(), broad).items.map((i) => i.slug));
    for (const item of excluded) expect(offered.has(item.slug)).toBe(false);
  });

  it("counts the budget off what it would actually ask", () => {
    // The number the page promises comes from here, so a pool that counted
    // unanswerable items would promise a question the check cannot ask.
    const items = narrow(pack(), deep).items;
    for (const item of items) {
      expect(gradingModeFor(item.type)).not.toBe("excluded");
    }
  });
});
