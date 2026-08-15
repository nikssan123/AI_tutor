// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { allTopics, findPack, skillDetails } from "@/lib/content";
import type { Audience } from "@/lib/audiences/types";

/**
 * §10 C — `/learn/{topic}-for-{audience}`.
 *
 * The corpus is mocked rather than read from `content/audiences`, because this
 * file has to assert about *both* sides of the publication gate and the real
 * pages can only ever be on one of them at a time. A signed page and a draft,
 * on the same subject, is the state the route has to handle for as long as
 * anybody is writing these — and the state that would otherwise go untested
 * until the day somebody signs one.
 *
 * The real files are checked in `audiences-quality.test.ts`, against the gate.
 */

const SUBJECT = "sql-data-analysis";
const skills = () => skillDetails(findPack(SUBJECT)!);

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

const signed = (): Audience => ({
  slug: "sql-for-testers",
  topic: SUBJECT,
  audience: "testers",
  title: "SQL for testers",
  description:
    "A page used to exercise the route on both sides of the gate, written at the length a real description has to reach before anything will accept it.",
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
      covers: skills()
        .filter((s) => s.hardPrerequisites.length === 0)
        .map((s) => s.slug),
    },
    {
      claim: "Averages and counts are familiar from a dashboard.[^two]",
      verdict: "transfers",
      note: "Familiar until a column has blanks in it, which nothing warns you about.",
      covers: [skills()[5]!.slug, skills()[6]!.slug],
    },
    {
      claim: "You say what one row means before you build it.[^three]",
      verdict: "transfers",
      note: "Saying the grain and proving it are two different jobs entirely.",
      covers: [skills()[7]!.slug, skills()[8]!.slug],
    },
  ],
  sources,
  faqs: [
    { question: "Is this real?", answer: "No, it is a fixture for the route." },
    { question: "Does it cite?", answer: "It cites every source it declares." },
    { question: "How long?", answer: "As long as the arithmetic above says." },
  ],
  review: { reviewedBy: "a test", reviewKind: "model", reviewedAt: null },
});

/** Same subject, different reader, nobody has read it. */
const draft = (): Audience => ({
  ...signed(),
  slug: "sql-for-drafters",
  title: "SQL for drafters",
  h1: "SQL for drafters",
  answer:
    "Somebody who has met a join before arrives further along than the estimate suggests, though not in the places anyone expects. Roughly {{transfers}} of {{skills}} land as revision rather than instruction, and {{hours.high}} is what remains if none of that holds up at all.",
  ifYou: [
    "Somebody once showed you how to join two tables.",
    "Nobody has ever asked what a row of your output means.",
  ],
  faqs: [
    { question: "Where from?", answer: "A fixture, exercising the draft state." },
    { question: "Who wrote it?", answer: "Nobody. That is the whole point of it." },
    { question: "Why bother?", answer: "Because the draft path needs a page too." },
  ],
  claims: [
    {
      claim: "Somebody showed you a join once, on a whiteboard.[^one]",
      verdict: "transfers",
      note: "Watching a join drawn is unrelated to predicting what it does to a total.",
      covers: skills()
        .slice(10, 18)
        .map((s) => s.slug),
    },
  ],
  review: { reviewedBy: null, reviewKind: null, reviewedAt: null },
});

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

vi.mock("@/lib/audiences/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audiences/loader")>();
  return { ...actual, loadAllAudiences: () => [signed(), draft()] };
});

const { audiencesForTopic, resetAudienceCache } = await import("@/lib/audiences");
const learn = await import("@/app/(marketing)/learn/[topic]/page");
const sitemap = await import("@/app/sitemap");

const params = <T,>(value: T) => Promise.resolve(value);

