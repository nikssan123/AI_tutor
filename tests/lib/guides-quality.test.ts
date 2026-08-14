import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPack } from "@/lib/packs/loader";
import type { DomainPack } from "@/lib/packs/types";
import type { Guide } from "@/lib/guides/types";

/**
 * §12.2's score and §13.3's link graph.
 *
 * Both are gates, so the tests care most about the *closed* position: what
 * stops a page being published, and what a page cannot claim by asserting it.
 * The two fixtures are a guide that clears everything measurable and one with
 * every optional part removed, so each dimension is exercised from both ends by
 * real files rather than by hand-built objects — with mutation used only for
 * the states a committed fixture should not be in, like a link to a page that
 * does not exist.
 */

const minimal = (): DomainPack =>
  loadPack(join("tests/fixtures/packs", "valid-minimal"));

vi.mock("@/lib/packs/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/packs/loader")>();
  return { ...actual, loadAllPacks: () => [minimal()] };
});

vi.mock("@/lib/guides/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guides/loader")>();
  return {
    ...actual,
    loadAllGuides: () => actual.loadAllGuides("tests/fixtures/guides"),
  };
});

const { resetContentCache } = await import("@/lib/content");
const { loadAllGuides } = await import("@/lib/guides/loader");
const {
  GUIDES_PER_SUBJECT,
  guidePath,
  guidesForSubject,
  inboundLinks,
  outboundLinks,
  sitePaths,
  subjectsCited,
} = await import("@/lib/guides/links");
const {
  QUALITY_FLOOR,
  QUALITY_THRESHOLD,
  fiveGrams,
  isGuideIndexable,
  overlap,
  prose,
  scoreGuide,
} = await import("@/lib/guides/quality");
const {
  allGuideSummaries,
  allGuides,
  guideDetail,
  resetGuideCache,
  resolveGuide,
} = await import("@/lib/guides");

const corpus = (): Guide[] => loadAllGuides("tests/fixtures/guides");
const full = (): Guide => corpus().find((g) => g.slug === "a-full")!;
const thin = (): Guide => corpus().find((g) => g.slug === "b-thin")!;

const dimension = (guide: Guide, id: number, all = corpus()) =>
  scoreGuide(guide, all).dimensions.find((d) => d.id === id)!;

beforeEach(() => {
  resetContentCache();
  resetGuideCache();
});

