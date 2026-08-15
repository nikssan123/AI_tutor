import { describe, expect, it } from "vitest";
import { allAudiences } from "@/lib/audiences";
import { findPack, skillDetails, topicSummary } from "@/lib/content";
import {
  CLAIM_OVERLAP_LIMIT,
  claimOverlap,
  claimPairs,
  isAudienceIndexable,
  scoreAudience,
} from "@/lib/audiences/quality";
import {
  inboundLinks,
  outboundPaths,
  roadmapHref,
  siblings,
} from "@/lib/audiences/links";
import { audiencePath, type AudiencePath } from "@/lib/audiences/path";
import type { Audience } from "@/lib/audiences/types";

/**
 * §12.2 for §10 C.
 *
 * Written against the real packs rather than the two-skill fixture, because the
 * two dimensions this gate exists for are both about *scale*: whether a page
 * re-cuts enough of a graph to be worth publishing, and whether two pages cut
 * one graph the same way. Neither question means anything where the graph has
 * two skills in it.
 *
 * The inputs are derived from the pack rather than named, so a curriculum edit
 * moves the test with it instead of breaking it.
 */

const SUBJECT = "sql-data-analysis";
const pack = findPack(SUBJECT)!;
const skills = skillDetails(pack);
const roots = skills.filter((s) => s.hardPrerequisites.length === 0);
/** Enough of the graph to clear §12.2's coverage target with room to spare. */
const covered = skills.slice(0, 8).map((s) => s.slug);

const sources = [
  {
    id: "one",
    url: "https://www.postgresql.org/docs/current/functions-aggregate.html",
    title: "PostgreSQL, Aggregate Functions",
    note: "The reference for what an aggregate does with a missing value.",
  },
  {
    id: "two",
    url: "https://www.sqlite.org/nulls.html",
    title: "NULL handling across engines",
    note: "Short, and shows the rules are not universal across engines.",
  },
  {
    id: "three",
    url: "https://sqlbolt.com/",
    title: "SQLBolt",
    note: "Free and interactive, and a fair way to test the claims here.",
  },
];

const base = (overrides: Partial<Audience> = {}): Audience => ({
  slug: "sql-for-testers",
  topic: SUBJECT,
  audience: "testers",
  title: "SQL for testers",
  description:
    "A synthetic page used to exercise the publication gate, written at the length a real description has to reach before anything will accept it.",
  h1: "SQL for testers",
  answer:
    "We think {{known}} of the {{skills}} skills here are behind you already, which puts the estimate somewhere between {{hours.low}} hours and the rest of it. Everything on this page is a guess about you rather than a finding, and the check is the thing that settles which half of it was right.",
  ifYou: [
    "You already write your own queries against something.",
    "You have never had to prove a total was not inflated.",
  ],
  claims: [
    {
      claim: "You choose columns and filter rows already.[^one]",
      verdict: "known",
      covers: roots.map((s) => s.slug),
    },
    {
      claim: "Averages and counts are familiar from a dashboard.[^two]",
      verdict: "transfers",
      note: "Familiar until a column has blanks in it, which nothing warns you about.",
      covers: covered.filter((s) => !roots.some((r) => r.slug === s)).slice(0, 3),
    },
    {
      claim: "You say what one row means before you build it.[^three]",
      verdict: "transfers",
      note: "Saying the grain and proving it are two different jobs entirely.",
      covers: covered.filter((s) => !roots.some((r) => r.slug === s)).slice(3),
    },
  ],
  sources,
  faqs: [
    { question: "Is this real?", answer: "No, it is a fixture for the gate." },
    { question: "Does it cite?", answer: "It cites every source it declares." },
    { question: "How long?", answer: "As long as the arithmetic above says." },
  ],
  review: { reviewedBy: "a test", reviewKind: "model", reviewedAt: null },
  ...overrides,
});

/**
 * The page and one sibling, which is what the inbound rule requires.
 *
 * Written in different words as well as over different skills, because the gate
 * measures both and the first draft of this fixture failed its own duplicate
 * check — two pages that differed only in their claims still shared
 * sixty-three per cent of their sentences. That is the rule catching the person
 * who wrote it, which is the best evidence it works.
 */
