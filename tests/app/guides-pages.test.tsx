// @vitest-environment jsdom
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { loadPack } from "@/lib/packs/loader";
import type { DomainPack } from "@/lib/packs/types";
import type { Guide } from "@/lib/guides/types";

/**
 * §10 D's two routes, the prose renderer under them, and the two places a
 * guide reaches the rest of the site — the sitemap, and the subject page that
 * links back to it.
 *
 * Both loaders are mocked to fixtures. The pack fixture is what the guides'
 * own-data references resolve against; the guide fixtures are a published page
 * and a draft, so every branch that turns on publication state is exercised by
 * a real file rather than by a flag set in a test.
 */

const minimal = (): DomainPack =>
  loadPack(join("tests/fixtures/packs", "valid-minimal"));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

vi.mock("@/lib/packs/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/packs/loader")>();
  return { ...actual, loadAllPacks: () => [minimal()] };
});

const guideSource = vi.hoisted(() => ({ dir: "tests/fixtures/guides" }));

vi.mock("@/lib/guides/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guides/loader")>();
  return { ...actual, loadAllGuides: () => actual.loadAllGuides(guideSource.dir) };
});

const { resetContentCache } = await import("@/lib/content");
const { resetGuideCache } = await import("@/lib/guides");
const { Prose, SectionLinks, Sources } = await import("@/components/guide-body");
const index = await import("@/app/(marketing)/guides/page");
const guide = await import("@/app/(marketing)/guides/[slug]/page");
const topic = await import("@/app/(marketing)/learn/[topic]/page");
const { guidePages } = await import("@/app/sitemap");

const params = <T,>(value: T) => Promise.resolve(value);

const ld = (container: HTMLElement) =>
  [...container.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => JSON.parse(s.textContent!))
    .flat();

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
  guideSource.dir = "tests/fixtures/guides";
  resetContentCache();
  resetGuideCache();
});

afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("the prose renderer", () => {
  const sources = [
    {
      id: "one",
      url: "https://example.org/one",
      title: "First",
      note: "An honest one-line assessment.",
    },
  ];

  it("splits on blank lines and drops the empty ones", () => {
    const { container } = render(
      <Prose text={"First para.\n\n\n  \n\nSecond para." } sources={sources} />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("turns a citation into a numbered link to the source", () => {
    render(<Prose text="A claim.[^one]" sources={sources} />);
    const link = screen.getByRole("link", { name: "Source 1" });
    expect(link.getAttribute("href")).toBe("#source-one");
    expect(link.textContent).toBe("1");
  });

  /**
   * A dangling citation blocks publication, so this only renders while a guide
   * is being drafted. Showing the raw marker is the right failure: it is
   * visibly wrong, where a silently dropped citation reads as an uncited claim.
   */
  it("leaves an unknown citation visible rather than swallowing it", () => {
    const { container } = render(
      <Prose text="A claim.[^missing]" sources={sources} />,
    );
    expect(container.textContent).toContain("[^missing]");
    expect(container.querySelector("sup")).toBeNull();
  });

  it("renders the one other mark it supports", () => {
    const { container } = render(
      <Prose text="It is *not* the same." sources={sources} />,
    );
    expect(container.querySelector("em")!.textContent).toBe("not");
  });

  it("renders nothing at all for a section with no links", () => {
    const { container } = render(
      <SectionLinks
        section={{ heading: "h", body: "b", list: [], links: [] }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("numbers the sources and gives each one an anchor to be cited at", () => {
    const { container } = render(<Sources sources={sources} />);
    expect(container.querySelector("#source-one")).not.toBeNull();
    expect(screen.getByRole("link", { name: /1\. First/ })).toBeDefined();
    expect(screen.getByText("An honest one-line assessment.")).toBeDefined();
  });
});

describe("/guides", () => {
  it("lists every guide, and says which ones are not published", () => {
    render(index.default());
    expect(screen.getByText("Does rereading actually work?")).toBeDefined();
    expect(screen.getByText("What should I learn next?")).toBeDefined();
    // One draft in the fixture corpus, one published.
    expect(screen.getAllByText("Draft — not published yet")).toHaveLength(1);
  });

  it("says nothing about freshness when it has nothing to list", () => {
    guideSource.dir = "tests/fixtures/no-guides-here";
    resetGuideCache();
    render(index.default());
    expect(screen.getByText("No guides yet.")).toBeDefined();
    expect(screen.queryByText(/cannot drift out of date/)).toBeNull();
  });

  it("is indexable in its own right", () => {
    expect(index.generateMetadata().robots).toBeUndefined();
  });
});

describe("/guides/{slug}", () => {
  it("builds a static path for every guide, drafts included", () => {
    expect(guide.generateStaticParams()).toEqual([
      { slug: "a-full" },
      { slug: "b-thin" },
    ]);
  });

  it("opens with the direct answer as the lead", async () => {
    render(await guide.default({ params: params({ slug: "a-full" }) }));
    expect(
      screen.getByRole("heading", { name: "Does rereading actually work?", level: 1 }),
    ).toBeDefined();
    expect(screen.getByText(/Not as well as it feels like it does/)).toBeDefined();
  });

  /** §12.1 rule 2 — the tool is why a prose page is allowed to exist at all. */
  it("puts the working tool above the argument", async () => {
    const { container } = render(
      await guide.default({ params: params({ slug: "a-full" }) }),
    );
    const tool = screen.getByRole("link", { name: "Find out what survived" });
    expect(tool.getAttribute("href")).toBe("/check/valid-minimal");

    const body = container.textContent!;
    expect(body.indexOf("Find out what survived")).toBeLessThan(
      body.indexOf("Familiarity is not recall"),
    );
  });

  it("resolves every figure, so no reader meets a brace", async () => {
    const { container } = render(
      await guide.default({ params: params({ slug: "a-full" }) }),
    );
    expect(container.textContent).not.toContain("{{");
    expect(container.textContent).toContain("across 2 skills");
  });

  it("renders the section list, and the links where they were authored", async () => {
    render(await guide.default({ params: params({ slug: "a-full" }) }));
    expect(screen.getByText("Retrieval feels bad and works.")).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "a brief with its rubric published" })
        .getAttribute("href"),
    ).toBe("/projects/minimal-project");
  });

  it("marks up the FAQ it actually shows, and nothing else", async () => {
    const { container } = render(
      await guide.default({ params: params({ slug: "a-full" }) }),
    );
    const faq = ld(container).find((b) => b["@type"] === "FAQPage");
    expect(faq.mainEntity).toHaveLength(3);
    expect(faq.mainEntity[0].name).toBe("Is this about memory or about skill?");
    expect(screen.getByText("Is this about memory or about skill?")).toBeDefined();
  });

  it("emits no FAQ markup for a guide that has no questions", async () => {
    const { container } = render(
      await guide.default({ params: params({ slug: "b-thin" }) }),
    );
    expect(ld(container).some((b) => b["@type"] === "FAQPage")).toBe(false);
  });

  it("says plainly when nobody has read the page yet", async () => {
    render(await guide.default({ params: params({ slug: "b-thin" }) }));
    expect(screen.getByText(/treat it as a first draft/)).toBeDefined();
  });

  it("drops that line once somebody has", async () => {
    render(await guide.default({ params: params({ slug: "a-full" }) }));
    expect(screen.queryByText(/treat it as a first draft/)).toBeNull();
  });

  it("offers the other questions, but never itself", async () => {
    render(await guide.default({ params: params({ slug: "a-full" }) }));
    const next = screen.getAllByRole("link", { name: "What should I learn next?" });
    expect(next.length).toBeGreaterThan(0);
    expect(
      screen.queryAllByRole("link", { name: "Does rereading actually work?" }),
    ).toHaveLength(0);
  });

  it("has nothing to offer when it is the only guide", async () => {
    guideSource.dir = "tests/fixtures/guides-solo";
    resetGuideCache();
    render(await guide.default({ params: params({ slug: "a-full" }) }));
    expect(screen.queryByText("Next question")).toBeNull();
  });

  it("404s on a slug we do not have", async () => {
    await expect(
      guide.default({ params: params({ slug: "invented" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("returns empty metadata for a slug we do not have", async () => {
    expect(
      await guide.generateMetadata({ params: params({ slug: "invented" }) }),
    ).toEqual({});
  });

  it("is indexable once it is signed and clean, and not before", async () => {
    const published = await guide.generateMetadata({
      params: params({ slug: "a-full" }),
    });
    expect(published.robots).toBeUndefined();
    expect(published.alternates!.canonical).toBe(
      "https://example.com/guides/a-full",
    );

    const draft = await guide.generateMetadata({
      params: params({ slug: "b-thin" }),
    });
    expect(draft.robots).toEqual({ index: false, follow: true });
  });
});

describe("the sitemap", () => {
  it("submits the hub and the published guides, never the drafts", () => {
    expect(guidePages().map((e) => e.url)).toEqual([
      "https://example.com/guides",
      "https://example.com/guides/a-full",
    ]);
  });

  /** A hub whose every child is a draft is a thin page; it waits its turn. */
  it("withholds the hub itself while nothing under it is published", () => {
    guideSource.dir = "tests/fixtures/guides-drafts";
    resetGuideCache();
    expect(guidePages()).toEqual([]);
  });
});

describe("the link back from a subject page", () => {
  it("shows the guides that quote this subject's own figures", async () => {
    render(await topic.default({ params: params({ topic: "valid-minimal" }) }));
    expect(screen.getByText("Questions people ask about this")).toBeDefined();
    expect(
      screen
        .getAllByRole("link", { name: "Does rereading actually work?" })[0]!
        .getAttribute("href"),
    ).toBe("/guides/a-full");
  });

  it("shows nothing when no guide is about this subject", async () => {
    guideSource.dir = "tests/fixtures/guides-drafts";
    resetGuideCache();
    render(await topic.default({ params: params({ topic: "valid-minimal" }) }));
    expect(screen.queryByText("Questions people ask about this")).toBeNull();
  });
});

/** Kept honest against the fixture rather than against a hand-written type. */
it("has fixtures that are what the tests above assume", async () => {
  const { loadAllGuides } = await import("@/lib/guides/loader");
  const corpus: Guide[] = loadAllGuides("tests/fixtures/guides");
  expect(corpus.map((g) => g.review.reviewKind)).toEqual(["human", null]);
});
