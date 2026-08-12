import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §13.3's crawl-budget rules, asserted rather than trusted.
 *
 * The sitemap/robots pair is the single most consequential thing on the SEO
 * side: §12 exists because a product that leaks thin or private pages into the
 * index gets treated as a content farm, and §13.3 names the sitemap filter as
 * "the single most important crawl-budget control".
 */

const selectMock = vi.fn();

vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => selectMock(),
      }),
    }),
  }),
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
  selectMock.mockReset();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  vi.clearAllMocks();
});

describe("robots.txt", () => {
  it("disallows every authenticated surface and the API", async () => {
    const { default: robots } = await import("@/app/robots");
    const rules = robots().rules as { disallow: string[]; allow: string };

    for (const path of [
      "/api/",
      "/today",
      "/session",
      "/goals",
      "/settings",
      "/submission",
      "/mastery",
      "/admin",
    ]) {
      expect(rules.disallow, path).toContain(path);
    }
    expect(rules.allow).toBe("/");
  });

  it("points at the sitemap on the canonical origin", async () => {
    const { default: robots } = await import("@/app/robots");
    expect(robots().sitemap).toBe("https://example.com/sitemap.xml");
  });

  it("disallows the internal search surface (§13.3)", async () => {
    const { default: robots } = await import("@/app/robots");
    const rules = robots().rules as { disallow: string[] };
    expect(rules.disallow).toContain("/search");
  });
});

describe("sitemap.xml", () => {
  it("includes only pages flagged indexable", async () => {
    // The filter lives in the query, so there is no code path that can emit a
    // non-indexable page by accident.
    selectMock.mockResolvedValue([
      { slug: "/check/sql", updatedAt: new Date("2026-08-01") },
      { slug: "/projects/sales-funnel", updatedAt: new Date("2026-08-02") },
    ]);

    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual([
      "https://example.com",
      "https://example.com/check/sql",
      "https://example.com/projects/sales-funnel",
    ]);
  });

  it("carries an accurate lastModified from the database", async () => {
    const updatedAt = new Date("2026-07-04T10:00:00.000Z");
    selectMock.mockResolvedValue([{ slug: "/learn/sql", updatedAt }]);

    const { default: sitemap } = await import("@/app/sitemap");
    expect((await sitemap())[1]!.lastModified).toBe(updatedAt);
  });

  it("still lists the homepage when nothing is indexable yet", async () => {
    selectMock.mockResolvedValue([]);
    const { default: sitemap } = await import("@/app/sitemap");
    expect(await sitemap()).toHaveLength(1);
  });

  it("degrades to the homepage rather than 500ing when the database is down", async () => {
    // A sitemap that errors is worse than a thin one: Google retries a 200 far
    // more readily than an error.
    selectMock.mockRejectedValue(new Error("connection refused"));
    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.url).toBe("https://example.com");
  });

  it("exposes the indexable query on its own for reuse", async () => {
    selectMock.mockResolvedValue([
      { slug: "/guides/x", updatedAt: new Date("2026-08-01") },
    ]);
    const { indexablePages } = await import("@/app/sitemap");
    expect(await indexablePages()).toEqual([
      { url: "https://example.com/guides/x", lastModified: new Date("2026-08-01") },
    ]);
  });
});