const sibling = (): Audience =>
  base({
    slug: "sql-for-others",
    title: "SQL for others",
    h1: "SQL for others",
    answer:
      "Somebody who has met a join before arrives at this subject further along than the estimate suggests, though not in the places anyone expects. Roughly {{transfers}} of {{skills}} land as revision rather than instruction, and {{hours.high}} is what remains if none of that holds up.",
    ifYou: [
      "Somebody once showed you how to join two tables.",
      "Nobody has ever asked you what a row of your output means.",
    ],
    faqs: [
      { question: "Where did this come from?", answer: "A fixture, exercising a sibling." },
      { question: "Who wrote it?", answer: "Nobody. It exists to differ from its twin." },
      { question: "Why bother?", answer: "Because the duplicate rule needs two pages." },
    ],
    claims: [
      {
        claim: "Somebody showed you a join once, on a whiteboard.[^one]",
        verdict: "transfers",
        note: "Watching a join drawn is unrelated to predicting what it does to a total.",
        covers: skills.slice(8, 16).map((s) => s.slug),
      },
    ],
  });

const corpus = () => [base(), sibling()];
const report = (audience: Audience, all = corpus()) =>
  scoreAudience(audiencePath(audience), all);

/** A path assembled by hand, for the shapes a real pack cannot produce. */
const bare = (overrides: Partial<AudiencePath> = {}): AudiencePath => ({
  audience: base(),
  topic: topicSummary(pack),
  skills: [],
  known: [],
  transfers: [],
  fresh: [],
  frontier: [],
  assumed: [],
  hours: { total: 0, known: 0, transfers: 0, fresh: 0, low: 0, high: 0 },
  projects: [],
  ...overrides,
});

describe("the link graph", () => {
  it("orders the sibling cuts of one subject, and counts them inbound", () => {
    const third = base({ slug: "sql-for-arrivals", title: "SQL for arrivals" });
    const all = [base(), sibling(), third];

    expect(siblings(base(), all).map((a) => a.slug)).toEqual([
      "sql-for-arrivals",
      "sql-for-others",
    ]);
    // The subject page is the first inbound link and the siblings are the rest,
    // which is what carries an audience page past §13.3's ≥2 rule.
    expect(inboundLinks(base(), all).map((i) => i.from)).toEqual([
      `/learn/${SUBJECT}`,
      "/learn/sql-for-arrivals",
      "/learn/sql-for-others",
    ]);
    expect(siblings(base(), [base()])).toEqual([]);
  });

  it("keeps the parameterised roadmap link out of the countable ones", () => {
    const drawn = outboundPaths(audiencePath(base()), corpus());
    expect(drawn.every((p) => !p.includes("?"))).toBe(true);
    expect(roadmapHref(SUBJECT)).toContain("?subject=");
  });
});

describe("the claim-overlap measure", () => {
  it("compares what two pages assert, not what they left out", () => {
    const mine = claimPairs(audiencePath(base()));
    expect([...mine].every((pair) => !pair.endsWith(":new"))).toBe(true);
    expect(claimOverlap(mine, mine)).toBe(1);
    expect(claimOverlap(mine, claimPairs(audiencePath(sibling())))).toBe(0);
    expect(claimOverlap(new Set(), new Set())).toBe(0);
  });
});

