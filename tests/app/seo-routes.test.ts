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
  it("lists the hubs plus any authored indexable page", async () => {
    // The filter lives in the query, so there is no code path that can emit a
    // non-indexable authored page by accident.
    selectMock.mockResolvedValue([
      { slug: "/guides/wrong-grain", updatedAt: new Date("2026-08-02") },
    ]);

    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual([
      "https://example.com",
      "https://example.com/learn",
      "https://example.com/projects",
      "https://example.com/guides/wrong-grain",
    ]);
  });

  it("omits pack pages while the pack is unreviewed (§12.1)", async () => {
    // The SQL pack is Curated but not human-reviewed, so its topic and project
    // pages are served and deliberately not submitted for indexing.
    selectMock.mockResolvedValue([]);
    const { packPages } = await import("@/app/sitemap");
    expect(packPages()).toEqual([]);
  });

  it("never lists a /check page — the tool behind it does not exist", async () => {
    selectMock.mockResolvedValue([]);
    const { default: sitemap } = await import("@/app/sitemap");
    expect((await sitemap()).some((e) => e.url.includes("/check/"))).toBe(false);
  });

  it("carries an accurate lastModified from the database", async () => {
    const updatedAt = new Date("2026-07-04T10:00:00.000Z");
    selectMock.mockResolvedValue([{ slug: "/guides/x", updatedAt }]);

    const { default: sitemap } = await import("@/app/sitemap");
    const entry = (await sitemap()).find((e) => e.url.endsWith("/guides/x"))!;
    expect(entry.lastModified).toBe(updatedAt);
  });

  it("still lists the hub pages when nothing else is indexable yet", async () => {
    selectMock.mockResolvedValue([]);
    const { default: sitemap } = await import("@/app/sitemap");
    expect((await sitemap()).map((e) => e.url)).toEqual([
      "https://example.com",
      "https://example.com/learn",
      "https://example.com/projects",
    ]);
  });

  it("degrades to the static pages rather than 500ing when the database is down", async () => {
    // A sitemap that errors is worse than a partial one: Google retries a 200
    // far more readily than an error.
    selectMock.mockRejectedValue(new Error("connection refused"));
    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();
    expect(entries).toHaveLength(3);
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
