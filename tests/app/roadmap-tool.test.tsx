// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { allTopics, findPack } from "@/lib/content";
import { buildRoadmap, ROADMAP_TOOL_PATH } from "@/lib/roadmap/plan";

/**
 * §10 E / §19.1 — the free Roadmap Generator.
 *
 * Two things are worth asserting on this page and neither is the layout: that
 * it is honest about what it knows (§4.2 laws 1 and 5), and that it cannot
 * become the combinatorial-content surface §12 and §17 both rule out. Everything
 * else is arithmetic and is tested in `tests/lib/roadmap.test.ts`.
 */

const tool = await import(
  "@/app/(marketing)/tools/learning-roadmap-generator/page"
);

const params = <T,>(value: T) => Promise.resolve(value);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The subject the bare URL plans: the deepest one that has been reviewed. */
const DEFAULT_SLUG = "sql-data-analysis";

describe("/tools/learning-roadmap-generator", () => {
  it("plans a real subject before anyone has chosen one", async () => {
    render(await tool.default({ searchParams: params({}) }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Plan any subject, week by week",
    );
    // Not an empty form waiting to be filled in: §11 item 2 wants the tool
    // above the fold *working*, and the page that gets indexed is this one.
    expect(screen.getByText(/weeks at 4 hours a week/)).toBeDefined();
    expect(screen.getByText("Week 1")).toBeDefined();
  });

  it("offers every subject and preselects the one it planned", async () => {
    const { container } = render(await tool.default({ searchParams: params({}) }));
    const radios = [
      ...container.querySelectorAll<HTMLInputElement>('input[name="subject"]'),
    ];

    expect(radios.map((r) => r.value).sort()).toEqual(
      allTopics().map((t) => t.slug).sort(),
    );
    expect(radios.filter((r) => r.defaultChecked).map((r) => r.value)).toEqual([
      DEFAULT_SLUG,
    ]);
  });

  it("answers on a GET form, so the plan is a URL", async () => {
    // Which is what keeps §8.5.8's "marketing routes ship zero
    // component-library JS" true on the one marketing page that takes input —
    // and what makes a plan survive a refresh, a bookmark and a paste.
    const { container } = render(await tool.default({ searchParams: params({}) }));
    const form = container.querySelector("form")!;

    expect(form.getAttribute("method")).toBe("get");
    expect(container.querySelector("script[src]")).toBeNull();
  });

  it("plans whatever subject and pace the URL asks for", async () => {
    render(
      await tool.default({
        searchParams: params({ subject: "photography", hours: "1.5" }),
      }),
    );

    const roadmap = buildRoadmap({
      pack: findPack("photography")!,
      mastery: [],
      weeklyHours: 1.5,
      now: new Date().toISOString(),
    })!;

    expect(
      screen.getByText(`${roadmap.weeks} weeks at 1.5 hours a week`),
    ).toBeDefined();
    expect(screen.getByText(String(roadmap.totalHours))).toBeDefined();
  });

  it("plans anyway when the URL names a subject that does not exist", async () => {
    // A stranger can edit this URL. A tool's failure mode is "here is a plan",
    // never a validation message or a 404.
    render(
      await tool.default({
        searchParams: params({ subject: "underwater-basket-weaving" }),
      }),
    );
    expect(screen.getByText(/weeks at 4 hours a week/)).toBeDefined();
  });

  /**
   * §13.3's faceted-nav rule — "the #1 index-bloat source" — which here is also
   * §17's "DON'T BUILD: timeframe/duration combinatorial SEO pages". Seven
   * subjects at forty paces is 280 pages that differ by a number.
   */
  it("is indexable bare and noindex for every view of it", async () => {
    const bare = await tool.generateMetadata({ searchParams: params({}) });
    expect(bare.robots).toBeUndefined();
    expect(bare.alternates?.canonical).toContain(ROADMAP_TOOL_PATH);
    // §13.3 — title ≤60 characters, description 140–160.
    expect(String(bare.title).length).toBeLessThanOrEqual(60);
    expect(String(bare.description).length).toBeGreaterThanOrEqual(140);
    expect(String(bare.description).length).toBeLessThanOrEqual(160);

    for (const view of [
      { subject: "photography" },
      { hours: "2" },
      { subject: "photography", hours: "2" },
    ]) {
      const meta = await tool.generateMetadata({ searchParams: params(view) });
      expect(meta.robots, JSON.stringify(view)).toEqual({
        index: false,
        follow: true,
      });
      // Every one of them canonicals to the tool itself.
      expect(meta.alternates?.canonical).toBe(bare.alternates?.canonical);
    }
  });

  /**
   * §4.2 law 1, on the page with the most to gain from breaking it.
   *
   * Every competing roadmap tool asks for a level and shortens the plan on the
   * answer. This one has no level field at all, and the copy says why.
   */
  it("asks for no self-assessment, and says the check is what changes it", async () => {
    const { container } = render(await tool.default({ searchParams: params({}) }));

    const names = [
      ...container.querySelectorAll<HTMLInputElement>("input"),
    ].map((i) => i.name);
    expect(names).not.toContain("level");
    expect(names).not.toContain("statedLevel");
    expect(new Set(names)).toEqual(new Set(["subject", "hours"]));

    expect(screen.getByText(/no box here for how good you already are/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: /Check where you stand/ }).getAttribute("href"),
    ).toBe(`/check/${DEFAULT_SLUG}`);
  });

  /**
   * The measured reason the page says what it says.
   *
   * The first cut built this plan on the anonymous check cookie so a visitor's
   * answers would drop skills out of it. They cannot: `projectSkills` excludes
   * at `MASTERY_TARGET`, the BKT needs three correct observations on one skill
   * to get there, and a nine-question check across a 26-skill subject never
   * gives any skill three — a perfect check tops out around 0.6. So the page
   * reads no cookie and claims nothing about the visitor, and this asserts the
   * claim it makes instead.
   */
  it("promises no personalisation it cannot deliver", async () => {
    render(await tool.default({ searchParams: params({}) }));

    expect(
      screen.getByText("This is the same plan we would give anyone"),
    ).toBeDefined();
    expect(screen.getByText(/only thing that takes work out of it/)).toBeDefined();
  });

  it("links every marked week to the checklist it is marked against", async () => {
    const { container } = render(await tool.default({ searchParams: params({}) }));
    const roadmap = buildRoadmap({
      pack: findPack(DEFAULT_SLUG)!,
      mastery: [],
      weeklyHours: 4,
      now: new Date().toISOString(),
    })!;

    const briefs = new Set(
      [...container.querySelectorAll("a[href^='/projects/']")].map((a) =>
        a.getAttribute("href"),
      ),
    );
    for (const entry of roadmap.entries.filter((e) => e.graded)) {
      expect(briefs, entry.title).toContain(`/projects/${entry.brief}`);
    }
    expect(screen.getAllByText("Marked").length).toBeGreaterThan(0);
  });

  it("carries the WebApplication markup §13.3 asks a tool page for", async () => {
    const { container } = render(await tool.default({ searchParams: params({}) }));
    const blocks = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')!.innerHTML,
    ) as Array<Record<string, unknown>>;

    const app = blocks.find((b) => b["@type"] === "WebApplication")!;
    expect(app.isAccessibleForFree).toBe(true);
    expect(app.offers).toMatchObject({ price: 0 });
    expect(blocks.some((b) => b["@type"] === "BreadcrumbList")).toBe(true);
  });
});
