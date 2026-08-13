// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { findPack } from "@/lib/content";
import type { Digest } from "@/lib/mastery/digest";
import type { DigestView } from "@/lib/mastery/view";

/**
 * §8 screen 11 — the weekly digest.
 *
 * `digestFor` is stubbed; the arithmetic is tested in tests/mastery/digest.test.ts
 * and against the database in tests/mastery/store.test.ts. What is checked here
 * is the honesty of the sentences built from it — above all the second estimate,
 * which prices the same work at the pace the learner actually kept.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const digestForMock = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/mastery/view", () => ({
  digestFor: (...args: unknown[]) => digestForMock(...(args as [])),
}));

const { default: ProgressPage } = await import("@/app/(app)/progress/page");

const SIGNED_IN = { user: { id: "u1", email: "a@b.co" } };
const pack = findPack("photography")!;

const digest = (overrides: Partial<Digest> = {}): Digest => ({
  hoursLogged: 2,
  committedHours: 3,
  keptCommitment: false,
  sessions: 4,
  moved: [{ name: "Metering", delta: 0.2 }],
  artefacts: 2,
  tracked: 3,
  slipping: 1,
  remainingHours: 30,
  weeksAtCommitment: 10,
  weeksAtActualPace: 15,
  ...overrides,
});

function view(overrides: Partial<Digest> = {}): DigestView {
  return {
    goal: {
      id: "g1",
      packSlug: pack.slug,
      spec: {} as DigestView["goal"]["spec"],
      createdAt: new Date("2026-08-13T09:00:00.000Z"),
    },
    pack,
    ledger: { canDo: [], whatsLeft: [] },
    digest: digest(overrides),
    from: new Date("2026-08-06T12:00:00.000Z"),
    to: new Date("2026-08-13T12:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(SIGNED_IN);
});

afterEach(cleanup);

describe("before there is a week to report on", () => {
  it("redirects an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(ProgressPage()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("offers to set a goal rather than showing an empty digest", async () => {
    digestForMock.mockResolvedValue(undefined);
    render(await ProgressPage());

    expect(screen.getByText(/don't have a goal yet/i)).toBeDefined();
    expect(screen.getByText("Set a goal")).toBeDefined();
  });

  it("is noindexed in its own right as well as by the layout", async () => {
    const { metadata } = await import("@/app/(app)/progress/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("time against the commitment", () => {
  it("says what was done against what was planned", async () => {
    digestForMock.mockResolvedValue(view());
    render(await ProgressPage());

    // The hours are the screen's one figure — the number is set apart from
    // the sentence that qualifies it, so they are asserted apart too.
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("hours")).toBeDefined();
    expect(
      screen.getByText("logged of the 3 hours you set aside, across 4 sessions."),
    ).toBeDefined();
    expect(screen.getByText("Short of what you planned")).toBeDefined();
  });

  it("credits a learner who did what they said they would", async () => {
    digestForMock.mockResolvedValue(
      view({ hoursLogged: 3, keptCommitment: true, sessions: 1 }),
    );
    render(await ProgressPage());

    expect(screen.getByText("You did what you said you would")).toBeDefined();
    expect(screen.getByText(/across 1 session\./)).toBeDefined();
  });

  it("leaves the session clause off a week with none in it", async () => {
    digestForMock.mockResolvedValue(view({ hoursLogged: 1, sessions: 0 }));
    render(await ProgressPage());

    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("hour")).toBeDefined();
    expect(
      screen.getByText("logged of the 3 hours you set aside."),
    ).toBeDefined();
  });
});

describe("what changed", () => {
  it("names the skills that moved", async () => {
    digestForMock.mockResolvedValue(view());
    render(await ProgressPage());

    expect(screen.getByText("Metering")).toBeDefined();
    expect(screen.getByText("2 pieces of work handed in")).toBeDefined();
  });

  it("says why nothing moved rather than showing an empty box", async () => {
    digestForMock.mockResolvedValue(view({ moved: [], artefacts: 0 }));
    render(await ProgressPage());

    expect(screen.getByText(/Mastery only moves on work we can mark/)).toBeDefined();
    expect(screen.getByText("Nothing handed in")).toBeDefined();
  });

  it("counts a single hand-in in the singular", async () => {
    digestForMock.mockResolvedValue(view({ artefacts: 1 }));
    render(await ProgressPage());
    expect(screen.getByText("1 piece of work handed in")).toBeDefined();
  });

  it("never shows a movement as a number", async () => {
    // The delta exists to order the list. Putting 0.2 in front of a learner
    // would be a number with no unit and no meaning.
    digestForMock.mockResolvedValue(view());
    const { container } = render(await ProgressPage());
    expect(container.textContent).not.toMatch(/0\.\d/);
  });
});

describe("holding on to it", () => {
  it("says how much is slipping, and offers to show which", async () => {
    digestForMock.mockResolvedValue(view());
    render(await ProgressPage());

    expect(screen.getByText(/3 skills you have shown/)).toBeDefined();
    expect(screen.getByText(/1 of them is starting to slip/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "See which" }).getAttribute("href"),
    ).toBe("/mastery?show=left");
  });

  it("counts several slipping skills in the plural", async () => {
    digestForMock.mockResolvedValue(view({ tracked: 4, slipping: 2 }));
    render(await ProgressPage());
    expect(screen.getByText(/2 of them are starting to slip/)).toBeDefined();
  });

  it("says plainly when nothing is slipping, and offers no list", async () => {
    digestForMock.mockResolvedValue(view({ tracked: 1, slipping: 0 }));
    render(await ProgressPage());

    expect(screen.getByText(/1 skill you have shown/)).toBeDefined();
    expect(screen.getByText(/None of them are slipping/)).toBeDefined();
    expect(screen.queryByRole("link", { name: "See which" })).toBeNull();
  });

  it("does not pretend to track retention before anything is proved", async () => {
    digestForMock.mockResolvedValue(view({ tracked: 0, slipping: 0 }));
    render(await ProgressPage());

    expect(screen.getByText(/Nothing to hold on to yet/)).toBeDefined();
  });
});

describe("the revised estimate", () => {
  it("prices what is left at the planned pace and at the real one", async () => {
    digestForMock.mockResolvedValue(view());
    render(await ProgressPage());

    expect(
      screen.getByText(/About 30 hours, which is 10 weeks at the 3 hours a week/),
    ).toBeDefined();
    // The honest half — and the one nobody else in this category shows you.
    expect(screen.getByText(/At the 2 hours you actually did: 15 weeks/)).toBeDefined();
  });

  it("gives no second estimate for a week with nothing in it", async () => {
    digestForMock.mockResolvedValue(
      view({ hoursLogged: 0, sessions: 0, weeksAtActualPace: null }),
    );
    render(await ProgressPage());

    expect(screen.getByText(/no finish date to give you/)).toBeDefined();
  });

  it("counts a single remaining week in the singular", async () => {
    digestForMock.mockResolvedValue(
      view({
        remainingHours: 1,
        weeksAtCommitment: 1,
        weeksAtActualPace: 1,
        hoursLogged: 1,
      }),
    );
    render(await ProgressPage());

    expect(screen.getByText(/About 1 hour, which is 1 week/)).toBeDefined();
    expect(screen.getByText(/At the 1 hour you actually did: 1 week\./)).toBeDefined();
  });

  it("shows no percentage anywhere (§24 E9)", async () => {
    digestForMock.mockResolvedValue(view());
    const { container } = render(await ProgressPage());
    expect(container.textContent).not.toMatch(/\d%|percent/i);
  });
});
