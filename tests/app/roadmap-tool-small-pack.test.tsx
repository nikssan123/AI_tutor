// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { join } from "node:path";
import { loadPack } from "@/lib/packs/loader";
import type { DomainPack } from "@/lib/packs/types";

/**
 * The roadmap tool against the two subject shapes the catalogue never produces.
 *
 * **Nothing to lay out.** `canonicalCurriculum` refuses to call fewer than three
 * modules a curriculum, so `buildRoadmap` returns nothing and the page has to
 * say so. No pack in the catalogue is that small — the smallest is fourteen
 * skills — but nothing in `validatePack` requires a minimum either, so this is a
 * legal pack and a reachable state rather than a hypothetical one.
 *
 * **No specialist tail.** Every real pack declares some, so the branch where the
 * estimate has no upper end to quote is only reachable from a fixture.
 *
 * Its own file because the mock replaces the whole catalogue: the tool's real
 * tests need the real packs.
 */

const fixture = () => loadPack(join("tests/fixtures/packs", "valid-minimal"));

/** Two skill modules and no project module is two, which is under the floor. */
const tiny = (): DomainPack => ({ ...fixture(), slug: "tiny", projects: [] });

vi.mock("@/lib/packs/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/packs/loader")>();
  return { ...actual, loadAllPacks: () => [tiny(), fixture()] };
});

const { resetContentCache } = await import("@/lib/content");
const tool = await import(
  "@/app/(marketing)/tools/learning-roadmap-generator/page"
);

const params = <T,>(value: T) => Promise.resolve(value);

beforeEach(() => {
  resetContentCache();
});

afterEach(() => {
  cleanup();
  resetContentCache();
});

/*
 * `tiny` is what the bare URL plans: neither fixture is reviewed, so
 * `defaultSubject` falls back to the catalogue and sorts on the slug.
 */
describe("/tools/learning-roadmap-generator, on a subject with no plan in it", () => {
  it("says there is nothing to lay out instead of drawing a one-week plan", async () => {
    render(await tool.default({ searchParams: params({}) }));

    expect(screen.getByText("Nothing to lay out")).toBeDefined();
    expect(screen.getByText(/shorter than a plan/)).toBeDefined();
    // And no plan, no estimate, no weeks — the page does not half-render one.
    expect(screen.queryByText(/hours a week$/)).toBeNull();
    expect(screen.queryByText("Week 1")).toBeNull();
  });

  it("still offers the check and the briefs, which are what is left to offer", async () => {
    const { container } = render(await tool.default({ searchParams: params({}) }));
    const hrefs = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );

    expect(hrefs).toContain("/check/tiny");
    expect(hrefs).toContain("/projects");
  });

  /**
   * The form is above the answer, so it survives the answer being empty. A
   * visitor who lands on a subject with nothing in it can still pick another
   * one, which is the difference between an empty state and a dead end.
   */
  it("keeps the tool itself usable", async () => {
    const { container } = render(await tool.default({ searchParams: params({}) }));
    expect(container.querySelector('form[method="get"]')).not.toBeNull();
    expect(
      container.querySelectorAll('input[name="subject"]').length,
    ).toBeGreaterThan(0);
  });
});

describe("an estimate with no specialist tail to quote", () => {
  it("states the assumption without offering a second number", async () => {
    render(
      await tool.default({ searchParams: params({ subject: "valid-minimal" }) }),
    );

    // The range exists only where a pack declares work it deliberately left out
    // of the estimate. With none, quoting one would mean inventing a margin of
    // error nobody measured (§4.2 law 3).
    expect(screen.getByText(/which nobody does/)).toBeDefined();
    expect(screen.queryByText(/specialist skills/)).toBeNull();
  });
});
