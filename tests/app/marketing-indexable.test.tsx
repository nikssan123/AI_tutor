// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { join } from "node:path";
import { loadPack } from "@/lib/packs/loader";
import type { DomainPack } from "@/lib/packs/types";

/**
 * The indexable half of the marketing surface.
 *
 * Every pack in the repository ships `quality.reviewedBy: unreviewed`, so the
 * §12.1 gate holds every real page at `noindex, follow` — which means the
 * *other* side of that gate is never exercised by the real content. This file
 * supplies a reviewed pack so the path a launch actually takes is tested
 * before launch rather than discovered during one.
 *
 * It also covers the small-pack shapes the real packs never produce: a skill
 * with a single item, a leaf skill with nothing downstream, and a brief short
 * enough not to be truncated.
 */

const reviewed = (): DomainPack => {
  const pack = loadPack(join("tests/fixtures/packs", "valid-minimal"));
  return {
    ...pack,
    maturity: "curated",
    quality: {
      ...pack.quality,
      status: "reviewed",
      reviewedBy: "a-human",
      reviewKind: "human",
    },
    // A brief is only indexable when it is public *and* its topic is; the
    // fixture ships private, so opening the topic gate alone is not enough.
    projects: pack.projects.map((p) => ({ ...p, isPublic: true })),
    // Give `beta` exactly one item so the singular/plural branch is real.
    items: [
      ...pack.items.filter((i) => i.skill === "alpha"),
      pack.items.find((i) => i.skill === "beta")!,
    ],
  };
};

/*
 * `/check/{topic}/{skill}` runs a check off a cookie now, so it reads the jar
 * even to render its description — an empty one is the state a crawler arrives
 * in, which is the state this file asserts about.
 */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

vi.mock("@/lib/packs/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/packs/loader")>();
  return { ...actual, loadAllPacks: () => [reviewed()] };
});

const { resetContentCache } = await import("@/lib/content");
const topic = await import("@/app/(marketing)/learn/[topic]/page");
const projects = await import("@/app/(marketing)/projects/page");
const project = await import("@/app/(marketing)/projects/[slug]/page");
const check = await import("@/app/(marketing)/check/[topic]/[skill]/page");
const { packPages } = await import("@/app/sitemap");

const params = <T,>(value: T) => Promise.resolve(value);

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
  resetContentCache();
});

afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("a reviewed pack (§12.1 gate open)", () => {
  it("is submitted for indexing — topic, both checks, and projects alike", () => {
    // Each check joined this list when the assessment behind it shipped: the
    // subject check with E4, the per-skill ones when a check for one skill was
    // built. A Curated pack clears both gates, so all five are here — the
    // ordering puts the check first because that gate is now the wider one.
    expect(packPages().map((e) => e.url)).toEqual([
      "https://example.com/check/valid-minimal",
      "https://example.com/learn/valid-minimal",
      "https://example.com/check/valid-minimal/alpha",
      "https://example.com/check/valid-minimal/beta",
      "https://example.com/projects/minimal-project",
    ]);
  });

  it("drops the noindex robots directive from the topic page", async () => {
    const meta = await topic.generateMetadata({
      params: params({ topic: "valid-minimal" }),
    });
    // `undefined` means "no directive", which is how a page becomes indexable —
    // there is deliberately no `index: true` anywhere in the codebase.
    expect(meta.robots).toBeUndefined();
  });

  it("emits Course markup only once a real curriculum is reviewed (§13.3)", async () => {
    const { container } = render(
      await topic.default({ params: params({ topic: "valid-minimal" }) }),
    );
    const ld = [...container.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => JSON.parse(s.textContent!))
      .flat();
    expect(ld.some((b) => b["@type"] === "Course")).toBe(true);
  });

  it("stops explaining why it is not indexed, because now it is", async () => {
    render(await topic.default({ params: params({ topic: "valid-minimal" }) }));
    expect(screen.queryByText(/not been through human review/)).toBeNull();
  });

  it("opens the gate on the subject's check, which now runs", async () => {
    const run = await import("@/app/(marketing)/check/[topic]/page");
    const meta = await run.generateMetadata({
      params: params({ topic: "valid-minimal" }),
    });
    expect(meta.robots).toBeUndefined();
  });

  it("drops the noindex from the per-skill check too, now that it runs one", async () => {
    // The two check pages parted company for two epics, on the honest grounds
    // that only one of them had a tool behind it. They are back on one gate.
    const meta = await check.generateMetadata({
      params: params({ topic: "valid-minimal", skill: "alpha" }),
    });
    expect(meta.robots).toBeUndefined();
  });

  it("drops the noindex directive from the project brief", async () => {
    const meta = await project.generateMetadata({
      params: params({ slug: "minimal-project" }),
    });
    expect(meta.robots).toBeUndefined();
  });

  it("still withholds a private brief, reviewed topic or not", async () => {
    const { projectDetails } = await import("@/lib/content");
    const pack = reviewed();
    const [detail] = projectDetails({
      ...pack,
      projects: pack.projects.map((p) => ({ ...p, isPublic: false })),
    });
    expect(detail!.indexable).toBe(false);
  });
});

