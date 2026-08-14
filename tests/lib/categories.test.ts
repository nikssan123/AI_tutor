import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  categoryFor,
  groupByCategory,
  OTHER,
} from "@/lib/content/categories";
import { allTopics } from "@/lib/content";
import type { TopicSummary } from "@/lib/content";

const topic = (slug: string, taxonomyParent: string | null): TopicSummary =>
  ({ slug, name: slug, taxonomyParent }) as TopicSummary;

describe("categoryFor", () => {
  it("maps the vocabulary the pack generator actually emits", () => {
    // The generator asks the model for "technology, business, creative,
    // science, language, craft". The icon map used to key on `technical-entry`
    // and `professional-business`, which nothing has ever produced.
    for (const category of CATEGORIES) {
      expect(categoryFor(category.slug)).toBe(category);
    }
  });

  it("never drops a subject whose branch we did not anticipate", () => {
    // A generated pack can arrive under any branch. A subject the learner asked
    // for is the last thing that should vanish because our taxonomy was short.
    expect(categoryFor("science")).toBe(OTHER);
    expect(categoryFor("underwater-basket-weaving")).toBe(OTHER);
    expect(categoryFor(null)).toBe(OTHER);
  });
});

describe("groupByCategory", () => {
  it("returns groups in the declared order, with Everything else last", () => {
    const groups = groupByCategory([
      topic("a", "science"),
      topic("b", "creative"),
      topic("c", "technology"),
    ]);

    expect(groups.map((g) => g.category.slug)).toEqual([
      "technology",
      "creative",
      "other",
    ]);
  });

  it("drops categories nothing landed in", () => {
    const groups = groupByCategory([topic("a", "technology")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category.slug).toBe("technology");
  });

  it("keeps the order it was given inside a group", () => {
    // A caller that sorted by name keeps that sort; one that did not gets pack
    // order. Grouping is not licence to reorder.
    const groups = groupByCategory([
      topic("zebra", "technology"),
      topic("alpha", "technology"),
    ]);
    expect(groups[0]!.topics.map((t) => t.slug)).toEqual(["zebra", "alpha"]);
  });

  it("loses nothing", () => {
    const input = [
      topic("a", "technology"),
      topic("b", null),
      topic("c", "business"),
      topic("d", "nonsense"),
    ];
    const out = groupByCategory(input).flatMap((g) => g.topics);
    expect(out).toHaveLength(input.length);
    expect(new Set(out.map((t) => t.slug))).toEqual(
      new Set(input.map((t) => t.slug)),
    );
  });

  it("returns an empty list for no topics rather than empty groups", () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe("the real catalogue", () => {
  it("sits entirely inside the named categories, none in Everything else", () => {
    // Not a rule about generated packs, which may land anywhere — a rule about
    // the ones on disk, where an unrecognised branch is a typo rather than a
    // subject nobody anticipated.
    for (const t of allTopics()) {
      expect(categoryFor(t.taxonomyParent), t.slug).not.toBe(OTHER);
    }
  });

  it("spans more than one category, or the grouping is decoration", () => {
    expect(groupByCategory(allTopics()).length).toBeGreaterThan(1);
  });
});