beforeEach(() => {
  resetAudienceCache();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the segment's two page types", () => {
  it("serves an audience page from a slug the packs do not own", async () => {
    render(await learn.default({ params: params({ topic: "sql-for-testers" }) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "SQL for testers",
    );
  });

  it("still serves the subject page from a pack slug", async () => {
    render(await learn.default({ params: params({ topic: SUBJECT }) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "SQL & Data Analysis",
    );
  });

  it("404s on a slug neither corpus owns", async () => {
    await expect(
      learn.default({ params: params({ topic: "sql-for-nobody" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("pre-renders both corpora", () => {
    const topics = learn.generateStaticParams().map((p) => p.topic);
    expect(topics).toContain(SUBJECT);
    expect(topics).toContain("sql-for-testers");
    expect(topics).toContain("sql-for-drafters");
  });
});

describe("the audience page", () => {
  const page = () => learn.default({ params: params({ topic: "sql-for-testers" }) });

  it("opens with the conditions the rest of it depends on", async () => {
    render(await page());
    expect(screen.getByText(/This page assumes/i)).toBeDefined();
    expect(
      screen.getByText("You already write your own queries against something."),
    ).toBeDefined();
    // And offers the page that assumes nothing to anybody they do not fit.
    expect(screen.getByText(/the ordinary SQL & Data Analysis path/)).toBeDefined();
  });

  it("resolves every figure from its own arithmetic", async () => {
    const { container } = render(await page());
    expect(container.textContent).not.toContain("{{");
    // The lead quotes the count of skills it credits the reader with.
    const credited = signed().claims[0]!.covers.length;
    expect(screen.getByText(new RegExp(`We think ${credited} of the`))).toBeDefined();
  });

  it("states the range and both of the assumptions under it", async () => {
    render(await page());
    expect(screen.getByText(/The low end assumes what transfers really does/)).toBeDefined();
    expect(screen.getByText(/Nothing comes off for the skills we think you have/)).toBeDefined();
  });

  it("links every skill it credits you with to the check that settles it", async () => {
    const { container } = render(await page());
    for (const slug of signed().claims[0]!.covers) {
      expect(
        container.querySelector(`a[href="/check/${SUBJECT}/${slug}"]`),
        slug,
      ).not.toBeNull();
    }
  });

  it("carries the caveat under a claim that only transfers", async () => {
    render(await page());
    expect(
      screen.getByText(/Familiar until a column has blanks in it/),
    ).toBeDefined();
  });

  it("links the subject, its check and the briefs that still have teeth", async () => {
    const { container } = render(await page());
    expect(container.querySelector(`a[href="/learn/${SUBJECT}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="/check/${SUBJECT}"]`)).not.toBeNull();
    expect(
      container.querySelectorAll('a[href^="/projects/"]').length,
    ).toBeGreaterThan(0);
  });

  it("shows the other cut of the same subject", async () => {
    const { container } = render(await page());
    expect(
      container.querySelector('a[href="/learn/sql-for-drafters"]'),
    ).not.toBeNull();
  });

  it("marks up the breadcrumb, the course and the FAQ, and nothing it hides", async () => {
    const { container } = render(await page());
    const blocks = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')!.innerHTML,
    ) as Array<Record<string, unknown>>;

    const types = blocks.map((b) => b["@type"]);
    expect(types).toContain("BreadcrumbList");
    expect(types).toContain("FAQPage");

    // The Course is this page's, not the subject's: fewer skills, and the
    // estimate that is left rather than the whole one.
    const course = blocks.find((b) => b["@type"] === "Course")!;
    expect(course.url).toMatch(/\/learn\/sql-for-testers$/);
    expect((course.teaches as string[]).length).toBe(
      skills().length - signed().claims[0]!.covers.length,
    );
  });

  it("describes itself with the page's own title and description", async () => {
    const meta = await learn.generateMetadata({
      params: params({ topic: "sql-for-testers" }),
    });
    expect(meta.title).toBe("SQL for testers");
    expect(meta.description).toBe(signed().description);
    expect(meta.alternates?.canonical).toMatch(/\/learn\/sql-for-testers$/);
    expect(meta.robots).toBeUndefined();
  });
});

describe("a page nobody has read", () => {
  const page = () => learn.default({ params: params({ topic: "sql-for-drafters" }) });

  it("says so on the page, in the badge and at the foot of it", async () => {
    render(await page());
    expect(screen.getByText("Draft — nobody has read it yet")).toBeDefined();
    expect(screen.getByText(/treat it as a first draft/)).toBeDefined();
  });

  it("is noindex, follow, and carries no Course markup", async () => {
    const meta = await learn.generateMetadata({
      params: params({ topic: "sql-for-drafters" }),
    });
    expect(meta.robots).toEqual({ index: false, follow: true });

    const { container } = render(await page());
    const blocks = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')!.innerHTML,
    ) as Array<Record<string, unknown>>;
    expect(blocks.map((b) => b["@type"])).not.toContain("Course");
  });

  it("is kept out of the sitemap while the signed one is in it", () => {
    const urls = sitemap.audiencePages().map((entry) => entry.url);
    expect(urls.some((u) => u.endsWith("/learn/sql-for-testers"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/learn/sql-for-drafters"))).toBe(false);
  });
});

/**
 * The states the two fixtures above cannot both be in at once.
 *
 * A page that credits its reader with everything is not a hypothetical: it is
 * what an audience page becomes as its subject grows a shorter cut, and the
 * sections it should then stop drawing — the transfers, the briefs, the other
 * cuts — are exactly the ones that read worst as empty headings.
 */
describe("a page with nothing left to show", () => {
  it("draws no empty sections, and counts one question as one", async () => {
    const { AudienceBody } = await import("@/components/audience-body");
    const { audiencePath } = await import("@/lib/audiences/path");

    const path = audiencePath(signed());
    const only = { ...path.known[0]!, itemCount: 1 };
    const { container } = render(
      <AudienceBody
        detail={{
          path: {
            ...path,
            audience: {
              ...path.audience,
              claims: [signed().claims[0]!],
              sources: [],
              faqs: [],
            },
            skills: [only],
            known: [only],
            transfers: [],
            fresh: [],
            frontier: [],
            projects: [],
          },
          report: { slug: signed().slug, score: 100, dimensions: [], problems: [] },
          indexable: true,
          inbound: [],
          siblings: [],
        }}
      />,
    );

    expect(screen.queryByText(/under another name/)).toBeNull();
    expect(screen.queryByText(/Briefs you could not hand in today/)).toBeNull();
    expect(screen.queryByText(/Sources, and what each is worth/)).toBeNull();
    expect(screen.queryByText(/Questions that come with this one/)).toBeNull();
    expect(screen.queryByText(/Arriving with something else/)).toBeNull();
    expect(container.textContent).toContain("one question");

    // And the markup does not describe a FAQ the page no longer has.
    const blocks = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')!.innerHTML,
    ) as Array<Record<string, unknown>>;
    expect(blocks.map((b) => b["@type"])).not.toContain("FAQPage");
  });
});

describe("the subject page", () => {
  it("lists every cut of itself, drafts included", async () => {
    const { container } = render(
      await learn.default({ params: params({ topic: SUBJECT }) }),
    );
    // Drafts are listed because this link is the inbound one their own gate
    // counts; hiding them would make that rule measure itself.
    expect(container.querySelector('a[href="/learn/sql-for-testers"]')).not.toBeNull();
    expect(container.querySelector('a[href="/learn/sql-for-drafters"]')).not.toBeNull();
    expect(screen.getByText(/The shorter route in/)).toBeDefined();
  });

  it("says how much of the subject each cut claims you already have", async () => {
    render(await learn.default({ params: params({ topic: SUBJECT }) }));
    const credited = signed().claims.flatMap((c) => c.covers).length;
    expect(
      screen.getByText(`${credited} of ${skills().length} skills you may already have`),
    ).toBeDefined();
  });

  it("renumbers the section that follows it", async () => {
    render(await learn.default({ params: params({ topic: SUBJECT }) }));
    // Guides come after the audience band, so they take 04 rather than 03.
    expect(screen.getByText(/03 · Already know some of this/)).toBeDefined();
    expect(screen.getByText(/04 · Before you start/)).toBeDefined();
  });

  it("leaves the numbering alone on a subject nobody has cut", async () => {
    const uncut = allTopics().find((t) => audiencesForTopic(t.slug).length === 0)!;
    render(await learn.default({ params: params({ topic: uncut.slug }) }));
    expect(screen.queryByText(/Already know some of this/)).toBeNull();
    expect(screen.queryByText(/04 ·/)).toBeNull();
  });
});
