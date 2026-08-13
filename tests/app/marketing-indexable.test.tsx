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
    quality: { ...pack.quality, status: "reviewed", reviewedBy: "a-human" },
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
  it("is submitted for indexing, topic page and projects alike", () => {
    expect(packPages().map((e) => e.url)).toEqual([
      "https://example.com/learn/valid-minimal",
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

  it("says 'question' not 'questions' when the bank holds one", async () => {
    render(
      await check.default({
        params: params({ topic: "valid-minimal", skill: "beta" }),
      }),
    );
    expect(screen.getByText(/1 question for this skill so far/)).toBeDefined();
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