describe("scoreAudience", () => {
  it("passes a complete page and publishes it once somebody has read it", () => {
    const result = report(base());
    expect(result.problems).toEqual([]);
    expect(result.score).toBe(100);
    expect(isAudienceIndexable(audiencePath(base()), result)).toBe(true);
  });

  it("names the dimension nothing here can measure", () => {
    const intent = report(base()).dimensions.find((d) => d.id === 3)!;
    expect(intent.measured).toBe(false);
    expect(intent.note).toMatch(/SERP API/);
  });

  it("refuses a page that cites a source it never declared", () => {
    const result = report(
      base({
        ifYou: ["You already write your own queries.[^four]", "You have not proved a total."],
      }),
    );
    expect(result.problems).toContainEqual(expect.stringContaining("undeclared"));
    expect(result.dimensions.find((d) => d.id === 1)!.earned).toBe(0);
  });

  it("costs a page for a source nobody cites, and for having none", () => {
    const withBibliography = report(
      base({ sources: [...sources, { ...sources[0]!, id: "four" }] }),
    );
    expect(withBibliography.dimensions.find((d) => d.id === 1)!.earned).toBeLessThan(1);
    expect(withBibliography.problems).toEqual([]);

    const none = report(base({ sources: [] }));
    expect(none.dimensions.find((d) => d.id === 1)!.earned).toBe(0);
    expect(none.dimensions.find((d) => d.id === 6)!.earned).toBe(0);
  });

  /**
   * The check this page type most needed. "The same course, filtered for a
   * different job title" is the obvious way to turn one pack into fifty pages,
   * and it is exactly what §12 was written to stop.
   */
  it("refuses two pages that credit one subject's readers with the same skills", () => {
    const twin = base({ slug: "sql-for-twins", title: "SQL for twins", h1: "SQL for twins" });
    const result = report(twin, [base(), twin]);

    expect(result.problems).toContainEqual(expect.stringContaining("same skills"));
    expect(result.dimensions.find((d) => d.id === 2)!.earned).toBe(0);
    expect(claimOverlap(claimPairs(audiencePath(twin)), claimPairs(audiencePath(base()))))
      .toBeGreaterThanOrEqual(CLAIM_OVERLAP_LIMIT);
  });

  it("refuses two pages that read alike even on different subjects", () => {
    const elsewhere = base({
      slug: "writing-for-testers",
      topic: "business-writing",
      claims: [
        {
          claim: "You have written a paragraph before now.[^one]",
          verdict: "transfers",
          note: "Writing one and being read are not the same achievement.",
          covers: [skillDetails(findPack("business-writing")!)[0]!.slug],
        },
      ],
    });
    const result = report(elsewhere, [base(), elsewhere]);
    expect(result.problems).toContainEqual(expect.stringContaining("reads like"));
  });

  it("holds a page back until its subject has a second cut", () => {
    const alone = report(base(), [base()]);
    expect(alone.problems).toContainEqual(
      expect.stringContaining("no second audience page"),
    );
  });

  /**
   * The graph contradicting the prose: crediting a skill while leaving what it
   * rests on unclaimed. Never rendered — it blocks publication instead.
   */
  it("refuses a page whose known claim rests on skills it does not cover", () => {
    const dependent = skills.find(
      (s) => s.hardPrerequisites.length > 0 && !covered.includes(s.slug),
    )!;
    const result = report(
      base({
        claims: [
          ...base().claims.slice(1),
          {
            claim: "You can already do the dependent thing.[^one]",
            verdict: "known",
            covers: [dependent.slug],
          },
        ],
      }),
    );
    expect(result.problems).toContainEqual(
      expect.stringContaining(dependent.hardPrerequisites[0]!),
    );
  });

  it("scores a page down for classifying almost none of the graph", () => {
    const thin = report(
      base({
        claims: [
          {
            claim: "You have opened a database client at least once.[^one]",
            verdict: "transfers",
            note: "Opening one and getting an answer out are different days.",
            covers: [roots[0]!.slug],
          },
        ],
      }),
    );
    expect(thin.dimensions.find((d) => d.id === 7)!.earned).toBeLessThan(1);
    expect(thin.score).toBeLessThan(100);
  });

  it("scores a page down for quoting none of its own arithmetic", () => {
    const silent = report(
      base({ answer: base().answer.replace(/\{\{[a-z.]+\}\}/g, "some") }),
    );
    expect(silent.dimensions.find((d) => d.id === 7)!.earned).toBeLessThan(1);
    expect(silent.dimensions.find((d) => d.id === 7)!.note).toMatch(/0 figures/);
  });

  it("counts a single quoted figure as one, in a line about writing", () => {
    const once = report(
      base({
        answer: base()
          .answer.replace(/\{\{[a-z.]+\}\}/g, "some")
          .replace("some of the some skills", "{{known}} of the skills"),
      }),
    );
    expect(once.dimensions.find((d) => d.id === 7)!.note).toMatch(/1 figure /);
  });

  it("scores completeness by what the page type promises", () => {
    const partial = report(
      base({
        faqs: [],
        claims: [
          {
            claim: "You choose columns and filter rows already.[^one]",
            verdict: "known",
            covers: covered,
          },
        ],
      }),
    );
    // No FAQs, one claim, and nothing transferring: three of four parts fail.
    expect(partial.dimensions.find((d) => d.id === 4)!.earned).toBeCloseTo(0.25);
  });

  it("scores readability against a claim that is really a paragraph", () => {
    const rambling = report(
      base({
        claims: [
          {
            claim: `You already do this.[^one] ${Array.from({ length: 130 }, () => "word").join(" ")}`,
            verdict: "known",
            covers: roots.map((s) => s.slug),
          },
          ...base().claims.slice(1),
        ],
        ifYou: [
          Array.from({ length: 31 }, () => "word").join(" "),
          "You have never had to prove a total was not inflated.",
        ],
      }),
    );
    expect(rambling.dimensions.find((d) => d.id === 10)!.earned).toBe(0);
  });

  it("gives no credit for examples when every brief is already within reach", () => {
    const result = scoreAudience(bare(), corpus());
    expect(result.dimensions.find((d) => d.id === 5)!.earned).toBe(0);
    expect(result.dimensions.find((d) => d.id === 5)!.note).toMatch(/hand in today/);
  });

  it("counts the outbound links the page really draws", () => {
    const result = scoreAudience(bare(), corpus());
    // A path with nothing on it still links its subject, its check and the
    // sibling cut — three, where the rule asks for four.
    expect(result.problems).toContainEqual(
      expect.stringContaining("3 outbound links, needs 4"),
    );
  });

  it("refuses a page that links somewhere the site does not serve", () => {
    const result = scoreAudience(
      bare({ topic: { ...topicSummary(pack), slug: "no-such-subject" } }),
      corpus(),
    );
    expect(result.problems).toContainEqual(
      expect.stringContaining("/learn/no-such-subject"),
    );
    expect(result.dimensions.find((d) => d.id === 8)!.earned).toBe(0);
  });

  /**
   * Every claim is a hypothesis about the reader and the check is what settles
   * it, so a claim over a skill with no questions behind it is one the page
   * cannot offer to test — which makes its call to action untrue.
   */
  it("scores conversion down for a claim no check can settle", () => {
    const [first] = skills;
    const result = scoreAudience(
      bare({
        skills: [{ ...first!, verdict: "known", itemCount: 0 }],
        known: [{ ...first!, verdict: "known", itemCount: 0 }],
      }),
      corpus(),
    );
    const conversion = result.dimensions.find((d) => d.id === 9)!;
    expect(conversion.earned).toBe(0.5);
    expect(conversion.note).toMatch(/no questions behind them/);
  });
});

