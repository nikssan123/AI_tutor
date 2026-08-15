import { describe, expect, it } from "vitest";
import { committedPack, contextFor } from "@/lib/goals/turn";
import { EMPTY_INTAKE } from "@/lib/goals/intake-store";

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
