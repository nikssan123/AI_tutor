import { describe, expect, it } from "vitest";
import { committedPack, contextFor } from "@/lib/goals/turn";
import { EMPTY_INTAKE } from "@/lib/goals/intake-store";
import { MAX_TURNS, type CapturedGoal, type Message } from "@/lib/goals/analyzer";

const capturedFor = (over: Partial<CapturedGoal> = {}): CapturedGoal => ({
  subject: null,
  matchedPack: null,
  outcomeType: null,
  statedLevel: null,
  weeklyHours: null,
  deadline: null,
  motivation: null,
  constraints: [],
  existingAssets: [],
  priorDomain: null,
  ...over,
});

/**
 * The part of a turn that decides what the model is told, rather than what it
 * says back.
 *
 * The property worth pinning here is that a course the learner already chose
 * survives into every turn. Before it did, the conversation opened by asking
 * what they wanted to get good at — of someone who had just pressed a button
 * on a page that named exactly one course — and the pack was then recognised
 * back out of prose at the end by the same model that had been kept ignorant
 * of it.
 */

describe("committedPack", () => {
  it("is nothing when no course was chosen", () => {
    expect(committedPack(null)).toBeNull();
  });

  it("names a course the catalogue knows", () => {
    expect(committedPack("photography")).toEqual({
      slug: "photography",
      name: "Photography",
    });
  });

  /*
   * A Generated pack (§7.1) lives only in the database, so the disk catalogue
   * cannot name it. Its slug stands in — worse prose in one line of a prompt,
   * and the slug is what the model is being told to echo anyway, so nothing
   * that matters is lost. The alternative was a database round trip on every
   * turn of every conversation to fetch a display name.
   */
  it("falls back to the slug for a course only the database has", () => {
    expect(committedPack("basket-weaving")).toEqual({
      slug: "basket-weaving",
      name: "basket-weaving",
    });
  });
});

describe("contextFor", () => {
  const today = new Date("2026-08-15T09:00:00Z");

  it("carries the chosen course into the turn", () => {
    const context = contextFor(
      { ...EMPTY_INTAKE, packSlug: "photography" },
      [{ r: "l", t: "hello" }],
      today,
    );
    expect(context.committed).toEqual({
      slug: "photography",
      name: "Photography",
    });
  });

  it("leaves the subject open when there is no chosen course", () => {
    const context = contextFor(EMPTY_INTAKE, [{ r: "l", t: "hello" }], today);
    expect(context.committed).toBeNull();
  });

  it("dates the turn, so a relative deadline resolves", () => {
    expect(contextFor(EMPTY_INTAKE, [], today).today).toBe("2026-08-15");
  });

  it("tells the model to close once clarity is there", () => {
    const settled = { ...EMPTY_INTAKE, clarity: 0.9 };
    expect(contextFor(settled, [], today).finalTurn).toBe(true);
    expect(contextFor(EMPTY_INTAKE, [], today).finalTurn).toBe(false);
  });
});

/**
 * The one question allowed to overrule "you have enough, close now".
 *
 * Clarity is the analyzer's read on whether it could plan, and it can plan an
 * unscoped subject perfectly well — which is the problem. §7.1's Generated tier
 * writes 8 to 14 skills whatever it is handed, so "make websites" and "put a
 * portfolio site online" cost the same and buy courses at completely different
 * resolutions. Nothing downstream can recover the difference: the pack author
 * cannot ask, and the learner sees the answer several minutes and about a pound
 * later.
 */
describe("contextFor and the scope question", () => {
  const today = new Date("2026-08-15T09:00:00Z");

  const unscoped = {
    ...EMPTY_INTAKE,
    clarity: 0.9,
    captured: capturedFor({ subject: "web development" }),
  };

  const exchanges = (n: number): Message[] =>
    Array.from({ length: n }, (_, i) => [
      { r: "a" as const, t: `question ${i}` },
      { r: "l" as const, t: `answer ${i}` },
    ]).flat();

  it("holds the conversation open for a subject nobody has scoped", () => {
    const context = contextFor(unscoped, exchanges(1), today);

    // Clarity says close; the missing scope says not yet.
    expect(context.finalTurn).toBe(false);
    expect(context.toNarrow).toBe("web development");
  });

  it("lets it close once they have answered", () => {
    const scoped = {
      ...unscoped,
      captured: capturedFor({
        subject: "web development",
        scope: "put a portfolio site online",
      }),
    };

    expect(contextFor(scoped, exchanges(1), today).finalTurn).toBe(true);
    expect(contextFor(scoped, exchanges(1), today).toNarrow).toBeNull();
  });

  /*
   * §24 E3's cap is "≤6 turns, always", enforced in application code precisely
   * so that no rule added later can spend a seventh. This is that rule, and it
   * loses. What covers the unscoped build is `scopeFrom`, which hands the pack
   * author the learner's own opening words rather than nothing.
   */
  it("gives the turn back on the last one, cap over question", () => {
    const context = contextFor(unscoped, exchanges(MAX_TURNS - 1), today);

    expect(context.finalTurn).toBe(true);
    // And the directive goes with it: a model told to close *and* to ask one
    // more thing is a model told to pick one.
    expect(context.toNarrow).toBeNull();
  });

  it("asks nothing of a learner who already chose a course", () => {
    const chosen = { ...unscoped, packSlug: "photography" };

    expect(contextFor(chosen, exchanges(1), today).toNarrow).toBeNull();
    expect(contextFor(chosen, exchanges(1), today).finalTurn).toBe(true);
  });

  it("asks nothing before the conversation has a subject", () => {
    // The opening turn, where `captured` is undefined: there is nothing to
    // narrow and nothing to hold open for.
    expect(contextFor({ ...EMPTY_INTAKE, clarity: 0.9 }, [], today).toNarrow)
      .toBeNull();
  });
});