describe("the link graph", () => {
  it("addresses a guide at /guides/{slug}", () => {
    expect(guidePath("a-full")).toBe("/guides/a-full");
  });

  it("knows every path the site actually serves", () => {
    const paths = sitePaths(corpus());
    expect(paths.has("/learn/valid-minimal")).toBe(true);
    expect(paths.has("/check/valid-minimal/alpha")).toBe(true);
    expect(paths.has("/projects/minimal-project")).toBe(true);
    expect(paths.has("/guides/b-thin")).toBe(true);
    expect(paths.has("/tools/learning-roadmap-generator")).toBe(true);
    expect(paths.has("/learn/does-not-exist")).toBe(false);
  });

  it("flattens the authored links out of the sections that carry them", () => {
    expect(outboundLinks(full()).map((l) => l.to)).toEqual([
      "/learn/valid-minimal",
      "/projects/minimal-project",
      "/check/valid-minimal/alpha",
      "/guides/b-thin",
    ]);
  });

  /**
   * A guide earns a link from a subject page by quoting that subject's real
   * figures. The reference *is* the evidence of relevance, which is why it is
   * read off the prose rather than declared in a field somebody could assert.
   */
  it("reads the subjects a guide is about off its own prose", () => {
    expect(subjectsCited(full())).toEqual(["valid-minimal"]);
  });

  it("finds nothing for a guide that quotes no subject at all", () => {
    const abstract = { ...thin(), sections: [], faqs: [], answer: "no refs" };
    expect(subjectsCited(abstract as Guide)).toEqual([]);
  });

  /**
   * A catalogue-wide or project-level figure is real proprietary data and it
   * scores as such, but it does not say which *subject* the page is about — so
   * it earns no link from a subject page.
   */
  it("ignores figures that name no subject", () => {
    const wide = {
      ...thin(),
      sections: [],
      faqs: [],
      answer: "{{catalogue.subjects}} and {{project:minimal-project.minutes}}",
    };
    expect(subjectsCited(wide as Guide)).toEqual([]);
  });

  it("counts inbound links from other guides and from cited subjects", () => {
    expect(inboundLinks(full(), corpus())).toEqual([
      { from: "/guides/b-thin", anchor: "why it did not stick" },
      { from: "/learn/valid-minimal", anchor: "Does rereading actually work?" },
    ]);
  });

  /**
   * The `/guides` index links to everything it holds. Counting that would make
   * §13.3's "≥2 inbound" self-satisfying, so it is deliberately not a source.
   */
  it("never counts a guide's own link back to itself", () => {
    const selfish = {
      ...thin(),
      sections: thin().sections.map((s) => ({
        ...s,
        links: s.links.map((l) => ({ ...l, to: "/guides/b-thin" })),
      })),
    };
    expect(
      inboundLinks(thin(), [full(), selfish]).filter(
        (i) => i.from === "/guides/b-thin",
      ),
    ).toEqual([]);
  });

  it("tells a subject page which guides belong on it", () => {
    expect(guidesForSubject("valid-minimal", corpus()).map((g) => g.slug)).toEqual(
      ["a-full", "b-thin"],
    );
    expect(guidesForSubject("something-else", corpus())).toEqual([]);
  });

  /**
   * Relevance is how often a guide quotes *this* subject's figures — the only
   * non-arbitrary signal available, and one nobody has to author. `a-full`
   * quotes valid-minimal four times to `b-thin`'s one, so it leads.
   */
  it("puts the guide that is most about the subject first", () => {
    expect(guidesForSubject("valid-minimal", [thin(), full()])[0]!.slug).toBe(
      "a-full",
    );
  });

  it("falls back to slug order when two guides are equally about it", () => {
    const twin: Guide = { ...full(), slug: "z-twin" };
    expect(
      guidesForSubject("valid-minimal", [twin, full()]).map((g) => g.slug),
    ).toEqual(["a-full", "z-twin"]);
  });

  /**
   * §8.5.1's density rule reaches the link graph: seven cards in one band is a
   * directory. The cap has to live here rather than in the page, because the
   * inbound count is computed from this list — a metric counting a link the
   * page does not draw would be worse than no metric at all.
   */
  it("shows at most four, however many are about the subject", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...full(),
      slug: `clone-${i}`,
    }));
    expect(guidesForSubject("valid-minimal", many)).toHaveLength(
      GUIDES_PER_SUBJECT,
    );
  });

  it("stops claiming an inbound link once the subject page stops drawing it", () => {
    // Five guides that quote this subject more often than `a-full` does, so it
    // is relevance rather than a tie-break that pushes it off the page — and
    // its own inbound count has to follow.
    const keener = (i: number): Guide => ({
      ...full(),
      slug: `keen-${i}`,
      tool: {
        ...full().tool,
        pitch: `${full().tool.pitch} {{topic:valid-minimal.hours}} {{topic:valid-minimal.areas}}`,
      },
    });
    const crowd = [full(), ...Array.from({ length: 5 }, (_, i) => keener(i))];

    expect(guidesForSubject("valid-minimal", crowd).map((g) => g.slug)).not.toContain(
      "a-full",
    );
    expect(inboundLinks(full(), crowd).map((i) => i.from)).not.toContain(
      "/learn/valid-minimal",
    );
  });
});

describe("the near-duplicate check", () => {
  it("has no 5-grams in a phrase shorter than five words", () => {
    expect(fiveGrams("one two three four").size).toBe(0);
  });

  it("ignores punctuation and case when comparing", () => {
    expect(fiveGrams("One, two; three: four five!")).toEqual(
      fiveGrams("one two three four five"),
    );
  });

  it("calls an empty page unlike everything rather than identical to it", () => {
    expect(overlap(new Set(), fiveGrams("a b c d e"))).toBe(0);
  });

  it("scores a page against itself as complete overlap", () => {
    const grams = fiveGrams("one two three four five six");
    expect(overlap(grams, grams)).toBe(1);
  });
});

