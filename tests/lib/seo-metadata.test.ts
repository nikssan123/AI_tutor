import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { marketingMetadata } from "@/lib/seo/metadata";

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
});

const base = {
  title: "A subject",
  description: "What the subject covers, and what your work is marked against.",
  path: "/learn/a-subject",
};

describe("marketingMetadata", () => {
  it("sets the canonical explicitly, never by default (§13.3)", () => {
    expect(marketingMetadata(base).alternates?.canonical).toBe(
      "https://example.com/learn/a-subject",
    );
  });

  it("gives every page a large card, which is what makes the image usable", () => {
    // Without the card type X renders the small square and crops a 1200×630
    // image to nothing, so the image route would ship and do nothing.
    expect(marketingMetadata(base).twitter).toMatchObject({
      card: "summary_large_image",
    });
  });

  it("points openGraph at the canonical url, not at a relative path", () => {
    expect(marketingMetadata(base).openGraph).toMatchObject({
      url: "https://example.com/learn/a-subject",
      title: base.title,
      description: base.description,
    });
  });

  it("indexes by default and noindexes on request, following either way", () => {
    expect(marketingMetadata(base).robots).toBeUndefined();
    expect(marketingMetadata({ ...base, indexable: false }).robots).toEqual({
      index: false,
      follow: true,
    });
  });

  it("lets a page write a different sentence for a feed than for a result", () => {
    const meta = marketingMetadata({
      ...base,
      social: { title: "Feed title", description: "Feed description" },
    });

    expect(meta.title).toBe(base.title);
    expect(meta.description).toBe(base.description);
    expect(meta.openGraph).toMatchObject({
      title: "Feed title",
      description: "Feed description",
    });
    expect(meta.twitter).toMatchObject({
      title: "Feed title",
      description: "Feed description",
    });
  });

  it("keeps the social copy in step with the page when nothing overrides it", () => {
    const meta = marketingMetadata(base);
    expect(meta.openGraph).toMatchObject({ title: base.title });
    expect(meta.twitter).toMatchObject({ description: base.description });
  });
});
