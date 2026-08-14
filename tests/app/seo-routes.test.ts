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

/**
 * The ungated pages: the three hubs, the free tool (§10 E), and the two legal
 * pages. §12.1's gate does not apply to the last two — they are not content
 * marketing, they are pages a person may reasonably search for by name.
 */
const HUBS = 6;

describe("sitemap.xml", () => {
  /**
   * These asserted the sitemap's exact contents, which was a way of asserting
   * that no pack had been signed off yet. Signing one off inverted them. What
   * the sitemap owes is structural: the three hubs, every authored indexable
   * row, and pack pages exactly when the pack's own gate is open.
   */
  it("lists the hubs first, then pack pages, then authored rows", async () => {
    selectMock.mockResolvedValue([
      { slug: "/guides/wrong-grain", updatedAt: new Date("2026-08-02") },
    ]);

    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((e) => e.url);

    expect(urls.slice(0, 3)).toEqual([
      "https://example.com",
      "https://example.com/learn",
      "https://example.com/projects",
    ]);
    expect(urls.at(-1)).toBe("https://example.com/guides/wrong-grain");
    expect(new Set(urls).size, "no duplicate URLs").toBe(urls.length);
  });

  it("omits every page of a pack whose gate is shut (§12.1)", async () => {
    // A Curated pack with no recorded reviewer is served and deliberately not
    // submitted for indexing. Asserted per pack rather than as "the list is
    // empty", which only held while nothing had been signed off.
    selectMock.mockResolvedValue([]);
    const { allTopics, allProjects } = await import("@/lib/content");
    const { packPages } = await import("@/app/sitemap");
    const urls = packPages().map((e) => e.url);

    for (const topic of allTopics().filter((t) => !t.indexable)) {
      expect(urls, topic.slug).not.toContain(
        `https://example.com/learn/${topic.slug}`,
      );
    }
    for (const project of allProjects().filter((p) => !p.indexable)) {
      expect(urls, project.slug).not.toContain(
        `https://example.com/projects/${project.slug}`,
      );
    }
  });

  /**
   * §2.6's "crack in the wall", finally competed for.
   *
   * Both check pages were excluded in turn on the grounds that the assessment
   * behind them did not exist — the subject check until E4, the per-skill check
   * until it was built. Each is listed exactly when its pack's own gate is open,
   * and a per-skill URL exists for every skill of an open pack rather than for a
   * chosen few, because each one settles a different skill.
   */
  it("lists a check per skill of an indexable pack, and none of a shut one", async () => {
    selectMock.mockResolvedValue([]);
    const { allTopics, findPack, skillDetails } = await import("@/lib/content");
    const { packPages } = await import("@/app/sitemap");
    const urls = new Set(packPages().map((e) => e.url));

    for (const topic of allTopics()) {
      for (const skill of skillDetails(findPack(topic.slug)!)) {
        expect(
          urls.has(`https://example.com/check/${topic.slug}/${skill.slug}`),
          `${topic.slug}/${skill.slug}`,
        ).toBe(topic.indexable);
      }
    }
  });

  it("lists a subject's check beside the subject, on the same gate", async () => {
    // Both come from `topic.indexable`, so an unreviewed pack's check is no
    // more submittable than its curriculum — which is why this asserts the
    // pairing rather than a literal URL.
    const { allTopics } = await import("@/lib/content");
    const { packPages } = await import("@/app/sitemap");
    const urls = packPages().map((e) => e.url);

    for (const topic of allTopics()) {
      const listed = urls.includes(`https://example.com/learn/${topic.slug}`);
      expect(urls.includes(`https://example.com/check/${topic.slug}`)).toBe(listed);
      expect(listed, topic.slug).toBe(topic.indexable);
    }
  });

  it("carries an accurate lastModified from the database", async () => {
    const updatedAt = new Date("2026-07-04T10:00:00.000Z");
    selectMock.mockResolvedValue([{ slug: "/guides/x", updatedAt }]);

    const { default: sitemap } = await import("@/app/sitemap");
    const entry = (await sitemap()).find((e) => e.url.endsWith("/guides/x"))!;
    expect(entry.lastModified).toBe(updatedAt);
  });

  it("always lists the hubs, whatever else is or is not indexable", async () => {
    // The hubs are the top of the internal link graph and never gated.
    selectMock.mockResolvedValue([]);
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain("https://example.com");
    expect(urls).toContain("https://example.com/learn");
    expect(urls).toContain("https://example.com/projects");
    expect(urls).toContain("https://example.com/tools/learning-roadmap-generator");
  });

  /**
   * §13.3's faceted-nav rule, and §17's "DON'T BUILD: timeframe/duration
   * combinatorial SEO pages", asserted where the temptation actually is.
   *
   * The roadmap tool answers seven subjects at forty paces. Submitting those
   * 280 near-identical URLs is the single fastest way to turn this site into
   * the content farm §12 exists to keep it from being, so the tool is in the
   * sitemap exactly once, with no query on it.
   */
  it("lists the roadmap tool once, and no view of it", async () => {
    selectMock.mockResolvedValue([]);
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((e) => e.url);
    const tool = urls.filter((u) => u.includes("/tools/"));

    expect(tool).toEqual(["https://example.com/tools/learning-roadmap-generator"]);
    for (const url of urls) expect(url, url).not.toContain("?");
  });

  it("degrades to the static pages rather than 500ing when the database is down", async () => {
    // A sitemap that errors is worse than a partial one: Google retries a 200
    // far more readily than an error.
    selectMock.mockRejectedValue(new Error("connection refused"));
    const { packPages } = await import("@/app/sitemap");
    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();

    // The hubs plus whatever the packs contribute — everything that does not
    // need the database. Length rather than a literal, which only held while no
    // pack was signed off.
    expect(entries).toHaveLength(HUBS + packPages().length);
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
