// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { join } from "node:path";
import { loadPack } from "@/lib/packs/loader";
import { encode } from "@/lib/check/session";
import type { DomainPack, PackItem } from "@/lib/packs/types";

/**
 * The state the deep check exists to be able to reach: a skill actually
 * cleared.
 *
 * It needs a pack no subject in the catalogue currently has. Clearing
 * `MASTERY_TARGET` takes three to five observations on one skill; today's banks
 * carry **one or two usable questions per skill**, so every real deep check
 * runs out of questions before it can settle anything and honestly says so.
 * That gap is the 229 items the catalogue is short, not a bug in this page —
 * and it is exactly why the page must be able to say the *other* thing when the
 * bank is there.
 *
 * So the fixture is what a properly stocked skill looks like: five closed
 * questions on one skill, all answered correctly.
 */

const STOCKED = "alpha";

const stocked = (): DomainPack => {
  const pack = loadPack(join("tests/fixtures/packs", "valid-minimal"));
  const template = pack.items.find((i) => i.type === "mcq")!;

  const items: PackItem[] = Array.from({ length: 5 }, (_, n) => ({
    ...template,
    slug: `alpha-mcq-${n}`,
    skill: STOCKED,
  }));

  return {
    ...pack,
    maturity: "curated",
    quality: { ...pack.quality, status: "reviewed", reviewedBy: "a-human" },
    items,
  };
};

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
    set: (name: string, value: string) => jar.set(name, value),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/packs/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/packs/loader")>();
  return { ...actual, loadAllPacks: () => [stocked()] };
});

const { resetContentCache, findPack } = await import("@/lib/content");
const { cookieFor, narrow } = await import("@/lib/check/run");
const page = await import("@/app/(marketing)/check/[topic]/[skill]/page");

const REF = { topic: "valid-minimal", skill: STOCKED };
const params = () => Promise.resolve(REF);

beforeEach(() => {
  jar.clear();
  resetContentCache();
});

afterEach(() => {
  cleanup();
  resetContentCache();
});

describe("a skill with enough questions behind it", () => {
  it("offers the full five, which is what `settled` stops at", async () => {
    render(await page.default({ params: params() }));
    expect(screen.getByText(/Up to 5 questions/)).toBeDefined();
  });

  it("says the bar was cleared, and on how many marked answers", async () => {
    const items = narrow(findPack(REF.topic)!, REF).items;
    jar.set(
      cookieFor(REF),
      encode({ s: 1, a: items.map((i) => ({ i: i.slug, c: 1 as const })) }),
    );

    render(await page.default({ params: params() }));

    expect(screen.getByText("Likely known")).toBeDefined();
    expect(screen.getByText(/You cleared the bar on this one/)).toBeDefined();
    expect(screen.getByText(/5 marked answers/)).toBeDefined();
    // And still not a claim about the work itself (§4.2 law 1).
    expect(
      screen.getByText(/still not the same as doing the work/),
    ).toBeDefined();
  });

  /**
   * The concentration rule, end to end: the check stops as soon as the belief
   * clears the bar rather than spending its remaining questions confirming what
   * it already knows.
   */
  it("stops early once the answer is clear", async () => {
    const items = narrow(findPack(REF.topic)!, REF).items;
    jar.set(
      cookieFor(REF),
      encode({ s: 1, a: items.slice(0, 3).map((i) => ({ i: i.slug, c: 1 as const })) }),
    );

    render(await page.default({ params: params() }));

    // Three of the five answered, and it is over: two questions that could not
    // have changed the answer were never asked.
    expect(screen.getByText(/You cleared the bar on this one/)).toBeDefined();
    expect(screen.queryByText(/Question 4 of 5/)).toBeNull();
  });
});
