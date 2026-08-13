// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { findPack } from "@/lib/content";
import type { LedgerEntry, Standing } from "@/lib/mastery/ledger";
import type { ClaimGroup, LedgerView } from "@/lib/mastery/view";
import type { LearnerStanding } from "@/lib/goals/standing";

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
const standingForMock = vi.fn();

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
// What the learner has on when there is nothing proved yet. A database read,
// stubbed here and tested in tests/goals/standing.test.ts.
vi.mock("@/lib/goals/standing", () => ({
  standingFor: (...args: unknown[]) => standingForMock(...(args as [])),
}));

const { default: MasteryPage } = await import("@/app/(app)/mastery/page");

const NOTHING_ON: LearnerStanding = {
  building: undefined,
  resume: undefined,
  again: [],
};

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

const ACTIVE: NonNullable<LedgerView["active"]> = {
  goal: {
    id: "g1",
    packSlug: pack.slug,
    spec: {} as NonNullable<LedgerView["active"]>["goal"]["spec"],
    createdAt: new Date("2026-08-13T09:00:00.000Z"),
  },
  pack,
};

const group = (
  overrides: Partial<ClaimGroup> = {},
): ClaimGroup => ({
  packSlug: pack.slug,
  packName: pack.name,
  status: "active",
  entries: [entry("shown")],
  ...overrides,
});

function view(overrides: Partial<LedgerView> = {}): LedgerView {
  const claims = overrides.claims ?? [group()];
  return {
    active: ACTIVE,
    claims,
    provedCount: claims.reduce((n, g) => n + g.entries.length, 0),
    whatsLeft: [entry("untouched")],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(SIGNED_IN);
  standingForMock.mockResolvedValue(NOTHING_ON);
});

afterEach(cleanup);

describe("before there is anything to show", () => {
  it("redirects an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(MasteryPage({ searchParams: search() })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("says what this screen will hold rather than only what is missing", async () => {
    ledgerForMock.mockResolvedValue(undefined);
    render(await MasteryPage({ searchParams: search() }));

    expect(screen.getByText(/linked to the work that proved it/i)).toBeDefined();
    expect(screen.getByText("Pick a subject")).toBeDefined();
  });

  /**
   * Nothing proved is not the same as nothing started, and this screen used to
   * say the second when it only knew the first.
   */
  it("names what they have already started", async () => {
    ledgerForMock.mockResolvedValue(undefined);
    standingForMock.mockResolvedValue({
      ...NOTHING_ON,
      resume: { subject: "Kite surfing", turns: 6, ofTurns: 6, ready: true },
      again: [
        {
          goalId: "g-old",
          name: "Photography",
          taxonomyParent: "creative",
          status: "paused" as const,
        },
      ],
    });
    render(await MasteryPage({ searchParams: search() }));

    expect(screen.getByText("Your course is ready to build")).toBeDefined();
    expect(screen.getByRole("link", { name: "Build it" })).toBeDefined();
    expect(screen.getByText("Pick one back up")).toBeDefined();
  });

  /**
   * `ledgerFor` returns nothing in two cases — no goal, and a goal whose pack
   * has gone — and the copy used to assert the first one in both. A learner
   * with a goal being told they never set one is a lie the screen can avoid by
   * describing the state it is actually in.
   */
  it("does not claim the learner has no goal, which it cannot know", async () => {
    ledgerForMock.mockResolvedValue(undefined);
    render(await MasteryPage({ searchParams: search() }));

    expect(screen.queryByText(/don't have a goal yet/i)).toBeNull();
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
    ledgerForMock.mockResolvedValue(view({ claims: [group({ entries: [entry("fading")] })] }));
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
    ledgerForMock.mockResolvedValue(view({ claims: [] }));
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

/**
 * §1 calls the ledger "an evidence-backed, per-skill record of what you have
 * demonstrably done". It belongs to the learner rather than to whichever course
 * is running — it used to disappear the moment one was paused, which made the
 * product's stated competitive advantage the most perishable thing in it.
 */
describe("between courses", () => {
  const between = (claims: ClaimGroup[]) =>
    view({ active: undefined, claims, whatsLeft: [] });

  it("still shows what the learner proved", async () => {
    ledgerForMock.mockResolvedValue(
      between([group({ status: "paused" })]),
    );
    render(await MasteryPage({ searchParams: search() }));

    expect(
      screen.getByText("Expose a backlit portrait without losing the highlights"),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "See the work" })).toBeDefined();
  });

  it("says the record is theirs whether or not a course is running", async () => {
    ledgerForMock.mockResolvedValue(between([group({ status: "achieved" })]));
    render(await MasteryPage({ searchParams: search() }));

    expect(screen.getByText(/stays yours whether or not/i)).toBeDefined();
  });

  /** "To go" is a statement about a path, and they are not on one. */
  it("quotes no remainder", async () => {
    ledgerForMock.mockResolvedValue(between([group({ status: "paused" })]));
    render(await MasteryPage({ searchParams: search() }));

    expect(screen.getByText(/across everything you have studied/i)).toBeDefined();
    expect(screen.queryByText(/to go/i)).toBeNull();
  });

  /**
   * Merged across subjects, "what's left" would list everything the learner
   * had not proved in every subject they had ever touched and call it their
   * remaining work.
   */
  it("has no what's-left to show, and says why", async () => {
    ledgerForMock.mockResolvedValue(between([group({ status: "paused" })]));
    render(await MasteryPage({ searchParams: search({ show: "left" }) }));

    expect(screen.getByText(/no path to have anything left on/i)).toBeDefined();
    expect(screen.getByText("Pick a subject")).toBeDefined();
  });
});

describe("more than one subject", () => {
  const two = [
    group({ packSlug: "photography", packName: "Photography", status: "paused" }),
    group({
      packSlug: "sql-data-analysis",
      packName: "SQL & Data Analysis",
      status: "achieved",
      entries: [entry("shown", { skillSlug: "joins", name: "Joins" })],
    }),
  ];

  it("names each subject and how its course stands", async () => {
    ledgerForMock.mockResolvedValue(view({ claims: two, provedCount: 2 }));
    render(await MasteryPage({ searchParams: search() }));

    expect(screen.getByText("Photography")).toBeDefined();
    expect(screen.getByText("SQL & Data Analysis")).toBeDefined();
    expect(screen.getByText("Paused")).toBeDefined();
    expect(screen.getByText("Finished")).toBeDefined();
  });

  it("counts every claim, not just the running course's", async () => {
    ledgerForMock.mockResolvedValue(view({ claims: two, provedCount: 2 }));
    render(await MasteryPage({ searchParams: search() }));

    expect(screen.getByText("2")).toBeDefined();
  });

  /**
   * With one course — every learner before a course could end, and most of them
   * after — a band heading would name something the page has already named
   * twice. §8.5.1's density rule counts it either way.
   */
  it("adds no heading when there is only one subject", async () => {
    ledgerForMock.mockResolvedValue(view());
    render(await MasteryPage({ searchParams: search() }));

    expect(screen.queryByText(pack.name)).toBeNull();
  });
});