/**
 * The pages actually in `content/audiences`, held to the gate they ship behind.
 *
 * `pnpm audiences:validate` is the same check at the command line; this is the
 * one that runs in CI, and it is deliberately about the real corpus rather than
 * a fixture — the failure it is here to catch is a curriculum edit silently
 * invalidating a claim somebody published months earlier.
 */
describe("the pages in content/audiences", () => {
  const real = allAudiences();

  it("has some", () => {
    expect(real.length).toBeGreaterThan(0);
  });

  it("resolves every claim against the pack it names", () => {
    for (const audience of real) {
      expect(() => audiencePath(audience), audience.slug).not.toThrow();
    }
  });

  it("clears the publication bar with nothing outstanding", () => {
    for (const audience of real) {
      const result = scoreAudience(audiencePath(audience), real);
      expect(result.problems, audience.slug).toEqual([]);
      expect(result.score, audience.slug).toBeGreaterThanOrEqual(75);
    }
  });
});

describe("isAudienceIndexable", () => {
  it("holds a page back until somebody records a read", () => {
    const unsigned = base({ review: { reviewedBy: null, reviewKind: null, reviewedAt: null } });
    expect(isAudienceIndexable(audiencePath(unsigned), report(unsigned))).toBe(false);
  });

  it("holds a page back while the subject it re-cuts is still a draft", () => {
    const draft = findPack("python-fundamentals")!;
    expect(topicSummary(draft).indexable).toBe(false);

    const onDraft = base({
      slug: "python-for-testers",
      topic: draft.slug,
      claims: [
        {
          claim: "You have written a loop in something before.[^one]",
          verdict: "transfers",
          note: "In something is not the same as in this, as the syntax shows.",
          covers: [skillDetails(draft)[0]!.slug],
        },
      ],
    });
    const path = audiencePath(onDraft);
    expect(isAudienceIndexable(path, { ...report(onDraft), score: 100, problems: [] })).toBe(
      false,
    );
  });

  it("holds a page back under the bar, and with anything outstanding", () => {
    const path = audiencePath(base());
    const clean = report(base());
    expect(isAudienceIndexable(path, { ...clean, score: 74 })).toBe(false);
    expect(isAudienceIndexable(path, { ...clean, problems: ["something"] })).toBe(false);
  });
});