/**
 * §12.1 for a Standard pack — model-authored, and read by somebody.
 *
 * The gate used to ask one question for both page types, and the two are not the
 * same axis: `maturity` is a claim about who held the pen, `reviewKind` a claim
 * about whether anyone read it. `python-fundamentals` is `standard` on purpose
 * and documents why at length, and it also carries 43 hand-worked answer keys
 * and a read against three published curricula. §9.1 makes the check the
 * priority-1 page type and §2.6 calls its SERP the crack in the wall, so holding
 * the tool behind a claim about authorship was costing the one page that matters
 * most for a reason that is not about the page.
 */
describe("a reviewed Standard pack", () => {
  const standard = (): DomainPack => ({ ...reviewed(), maturity: "standard" });

  const onlyStandard = async () => {
    const loader = await import("@/lib/packs/loader");
    vi.spyOn(loader, "loadAllPacks").mockReturnValue([standard()]);
    const { resetContentCache } = await import("@/lib/content");
    resetContentCache();
  };

  it("submits the check and withholds the subject page", async () => {
    await onlyStandard();

    // The check is the working tool §12.1 rule 2 asks every indexable page to
    // carry, and what it does for a visitor does not change with authorship.
    // The subject page is largely the graph rendered, so it keeps the Curated
    // requirement — §9.1 ranks it priority 6 anyway.
    expect(packPages().map((e) => e.url)).toEqual([
      "https://example.com/check/valid-minimal",
    ]);
  });

  it("keeps the per-skill checks out until the thin ones have a number", async () => {
    await onlyStandard();

    // Deliberate asymmetry, and the plan's own rule: §9.1 says publish, measure
    // for 90 days, and scale only the templates that earned impressions. These
    // are the thinnest inventory the site has and none has had an impression.
    expect(packPages().map((e) => e.url)).not.toContain(
      "https://example.com/check/valid-minimal/alpha",
    );
  });

  it("says the same thing in the robots tag as in the sitemap", async () => {
    // The one disagreement that must never happen: a URL submitted for crawling
    // that greets the crawler with `noindex`.
    await onlyStandard();

    const run = await import("@/app/(marketing)/check/[topic]/page");
    expect(
      (await run.generateMetadata({ params: params({ topic: "valid-minimal" }) }))
        .robots,
    ).toBeUndefined();

    expect(
      (await topic.generateMetadata({ params: params({ topic: "valid-minimal" }) }))
        .robots,
    ).toEqual({ index: false, follow: true });
  });

  it("still submits nothing at all for a pack nobody has read", async () => {
    const loader = await import("@/lib/packs/loader");
    vi.spyOn(loader, "loadAllPacks").mockReturnValue([
      { ...standard(), quality: { ...standard().quality, reviewKind: null } },
    ]);
    const { resetContentCache } = await import("@/lib/content");
    resetContentCache();

    // Which is also how a Generated pack is excluded: `assemble.ts` writes
    // `reviewKind: null` and there is no second condition to keep in step.
    expect(packPages()).toEqual([]);
  });
});

describe("content shapes the real packs never produce", () => {
  /**
   * The landing page showcases a named writing brief because it is legible to
   * anyone. If that pack is ever removed the page must still render, so the
   * helper falls back to the easiest brief available — exercised here, where
   * the only pack loaded does not contain the named one.
   */
  it("falls back to the easiest brief when the featured one is absent", async () => {
    const { featuredProject, allProjects } = await import("@/lib/content");
    expect(allProjects().map((p) => p.slug)).not.toContain("the-slip-message");
    expect(featuredProject().slug).toBe("minimal-project");
  });


  it("leaves a short brief untruncated", () => {
    const { container } = render(projects.default());
    expect(container.textContent).not.toContain("…");
  });

  /**
   * A skill whose only question is a `micro_artifact` — "photograph a scene",
   * "cook a dish" — has a bank a short check cannot draw from. The fixture's
   * `beta` is exactly that, which is how this was found: the page was offering
   * "up to 0 questions" behind a Start button, which is worse than the "not
   * ready yet" apology it replaced.
   */
  it("offers no check for a skill whose questions all ask for work", async () => {
    render(
      await check.default({
        params: params({ topic: "valid-minimal", skill: "beta" }),
      }),
    );

    expect(screen.getByText("This one is proved by doing it")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByText(/Up to 0/)).toBeNull();
  });

  it("says 'question' not 'questions' when the bank holds one", async () => {
    // The singular is reachable and stays reachable: most photography skills
    // carry exactly one usable item, so a one-question deep check is the
    // ordinary case rather than a fixture curiosity.
    render(
      await check.default({
        params: params({ topic: "valid-minimal", skill: "alpha" }),
      }),
    );
    expect(
      screen.getByText((t) => /Up to \d+ questions?\b/.test(t)),
    ).toBeDefined();
  });

  it("omits the unlocks section for a leaf skill", async () => {
    render(
      await check.default({
        params: params({ topic: "valid-minimal", skill: "beta" }),
      }),
    );
    expect(screen.queryByText("What it unlocks")).toBeNull();
  });

  it("shows what a root skill unlocks and claims no prerequisites", async () => {
    render(
      await check.default({
        params: params({ topic: "valid-minimal", skill: "alpha" }),
      }),
    );
    expect(screen.getByText("What it unlocks")).toBeDefined();
    expect(screen.getByText("Beta")).toBeDefined();
  });
});
