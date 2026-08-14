import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  breadcrumbs,
  course,
  howTo,
  organisation,
  priceOffers,
  quiz,
  serialise,
  website,
} from "@/lib/seo/jsonld";
import { findPack, findProject, skillDetails, topicSummary } from "@/lib/content";

/**
 * §13.3's most consequential JSON-LD rule is the last one: "Never mark up
 * content that isn't visibly on the page." Every builder takes the same data
 * the page renders, and these tests pin that correspondence.
 */

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
});

describe("organisation", () => {
  it("is valid schema.org with an absolute url", () => {
    const ld = organisation();
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Organization");
    expect(ld.url).toBe("https://example.com");
  });
});

describe("website", () => {
  it("declares a SearchAction pointing at the real search route", () => {
    const ld = website() as {
      potentialAction: { target: { urlTemplate: string } };
    };
    // /learn?q= is a route that genuinely exists and returns results.
    expect(ld.potentialAction.target.urlTemplate).toBe(
      "https://example.com/learn?q={search_term_string}",
    );
  });
});

describe("breadcrumbs", () => {
  it("numbers positions from 1 and resolves absolute item urls", () => {
    const ld = breadcrumbs([
      { name: "Home", path: "/" },
      { name: "Learn", path: "/learn" },
    ]) as { itemListElement: Array<{ position: number; item: string; name: string }> };

    expect(ld.itemListElement.map((e) => e.position)).toEqual([1, 2]);
    expect(ld.itemListElement[0]!.item).toBe("https://example.com");
    expect(ld.itemListElement[1]!.item).toBe("https://example.com/learn");
    expect(ld.itemListElement[1]!.name).toBe("Learn");
  });

  it("handles a single crumb", () => {
    const ld = breadcrumbs([{ name: "Home", path: "/" }]) as {
      itemListElement: unknown[];
    };
    expect(ld.itemListElement).toHaveLength(1);
  });
});

describe("course", () => {
  const pack = findPack("sql-data-analysis")!;
  const build = () =>
    course(topicSummary(pack), skillDetails(pack)) as {
      teaches: string[];
      timeRequired: string;
      url: string;
      name: string;
    };

  it("teaches exactly the can-do statements the page lists", () => {
    // Marking up a capability the page does not show is the structured-data
    // mistake §13.3 forbids.
    const onPage = skillDetails(pack).map((s) => s.canDoStatement);
    expect(build().teaches).toEqual(onPage);
  });

  it("states the time in ISO 8601 duration form", () => {
    expect(build().timeRequired).toMatch(/^PT\d+H$/);
  });

  it("self-canonicals", () => {
    expect(build().url).toBe("https://example.com/learn/sql-data-analysis");
  });
});

describe("howTo", () => {
  const project = findProject("slow-query-rescue")!;
  const build = () =>
    howTo(project) as {
      step: Array<{ position: number; text: string }>;
      totalTime: string;
      description: string;
    };

  it("uses the acceptance criteria the page already lists as the steps", () => {
    const ld = build();
    expect(ld.step.map((s) => s.text)).toEqual(project.acceptanceCriteria);
    // Positions derived from the brief, not a literal list — the count changes
    // whenever a criterion is added, and it just did.
    expect(ld.step.map((s) => s.position)).toEqual(
      project.acceptanceCriteria.map((_, i) => i + 1),
    );
  });

  it("states the estimated time in minutes", () => {
    expect(build().totalTime).toBe(`PT${project.estimatedMinutes}M`);
  });

  it("describes the project with its real brief", () => {
    expect(build().description).toBe(project.brief);
  });
});

describe("quiz", () => {
  const summary = topicSummary(findPack("sql-data-analysis")!);
  const build = () => quiz(summary, 9, 10) as Record<string, string>;

  it("is a Quiz at the check's own canonical url", () => {
    expect(build()["@type"]).toBe("Quiz");
    expect(build().url).toBe("https://example.com/check/sql-data-analysis");
  });

  it("states the duration the page states, in ISO 8601", () => {
    expect(build().timeRequired).toBe("PT10M");
  });

  it("says nothing whatsoever about the questions themselves", () => {
    // §13.3's rule: never mark up content that isn't visibly on the page. The
    // intro screen a crawler is served shows no question, so `hasPart` here
    // would be publishing the item bank in structured data.
    const ld = build() as Record<string, unknown>;
    expect(ld.hasPart).toBeUndefined();
    expect(Object.keys(ld)).not.toContain("question");
  });

  it("carries only the three facts the intro screen shows", () => {
    const ld = build();
    expect(ld.description).toContain("9 questions");
    expect(ld.description).toContain("10 minutes");
    expect(ld.description).toContain("no account");
  });
});

describe("serialise", () => {
  it("emits a bare object for a single block", () => {
    expect(serialise({ a: 1 })).toBe('{"a":1}');
  });

  it("emits an array for several blocks", () => {
    expect(serialise({ a: 1 }, { b: 2 })).toBe('[{"a":1},{"b":2}]');
  });

  it("produces parseable JSON for every real page combination", () => {
    const pack = findPack("sql-data-analysis")!;
    const project = findProject("slow-query-rescue")!;
    for (const blocks of [
      [organisation(), website()],
      [breadcrumbs([{ name: "Home", path: "/" }])],
      [course(topicSummary(pack), skillDetails(pack))],
      [breadcrumbs([{ name: "Home", path: "/" }]), howTo(project)],
    ]) {
      expect(() => JSON.parse(serialise(...blocks))).not.toThrow();
    }
  });
});

describe("priceOffers", () => {
  const base = {
    name: "MeritKeep",
    description: "Learning, marked.",
    path: "/pricing",
    currency: "usd",
  };

  it("quotes the cheapest and dearest things on the page", () => {
    const block = priceOffers({ ...base, amountsCents: [2_499, 300, 19_900] });
    const offers = block.offers as Record<string, unknown>;

    expect(offers["@type"]).toBe("AggregateOffer");
    expect(offers.priceCurrency).toBe("USD");
    expect(offers.highPrice).toBe("199.00");
    // The free plan is the floor, and it is a real offer rather than an
    // asterisk.
    expect(offers.lowPrice).toBe("0.00");
    expect(offers.offerCount).toBe(4);
  });

  it("survives a page with nothing purchasable on it", () => {
    // Not a page this product ships, but the arithmetic must not produce
    // `undefined` in markup a crawler reads.
    const offers = priceOffers({ ...base, amountsCents: [] }).offers as Record<
      string,
      unknown
    >;
    expect(offers.highPrice).toBe("0.00");
    expect(offers.offerCount).toBe(1);
  });

  it("does not mutate the array it was handed", () => {
    const amounts = [19_900, 300];
    priceOffers({ ...base, amountsCents: amounts });
    expect(amounts).toEqual([19_900, 300]);
  });

  it("says the product is free to start, because it is", () => {
    expect(
      priceOffers({ ...base, amountsCents: [2_499] }).isAccessibleForFree,
    ).toBe(true);
  });
});