describe("the quality score", () => {
  it("gives the control fixture full marks on everything measurable", () => {
    const report = scoreGuide(full(), corpus());
    expect(report.score).toBe(100);
    expect(report.problems).toEqual([]);
  });

  /**
   * Two of §12.2's ten dimensions need services this build does not have. They
   * are excluded from the denominator and named, rather than being awarded by
   * default — which would inflate every score and make the 75 bar meaningless.
   */
  it("names what it could not measure instead of scoring it", () => {
    const intent = dimension(full(), 3);
    expect(intent.measured).toBe(false);
    expect(intent.note).toMatch(/SERP API/);
  });

  it("marks the thin fixture down without calling anything broken", () => {
    const report = scoreGuide(thin(), corpus());
    expect(report.score).toBeLessThan(QUALITY_THRESHOLD);
    // Its only structural failure is the outbound count; everything else it
    // loses, it loses on being thin rather than on being wrong.
    expect(report.problems).toEqual(["3 outbound links, needs 4"]);
  });

  it("earns nothing for factual grounding when there are no sources", () => {
    expect(dimension(thin(), 1).earned).toBe(0);
  });

  it("earns nothing for factual grounding when a citation dangles", () => {
    const guide = { ...full(), sources: full().sources.slice(0, 1) };
    const report = scoreGuide(guide, corpus());
    expect(report.problems).toContain("cites undeclared sources: two, three");
    expect(dimension(guide, 1).earned).toBe(0);
  });

  it("docks a source nobody cites, because that is a bibliography", () => {
    const guide: Guide = {
      ...full(),
      sources: [
        ...full().sources,
        {
          id: "unused",
          url: "https://example.edu/x",
          title: "Never cited",
          note: "Present only to be ignored by the prose.",
        },
      ],
    };
    expect(dimension(guide, 1).earned).toBeCloseTo(3 / 4);
  });

  it("blocks a page that reads like one we already published", () => {
    const clone: Guide = { ...full(), slug: "a-copy" };
    const report = scoreGuide(full(), [full(), clone]);
    expect(report.problems[0]).toBe(
      "reads too much like a-copy (100% shared)",
    );
    expect(dimension(full(), 2, [full(), clone]).earned).toBe(0);
  });

  it("says so plainly when there is nothing to compare against", () => {
    expect(dimension(full(), 2, [full()]).note).toMatch(/nothing else on the site/);
  });

  /** It reports the nearest page, not the last one it happened to look at. */
  it("names the closest match rather than whichever came last", () => {
    const clone: Guide = { ...full(), slug: "a-copy" };
    expect(dimension(full(), 2, [full(), clone, thin()]).note).toMatch(
      /100% 5-gram overlap with a-copy/,
    );
  });

  it("requires a linked brief for the worked-example dimension", () => {
    expect(dimension(full(), 5).earned).toBe(1);
    expect(dimension(thin(), 5).earned).toBe(0);
    expect(dimension(full(), 5).note).toMatch(/1 linked project brief,/);
  });

  it("counts distinct source domains rather than sources", () => {
    const guide: Guide = {
      ...full(),
      sources: full().sources.map((s, i) => ({
        ...s,
        url: `https://www.example.org/${i}`,
      })),
    };
    expect(dimension(guide, 6).earned).toBeCloseTo(1 / 3);
  });

  it("counts the figures a page reads out of our own packs", () => {
    expect(dimension(full(), 7).earned).toBe(1);
    expect(dimension(thin(), 7).note).toBe("1 figure resolved from our own packs");
  });

  it("refuses a link to a page that does not exist", () => {
    const guide: Guide = {
      ...full(),
      sections: full().sections.map((s, i) =>
        i === 0 ? { ...s, links: [{ ...s.links[0]!, to: "/learn/ghost" }] } : s,
      ),
    };
    const report = scoreGuide(guide, corpus());
    expect(report.problems).toContain(
      "links to pages that do not exist: /learn/ghost",
    );
    expect(dimension(guide, 8).earned).toBe(0);
  });

  it("reports a shortfall of inbound links as a problem", () => {
    const alone = { ...full(), sections: full().sections };
    const report = scoreGuide(alone, [alone]);
    expect(report.problems).toContain("1 contextual inbound links, needs 2");
  });

  it("half-credits a tool that is only a hub page", () => {
    expect(dimension(thin(), 9).earned).toBe(0.5);
    expect(dimension(thin(), 9).note).toMatch(/hub page/);
  });

  it("refuses a tool that is not a page at all", () => {
    const guide: Guide = {
      ...full(),
      tool: { ...full().tool, path: "/nowhere" },
    };
    expect(scoreGuide(guide, corpus()).problems).toContain(
      "the tool /nowhere does not exist",
    );
    expect(dimension(guide, 9).earned).toBe(0);
  });

  it("docks a section nobody could scan", () => {
    const guide: Guide = {
      ...full(),
      sections: full().sections.map((s) => ({
        ...s,
        list: [],
        body: Array.from({ length: 401 }, () => "word").join(" "),
      })),
    };
    expect(dimension(guide, 10).earned).toBe(0);
    expect(dimension(guide, 10).note).toMatch(/401 words; no list anywhere/);
  });

  it("keeps the two standing thresholds where §12.2 put them", () => {
    expect(QUALITY_THRESHOLD).toBe(75);
    expect(QUALITY_FLOOR).toBe(70);
  });

  /**
   * One definition of "all the text", shared by the score and the link graph.
   * Two copies of this drifted within an hour of existing — one counted link
   * anchors and the other did not, so a figure quoted in a link was
   * proprietary data to one gate and invisible to the other.
   */
  it("reads the whole page — headings, questions and link anchors alike", () => {
    expect(prose(full())).toContain("Familiarity is not recall");
    expect(prose(full())).toContain("Do flashcards count?");
    expect(prose(full())).toContain("a brief with its rubric published");
  });
});

