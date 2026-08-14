import { describe, expect, it } from "vitest";
import {
  expectedFor,
  proveBlocks,
  proveItems,
  proveOffer,
  PROVE_ITEM_COUNT,
} from "@/lib/session/prove";
import { findPack } from "@/lib/content";
import type { DomainPack, PackItem } from "@/lib/packs/types";
import type { SessionBlock } from "@/lib/engine";

/**
 * PLAN-ADAPTATION step 4 — the prove-it offer.
 *
 * The invariant every test here defends: accepting the offer buys *questions*.
 * It does not skip a skill, move mastery, or record a verdict. If any of that
 * ever starts happening in this module, a model's impression of a conversation
 * has become a route to the ledger.
 */

const pack = findPack("sql-data-analysis")!;

function item(over: Partial<PackItem> = {}): PackItem {
  return {
    slug: "i1",
    skill: "joins",
    type: "short_text",
    difficulty: 0.5,
    discrimination: 1,
    prompt: "Write a query that joins orders to customers",
    answerKey: { concepts: ["join-on-key", "keep-the-grain"] },
    ...over,
  } as PackItem;
}

function packWith(items: PackItem[]): DomainPack {
  return { ...pack, items } as DomainPack;
}

const checkBlock: SessionBlock = {
  type: "check",
  skillId: "joins",
  prompt: "In your own words…",
  expected: "x",
  isRetrieval: false,
  itemId: null,
  estMinutes: 5,
};

describe("proveItems", () => {
  it("asks the hardest questions the bank has", () => {
    const chosen = proveItems(
      packWith([
        item({ slug: "easy", difficulty: 0.2 }),
        item({ slug: "hard", difficulty: 0.9 }),
        item({ slug: "mid", difficulty: 0.5 }),
      ]),
      "joins",
    );

    expect(chosen.map((i) => i.slug)).toEqual(["hard", "mid", "easy"]);
  });

  it("stops at the offer's size", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      item({ slug: `i${i}`, difficulty: i / 10 }),
    );
    expect(proveItems(packWith(many), "joins")).toHaveLength(PROVE_ITEM_COUNT);
  });

  /**
   * A session block renders a textarea and nothing else, so an MCQ served here
   * would show its stem with no options — and a guessable item is weak evidence
   * for a claim the learner volunteered in the first place.
   */
  it("refuses multiple choice", () => {
    const chosen = proveItems(
      packWith([
        item({ slug: "guessable", type: "mcq", difficulty: 0.99 }),
        item({ slug: "written", type: "short_text", difficulty: 0.1 }),
      ]),
      "joins",
    );

    expect(chosen.map((i) => i.slug)).toEqual(["written"]);
  });

  it("only draws on the skill being claimed", () => {
    const chosen = proveItems(
      packWith([
        item({ slug: "mine", skill: "joins" }),
        item({ slug: "theirs", skill: "windows" }),
      ]),
      "joins",
    );

    expect(chosen.map((i) => i.slug)).toEqual(["mine"]);
  });

  it("draws the same questions for the same claim", () => {
    const p = packWith([
      item({ slug: "b", difficulty: 0.5 }),
      item({ slug: "a", difficulty: 0.5 }),
    ]);
    expect(proveItems(p, "joins")).toEqual(proveItems(p, "joins"));
    expect(proveItems(p, "joins").map((i) => i.slug)).toEqual(["a", "b"]);
  });

  it("finds real questions in a real pack", () => {
    expect(proveItems(pack, "join-grain").length).toBeGreaterThan(0);
  });
});

describe("expectedFor", () => {
  it("marks against the concepts the author wrote", () => {
    expect(
      expectedFor(item({ answerKey: { concepts: ["a", "b"] } }), "fallback"),
    ).toBe("a; b");
  });

  it("falls back to the can-do statement when there are none", () => {
    for (const key of [undefined, null, {}, { concepts: [] }, { concepts: "x" }]) {
      expect(expectedFor(item({ answerKey: key }), "fallback")).toBe("fallback");
    }
  });
});

describe("proveBlocks", () => {
  const blocks = proveBlocks(
    [item({ slug: "i1" }), item({ slug: "i2" })],
    "joins",
    "Join two tables correctly",
  );

  it("builds real checks carrying the item's own prompt", () => {
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: "check",
      skillId: "joins",
      prompt: "Write a query that joins orders to customers",
      itemId: "i1",
    });
  });

  /**
   * Not spaced practice coming round again — a claim being tested. The session's
   * opening-retrieval accounting must not count these.
   */
  it("marks them as something other than retrieval", () => {
    expect(blocks.every((b) => b.type === "check" && !b.isRetrieval)).toBe(true);
  });

  /** So a right answer schedules the item for real spaced repetition. */
  it("keeps the item id, so the answer lands in the retrieval queue", () => {
    expect(blocks.map((b) => b.type === "check" && b.itemId)).toEqual([
      "i1",
      "i2",
    ]);
  });
});

describe("proveOffer", () => {
  const signals = [{ skillSlug: "joins", signal: "already_knows" }];

  it("offers on the skill the learner is looking at", () => {
    expect(
      proveOffer({
        signals,
        block: checkBlock,
        blocks: [checkBlock],
        pack: packWith([item()]),
      }),
    ).toEqual({ skillSlug: "joins" });
  });

  it("stays quiet when nothing was claimed", () => {
    expect(
      proveOffer({
        signals: [],
        block: checkBlock,
        blocks: [checkBlock],
        pack: packWith([item()]),
      }),
    ).toBeUndefined();
  });

  it("ignores a claim about a different skill", () => {
    expect(
      proveOffer({
        signals: [{ skillSlug: "windows", signal: "already_knows" }],
        block: checkBlock,
        blocks: [checkBlock],
        pack: packWith([item()]),
      }),
    ).toBeUndefined();
  });

  it("ignores the other signals entirely", () => {
    for (const signal of ["stuck", "misconception", "none"]) {
      expect(
        proveOffer({
          signals: [{ skillSlug: "joins", signal }],
          block: checkBlock,
          blocks: [checkBlock],
          pack: packWith([item()]),
        }),
      ).toBeUndefined();
    }
  });

  it("says nothing on a block that is not about a skill", () => {
    for (const block of [
      undefined,
      { type: "reflect", prompt: "p", estMinutes: 5 } as SessionBlock,
      {
        type: "review",
        submissionId: "s",
        focus: "f",
        estMinutes: 5,
      } as SessionBlock,
    ]) {
      expect(
        proveOffer({ signals, block, blocks: [], pack: packWith([item()]) }),
      ).toBeUndefined();
    }
  });

  /**
   * Taken once. The appended blocks are the record that it happened, so there
   * is no second flag to keep in sync — and a learner who answered them badly
   * is not asked to prove the same skill again in the same session.
   */
  it("does not offer twice", () => {
    const taken: SessionBlock = { ...checkBlock, itemId: "i1" };
    expect(
      proveOffer({
        signals,
        block: checkBlock,
        blocks: [checkBlock, taken],
        pack: packWith([item()]),
      }),
    ).toBeUndefined();
  });

  it("stays quiet when the pack has nothing to ask with", () => {
    expect(
      proveOffer({
        signals,
        block: checkBlock,
        blocks: [checkBlock],
        pack: packWith([item({ type: "mcq" })]),
      }),
    ).toBeUndefined();
  });
});
