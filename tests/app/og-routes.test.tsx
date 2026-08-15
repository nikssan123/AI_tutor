import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { OgCard } from "@/lib/seo/og";

/**
 * The three `opengraph-image` routes.
 *
 * `next/og` is mocked rather than run: satori's job is turning an element tree
 * into a PNG and that is Vercel's code, checked by rendering the real images and
 * looking at them. What is ours — which card each route picks, what it falls
 * back to, and whether the fonts are actually attached — is asserted here.
 */

const captured: Array<{ element: ReactElement; options: Record<string, unknown> }> = [];

vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: ReactElement, options: Record<string, unknown>) {
      captured.push({ element, options });
    }
  },
}));

beforeEach(() => {
  captured.length = 0;
});

/** The single capture from the call under test. */
function card(): OgCard {
  expect(captured).toHaveLength(1);
  return (captured[0]!.element.props as { card: OgCard }).card;
}

function options(): Record<string, unknown> {
  return captured[0]!.options;
}

describe("every card route", () => {
  it("renders at 1200×630 as a PNG, with both weights attached", async () => {
    const mod = await import("@/app/(marketing)/opengraph-image");
    mod.default();

    expect(mod.size).toEqual({ width: 1200, height: 630 });
    expect(mod.contentType).toBe("image/png");
    expect(options()).toMatchObject({ width: 1200, height: 630 });

    // Satori has no stylesheet: a missing weight here does not fail, it
    // silently renders the whole card at 400 and loses every bit of contrast.
    const fonts = options().fonts as Array<{ weight: number; data: Buffer }>;
    expect(fonts.map((f) => f.weight).sort()).toEqual([400, 600]);
    for (const font of fonts) expect(font.data.byteLength).toBeGreaterThan(0);
  });

  it("prerenders one image per page, so satori never runs on a crawl", async () => {
    // Without these the routes build as `ƒ (Dynamic)` and every unfurl of every
    // share re-renders the PNG. The lists have to match the pages' own, because
    // an image route does not inherit its segment's params.
    const { allPacks, allProjects } = await import("@/lib/content");
    const { allAudiences } = await import("@/lib/audiences");

    // The subject segment serves §10 C's pages as well, so its image route has
    // to cover both or every audience page's card renders on the first unfurl.
    const subject = await import("@/app/(marketing)/learn/[topic]/opengraph-image");
    expect(subject.generateStaticParams()).toEqual([
      ...allPacks().map((p) => ({ topic: p.slug })),
      ...allAudiences().map((a) => ({ topic: a.slug })),
    ]);

    const project = await import("@/app/(marketing)/projects/[slug]/opengraph-image");
    expect(project.generateStaticParams()).toEqual(
      allProjects().map((p) => ({ slug: p.slug })),
    );
  });

  it("describes itself in alt text on all three", async () => {
    for (const path of [
      "@/app/(marketing)/opengraph-image",
      "@/app/(marketing)/learn/[topic]/opengraph-image",
      "@/app/(marketing)/projects/[slug]/opengraph-image",
    ]) {
      const mod = await import(path);
      expect(mod.alt.length, path).toBeGreaterThan(20);
    }
  });
});

describe("the subject card route", () => {
  it("builds the card from the pack behind the slug", async () => {
    const { default: Image } = await import(
      "@/app/(marketing)/learn/[topic]/opengraph-image"
    );
    await Image({ params: Promise.resolve({ topic: "sql-data-analysis" }) });

    expect(card().eyebrow).toBe("Subject");
    expect(card().badge).not.toBeNull();
  });

  it("falls back to the brand card rather than throwing on an unknown slug", async () => {
    const { default: Image } = await import(
      "@/app/(marketing)/learn/[topic]/opengraph-image"
    );
    await Image({ params: Promise.resolve({ topic: "no-such-subject" }) });

    expect(card().eyebrow).toBeNull();
    expect(card().badge).toBeNull();
  });

  /**
   * §10 C shares the segment and makes a different claim on the card: not what
   * a subject covers, but how much of it somebody arriving from a job does not
   * have to start from scratch on.
   */
  it("builds an audience card for the same segment's other page type", async () => {
    const { allAudiences } = await import("@/lib/audiences");
    const audience = allAudiences()[0]!;
    expect(audience).toBeDefined();

    const { default: Image } = await import(
      "@/app/(marketing)/learn/[topic]/opengraph-image"
    );
    await Image({ params: Promise.resolve({ topic: audience.slug }) });

    expect(card().title).toBe(audience.h1);
    expect(card().eyebrow).not.toBe("Subject");
    expect(card().facts.some((f) => f.includes("hours"))).toBe(true);
  });
});

describe("the project card route", () => {
  it("builds the card from the brief behind the slug", async () => {
    const { findProject, allProjects } = await import("@/lib/content");
    const slug = allProjects()[0]!.slug;

    const { default: Image } = await import(
      "@/app/(marketing)/projects/[slug]/opengraph-image"
    );
    await Image({ params: Promise.resolve({ slug }) });

    expect(card().title).toBe(findProject(slug)!.title);
    expect(card().facts[0]).toMatch(/criteria$/);
  });

  it("falls back to the brand card on an unknown slug", async () => {
    const { default: Image } = await import(
      "@/app/(marketing)/projects/[slug]/opengraph-image"
    );
    await Image({ params: Promise.resolve({ slug: "no-such-project" }) });

    expect(card().eyebrow).toBeNull();
  });
});