describe("the publication gate", () => {
  it("publishes a signed page that clears the bar with nothing outstanding", () => {
    expect(isGuideIndexable(full(), scoreGuide(full(), corpus()))).toBe(true);
  });

  /**
   * §12.1 rule 4, with pass 28's lesson applied: the flag is derived from the
   * score *and* a recorded reviewer, so there is no way to set it without
   * having done the thing it claims.
   */
  it("holds back a page nobody has recorded reading", () => {
    const unsigned: Guide = {
      ...full(),
      review: { reviewedBy: null, reviewKind: null, reviewedAt: null },
    };
    expect(isGuideIndexable(unsigned, scoreGuide(unsigned, corpus()))).toBe(false);
  });

  it("holds back a signed page that still has a problem", () => {
    const signed: Guide = { ...thin(), review: full().review };
    const report = scoreGuide(signed, corpus());
    expect(report.problems.length).toBeGreaterThan(0);
    expect(isGuideIndexable(signed, report)).toBe(false);
  });

  /** A page can be structurally perfect and still too thin to publish. */
  it("holds back a clean page that simply does not score enough", () => {
    const clean: Guide = {
      ...thin(),
      review: full().review,
      sections: thin().sections.map((s, i) =>
        i === 0
          ? {
              ...s,
              links: [
                {
                  to: "/projects/minimal-project",
                  type: "project_for" as const,
                  anchor: "a brief",
                },
              ],
            }
          : s,
      ),
    };
    const report = scoreGuide(clean, corpus());
    expect(report.problems).toEqual([]);
    expect(report.score).toBeLessThan(QUALITY_THRESHOLD);
    expect(isGuideIndexable(clean, report)).toBe(false);
  });
});

describe("the module a route talks to", () => {
  it("reads the corpus once and hands the same array back", () => {
    expect(allGuides()).toBe(allGuides());
    resetGuideCache();
    expect(allGuides().map((g) => g.slug)).toEqual(["a-full", "b-thin"]);
  });

  /**
   * Link anchors included. They were missed first time round, which made a link
   * the one string on a page still carrying braces — and nobody proof-reads
   * link text, so it is exactly the kind of gap that survives a review.
   */
  it("substitutes every figure before a reader can see a brace", () => {
    const anchored: Guide = {
      ...full(),
      sections: full().sections.map((s, i) =>
        i === 0
          ? {
              ...s,
              links: s.links.map((l) => ({
                ...l,
                anchor: `a {{topic:valid-minimal.hours}}-hour brief`,
              })),
            }
          : s,
      ),
    };
    expect(resolveGuide(anchored).sections[0]!.links[0]!.anchor).toBe(
      "a 3-hour brief",
    );

    const resolved = resolveGuide(full());
    expect(JSON.stringify(resolved)).not.toContain("{{");
    expect(resolved.sections[0]!.list[0]).toBe(
      "Rereading feels productive and changes little.",
    );
    expect(resolved.tool.pitch).toContain("2 skills");
    expect(resolved.faqs[0]!.question).toBe("Is this about memory or about skill?");
  });

  it("leaves the title and description exactly as written", () => {
    // The schema forbids a reference in either, so resolving them would be a
    // no-op that implied otherwise.
    expect(resolveGuide(full()).title).toBe(full().title);
    expect(resolveGuide(full()).description).toBe(full().description);
  });

  it("scores the unresolved text, so the figures still count as figures", () => {
    // Resolving first would turn `{{topic:…}}` into an ordinary number and
    // score every guide as though it had no proprietary data at all.
    expect(guideDetail("a-full")!.report.dimensions[6]!.earned).toBe(1);
  });

  it("returns nothing for a slug we do not have", () => {
    expect(guideDetail("no-such-guide")).toBeUndefined();
  });

  it("summarises the corpus in title order with its publication state", () => {
    expect(allGuideSummaries()).toEqual([
      {
        slug: "a-full",
        title: "Does rereading actually work?",
        question: "Does rereading actually work?",
        answer: expect.stringContaining("Not as well as it feels"),
        indexable: true,
        review: "human",
        outboundCount: 4,
      },
      {
        slug: "b-thin",
        title: "What should I learn next?",
        question: "What should I learn next?",
        answer: expect.stringContaining("Whatever your current work"),
        indexable: false,
        review: null,
        outboundCount: 3,
      },
    ]);
  });
});
