// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { findPack } from "@/lib/content";
import type { LedgerEntry, Standing } from "@/lib/mastery/ledger";
import type { LedgerView } from "@/lib/mastery/view";

/**
 * §8 screen 10 — the mastery map.
 *
 * `ledgerFor` is stubbed: what it computes is tested against a real database in
 * tests/mastery/store.test.ts and against the pure builder in
 * tests/mastery/ledger.test.ts. What matters here is that the screen makes a
 * claim only where there is a hand-in to open, and that it never quietly grows
 * a percentage.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const ledgerForMock = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/mastery/view", () => ({
  ledgerFor: (...args: unknown[]) => ledgerForMock(...(args as [])),
}));

const { default: MasteryPage } = await import("@/app/(app)/mastery/page");

const SIGNED_IN = { user: { id: "u1", email: "a@b.co" } };
const search = (params: { show?: string } = {}) => Promise.resolve(params);
const pack = findPack("photography")!;

const entry = (
  standing: Standing,
  overrides: Partial<LedgerEntry> = {},
): LedgerEntry => ({
  skillSlug: `skill-${standing}`,
  name: `Skill ${standing}`,
  statement: "Expose a backlit portrait without losing the highlights",
  standing,
  submissionId: standing === "untouched" ? null : "sub-7",
  artefacts: 1,
  confidence: 0.9,
  shownDaysAgo: 2,
  note: `note for ${standing}`,
  ...overrides,
});

function view(overrides: Partial<LedgerView["ledger"]> = {}): LedgerView {
  return {
    goal: {
      id: "g1",
      packSlug: pack.slug,
      spec: {} as LedgerView["goal"]["spec"],
      createdAt: new Date("2026-08-13T09:00:00.000Z"),
    },
    pack,
    ledger: {
      canDo: [entry("shown")],
      whatsLeft: [entry("untouched")],
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(SIGNED_IN);
});

afterEach(cleanup);

describe("before there is anything to show", () => {
  it("redirects an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(MasteryPage({ searchParams: search() })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("offers to set a goal rather than showing an empty ledger", async () => {
    ledgerForMock.mockResolvedValue(undefined);
    render(await MasteryPage({ searchParams: search() }));

    expect(screen.getByText(/don't have a goal yet/i)).toBeDefined();
    expect(screen.getByText("Set a goal")).toBeDefined();
  });

  it("is noindexed in its own right as well as by the layout", async () => {
    const { metadata } = await import("@/app/(app)/mastery/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("what I can do", () => {
  it("leads with the capability statement, not the skill name", async () => {
    ledgerForMock.mockResolvedValue(view());
    render(await MasteryPage({ searchParams: search() }));

    expect(
      screen.getByText(
        "Expose a backlit portrait without losing the highlights",
      ),
    ).toBeDefined();
  });

  it("links every claim to the work that proves it (§24 E9)", async () => {
    ledgerForMock.mockResolvedValue(view());
    render(await MasteryPage({ searchParams: search() }));

    const link = screen.getByRole("link", { name: "See the work" });
    expect(link.getAttribute("href")).toBe("/submission/sub-7");
  });

  it("shows what the claim is worth beside it (§7.2)", async () => {
    ledgerForMock.mockResolvedValue(view());
    render(await MasteryPage({ searchParams: search() }));

    // The meter, never a number.
    expect(screen.getByRole("img", { name: "Demonstrated" })).toBeDefined();
    expect(screen.getByText("note for shown")).toBeDefined();
  });

  it("says when a claim is on its way out", async () => {
    ledgerForMock.mockResolvedValue(view({ canDo: [entry("fading")] }));
    render(await MasteryPage({ searchParams: search() }));

    expect(screen.getByText("Slipping")).toBeDefined();
  });

  it("does not label a fresh claim as slipping", async () => {
    ledgerForMock.mockResolvedValue(view());
    render(await MasteryPage({ searchParams: search() }));
    expect(screen.queryByText("Slipping")).toBeNull();
  });

  it("explains the rule before a learner wonders why something is missing", async () => {
    ledgerForMock.mockResolvedValue(view());
    render(await MasteryPage({ searchParams: search() }));

    // §4.2 law 1, said out loud.
    expect(screen.getByText(/backed by work you handed in/i)).toBeDefined();
  });

  it("shows no percentage anywhere (§24 E9)", async () => {
    // A product rule, not a style preference: it is the difference between
    // measuring evidence and measuring consumption.
    ledgerForMock.mockResolvedValue(view());
    const { container } = render(await MasteryPage({ searchParams: search() }));

    expect(container.textContent).not.toMatch(/\d%|percent/i);
  });

  it("sends a learner with nothing proved back to today", async () => {
    ledgerForMock.mockResolvedValue(view({ canDo: [] }));
    render(await MasteryPage({ searchParams: search() }));

    expect(screen.getByText(/Hand in the work at the end of a session/)).toBeDefined();
    expect(screen.getByText("Go to today")).toBeDefined();
  });
});

describe("what's left", () => {
  it("switches lists on the query string, with no client JavaScript", async () => {
    ledgerForMock.mockResolvedValue(view());
    render(await MasteryPage({ searchParams: search({ show: "left" }) }));

    expect(screen.getByText("note for untouched")).toBeDefined();
    expect(screen.queryByText("note for shown")).toBeNull();
  });

  it("makes no claim about a skill with nothing behind it", async () => {
    ledgerForMock.mockResolvedValue(view());
    render(await MasteryPage({ searchParams: search({ show: "left" }) }));

    expect(screen.queryByRole("img", { name: "Demonstrated" })).toBeNull();
    expect(screen.queryByRole("link", { name: "See the work" })).toBeNull();
  });

  it("keeps the evidence for a lapsed claim while dropping the verdict", async () => {
    // The work did not stop existing. The claim did.
    ledgerForMock.mockResolvedValue(view({ whatsLeft: [entry("faded")] }));
    render(await MasteryPage({ searchParams: search({ show: "left" }) }));

    expect(screen.getByRole("link", { name: "See the work" })).toBeDefined();
    expect(screen.getByText("Slipping")).toBeDefined();
    expect(screen.queryByRole("img", { name: "Demonstrated" })).toBeNull();
  });

  it("marks the tab a learner is on", async () => {
    ledgerForMock.mockResolvedValue(view());
    render(await MasteryPage({ searchParams: search({ show: "left" }) }));

    expect(
      screen.getByRole("link", { name: "What's left" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "What I can do" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("ignores a query string it does not recognise", async () => {
    ledgerForMock.mockResolvedValue(view());
    render(await MasteryPage({ searchParams: search({ show: "nonsense" }) }));

    expect(screen.getByText("note for shown")).toBeDefined();
  });

  it("says so when there is nothing left on the path", async () => {
    ledgerForMock.mockResolvedValue(view({ whatsLeft: [] }));
    render(await MasteryPage({ searchParams: search({ show: "left" }) }));

    expect(screen.getByText(/every skill in it is yours/)).toBeDefined();
  });
});
