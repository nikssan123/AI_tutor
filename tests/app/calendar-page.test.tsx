// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { findPack } from "@/lib/content";
import { buildMonth } from "@/lib/calendar/month";
import { buildEntries } from "@/lib/calendar/schedule";
import type { CalendarEntry, Commitment } from "@/lib/calendar/schedule";
import type { Checkpoint } from "@/lib/calendar/checkpoints";
import type { CalendarView } from "@/lib/calendar/view";
import type { LearnerStanding } from "@/lib/goals/standing";

/**
 * The calendar screen.
 *
 * `calendarFor` is stubbed: what it computes is tested against a real database
 * in tests/calendar/store.test.ts, and the question here is whether the screen
 * says what those dates actually rest on. A calendar is where a product is most
 * tempted to draw a guess like a fact, so the assertions below are mostly about
 * the difference between the three.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const calendarForMock = vi.fn();
const standingForMock = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/calendar/view", () => ({
  calendarFor: (...args: unknown[]) => calendarForMock(...(args as [])),
}));
// What the learner has on when there is nothing to date. Stubbed for the same
// reason `calendarFor` is: it is a database read, tested in tests/goals.
vi.mock("@/lib/goals/standing", () => ({
  standingFor: (...args: unknown[]) => standingForMock(...(args as [])),
}));

const { default: CalendarPage } = await import("@/app/(app)/calendar/page");

const NOTHING_ON: LearnerStanding = {
  building: undefined,
  resume: undefined,
  again: [],
};

const SIGNED_IN = { user: { id: "u1", email: "a@b.co" } };
const TODAY = "2026-08-14";
const pack = findPack("photography")!;
const search = (params: { month?: string } = {}) => Promise.resolve(params);

const checkpoint = (overrides: Partial<Checkpoint> = {}): Checkpoint => ({
  title: "Ten frames of one thing",
  hoursAway: 6,
  day: "2026-08-28",
  dayAtActualPace: "2026-09-04",
  graded: true,
  ...overrides,
});

function view(
  overrides: {
    entries?: CalendarEntry[];
    commitment?: Partial<Commitment>;
    checkpoints?: Checkpoint[];
    deadline?: string | null;
    hasPath?: boolean;
  } = {},
): CalendarView {
  const entries =
    overrides.entries ??
    buildEntries({
      worked: [{ day: "2026-08-10", minutes: 120, sessions: 2 }],
      retrieval: [{ day: "2026-08-18", skillName: "Metering and histogram" }],
      lapses: [{ day: "2026-08-29", skillName: "Exposure triangle" }],
      checkpoints: overrides.checkpoints ?? [checkpoint()],
      deadline: overrides.deadline ?? null,
      targetOutcome: "a portfolio of ten",
    });

  return {
    goal: {
      id: "g1",
      packSlug: pack.slug,
      spec: {} as CalendarView["goal"]["spec"],
      createdAt: new Date("2026-08-01T09:00:00.000Z"),
    },
    pack,
    month: "2026-08",
    label: "August 2026",
    previousMonth: "2026-07",
    nextMonth: "2026-09",
    today: TODAY,
    weeks: buildMonth({ month: "2026-08", today: TODAY, entries }),
    ahead: entries.filter(
      (e) => e.certainty !== "recorded" && e.kind !== "checkpoint",
    ),
    checkpoints: overrides.checkpoints ?? [checkpoint()],
    commitment: {
      weeklyHours: 3,
      weeksKept: 2,
      thisWeekHours: 2,
      keptThisWeek: false,
      ...overrides.commitment,
    },
    deadline: overrides.deadline ?? null,
    hasPath: overrides.hasPath ?? true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(SIGNED_IN);
  standingForMock.mockResolvedValue(NOTHING_ON);
});

afterEach(cleanup);

describe("before there is anything to date", () => {
  it("redirects an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(CalendarPage({ searchParams: search() })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("says what this screen will hold rather than only what is missing", async () => {
    calendarForMock.mockResolvedValue(undefined);
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText(/everything owed and everything already done/i)).toBeDefined();
    expect(screen.getByText("Pick a subject")).toBeDefined();
  });

  /**
   * The bug this shares a fix with: `/today` told the learner they were partway
   * through creating a subject, and this screen — one tab along, same learner,
   * same moment — told them they had nothing and should go and pick something.
   */
  it("carries the conversation they left, rather than offering a fresh start", async () => {
    calendarForMock.mockResolvedValue(undefined);
    standingForMock.mockResolvedValue({
      ...NOTHING_ON,
      resume: { subject: "Kite surfing", turns: 2, ofTurns: 6, ready: false },
    });
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText("You were partway through")).toBeDefined();
    expect(screen.getByText(/2 of 6 questions answered/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Carry on" }).getAttribute("href"),
    ).toBe("/start");
    expect(screen.queryByText("Pick something to get good at")).toBeNull();
  });

  it("sends them to the wait screen while a subject is being written", async () => {
    calendarForMock.mockResolvedValue(undefined);
    standingForMock.mockResolvedValue({
      ...NOTHING_ON,
      building: {
        slug: "kite-surfing",
        subject: "Kite surfing",
        status: "building" as const,
        detail: null,
        startedAt: new Date("2026-08-13T09:00:00.000Z"),
      },
    });
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText(/writing your course now/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: /See how it/ }).getAttribute("href"),
    ).toBe("/start/building?subject=kite-surfing");
  });

  it("offers a course they put aside, which already has dates behind it", async () => {
    calendarForMock.mockResolvedValue(undefined);
    standingForMock.mockResolvedValue({
      ...NOTHING_ON,
      again: [
        {
          goalId: "g-old",
          name: "Photography",
          taxonomyParent: "creative",
          status: "paused" as const,
        },
      ],
    });
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText("Pick one back up")).toBeDefined();
    expect(screen.getByRole("button", { name: "Pick it up" })).toBeDefined();
  });

  /** See the same test on `/mastery`: nothing here can tell the two apart. */
  it("does not claim the learner has no goal, which it cannot know", async () => {
    calendarForMock.mockResolvedValue(undefined);
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.queryByText(/don't have a goal yet/i)).toBeNull();
  });

  it("is noindexed in its own right as well as by the layout", async () => {
    const { metadata } = await import("@/app/(app)/calendar/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("the commitment", () => {
  it("leads with the weeks kept, not with a day count", async () => {
    // A daily streak would tell someone on three hours a week that they failed
    // on Tuesday. The commitment they set is the thing worth counting against.
    calendarForMock.mockResolvedValue(view());
    render(await CalendarPage({ searchParams: search() }));

    // Scoped to the figure: the grid under it is full of bare numbers, and a
    // day square is not the screen's one number.
    const figure = screen
      .getByText(/running, in which you did what you said you would/)
      .closest("div")!;
    expect(within(figure).getByText("2")).toBeDefined();
    expect(within(figure).getByText("weeks")).toBeDefined();
  });

  it("counts a single kept week in the singular", async () => {
    calendarForMock.mockResolvedValue(view({ commitment: { weeksKept: 1 } }));
    render(await CalendarPage({ searchParams: search() }));
    expect(screen.getByText("week")).toBeDefined();
  });

  it("falls back to the hours when there is no run to report", async () => {
    calendarForMock.mockResolvedValue(
      view({ commitment: { weeksKept: 0, thisWeekHours: 1 } }),
    );
    render(await CalendarPage({ searchParams: search() }));

    const figure = screen
      .getByText("in the last seven days, of the 3 hours you set aside.")
      .closest("div")!;
    expect(within(figure).getByText("1")).toBeDefined();
    expect(within(figure).getByText("hour")).toBeDefined();
  });

  it("counts more than one of those hours in the plural", async () => {
    calendarForMock.mockResolvedValue(
      view({ commitment: { weeksKept: 0, thisWeekHours: 2 } }),
    );
    render(await CalendarPage({ searchParams: search() }));

    const figure = screen
      .getByText("in the last seven days, of the 3 hours you set aside.")
      .closest("div")!;
    expect(within(figure).getByText("hours")).toBeDefined();
  });

  it("says how much of the week is left rather than that you are behind", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await CalendarPage({ searchParams: search() }));
    expect(screen.getByText("1 hour to go this week")).toBeDefined();
  });

  it("credits a week already met", async () => {
    calendarForMock.mockResolvedValue(
      view({ commitment: { thisWeekHours: 3, keptThisWeek: true } }),
    );
    render(await CalendarPage({ searchParams: search() }));
    expect(screen.getByText("This week is already done")).toBeDefined();
  });
});

describe("the month", () => {
  it("draws the month it was given, and offers the ones either side", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText("August 2026")).toBeDefined();
    expect(screen.getByRole("link", { name: "Earlier" }).getAttribute("href")).toBe(
      "/calendar?month=2026-07",
    );
    expect(screen.getByRole("link", { name: "Later" }).getAttribute("href")).toBe(
      "/calendar?month=2026-09",
    );
  });

  it("passes the month asked for straight through", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await CalendarPage({ searchParams: search({ month: "2026-11" }) }));

    expect(calendarForMock).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      expect.any(Date),
      { month: "2026-11" },
    );
  });

  it("names every mark in words, never in colour alone", async () => {
    // §8.5.5 — colour is never the sole carrier of meaning, and a grid of dots
    // is where a product breaks that rule without noticing.
    calendarForMock.mockResolvedValue(view());
    render(await CalendarPage({ searchParams: search() }));

    for (const word of ["You worked", "Due", "Projected"]) {
      expect(screen.getByText(word)).toBeDefined();
    }
  });

  it("writes out what sits on a marked day", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText("Mon 10 Aug — 120 minutes")).toBeDefined();
    expect(
      screen.getByText("Tue 18 Aug — 1 question comes back to you"),
    ).toBeDefined();
  });

  it("says plainly that a projected day is not a promise", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await CalendarPage({ searchParams: search() }));
    expect(screen.getByText(/Nothing on them has been promised to you/)).toBeDefined();
  });
});

describe("what's coming", () => {
  it("names each thing, what it rests on, and how far off it is", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await CalendarPage({ searchParams: search() }));

    const row = screen.getByText("1 question comes back to you").closest("li")!;
    expect(within(row).getByText("Metering and histogram")).toBeDefined();
    expect(within(row).getByText("Tue 18 Aug")).toBeDefined();
    expect(within(row).getByText("in 4 days")).toBeDefined();
  });

  it("says a skill stops counting without explaining our machinery", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await CalendarPage({ searchParams: search() }));

    const row = screen
      .getByText("Exposure triangle stops counting")
      .closest("li")!;
    expect(row.textContent).not.toMatch(/decay|half.life|mastery/i);
  });

  it("marks work that was owed and has not been done", async () => {
    calendarForMock.mockResolvedValue(
      view({
        entries: buildEntries({
          worked: [],
          retrieval: [{ day: "2026-08-07", skillName: "Metering and histogram" }],
          lapses: [],
          checkpoints: [],
          deadline: null,
          targetOutcome: "a portfolio of ten",
        }),
      }),
    );
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText("Waiting")).toBeDefined();
    expect(screen.getByText("7 days ago")).toBeDefined();
  });

  it("does not call a projection overdue", async () => {
    // A date the arithmetic landed on cannot be "late" — nobody promised it.
    calendarForMock.mockResolvedValue(
      view({
        entries: buildEntries({
          worked: [],
          retrieval: [],
          lapses: [{ day: "2026-08-07", skillName: "Exposure triangle" }],
          checkpoints: [],
          deadline: null,
          targetOutcome: "a portfolio of ten",
        }),
      }),
    );
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.queryByText("Waiting")).toBeNull();
  });

  it("says so when nothing is owed rather than showing an empty list", async () => {
    calendarForMock.mockResolvedValue(
      view({
        entries: [],
        checkpoints: [],
      }),
    );
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText(/Nothing is waiting on you/)).toBeDefined();
  });
});

describe("checkpoints", () => {
  it("prices each one at the pace set aside and the pace actually kept", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText("Ten frames of one thing")).toBeDefined();
    expect(screen.getByText("Marked against a rubric")).toBeDefined();
    expect(
      screen.getByText(/About 6 hours of work between here and it/),
    ).toBeDefined();
    expect(
      screen.getByText("Fri 28 Aug at the 3 hours a week you set aside"),
    ).toBeDefined();
    // The honest half, and the one nobody else in this category shows you.
    expect(
      screen.getByText("Fri 4 Sep at the 2 hours you actually did"),
    ).toBeDefined();
  });

  it("says nothing is marked when nothing is", async () => {
    calendarForMock.mockResolvedValue(
      view({ checkpoints: [checkpoint({ graded: false })] }),
    );
    render(await CalendarPage({ searchParams: search() }));
    expect(screen.queryByText("Marked against a rubric")).toBeNull();
  });

  it("gives no second date for a week with nothing in it", async () => {
    calendarForMock.mockResolvedValue(
      view({ checkpoints: [checkpoint({ dayAtActualPace: null })] }),
    );
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText(/no second date to give you/)).toBeDefined();
  });

  it("offers to build the path when there isn't one", async () => {
    calendarForMock.mockResolvedValue(view({ hasPath: false, checkpoints: [] }));
    render(await CalendarPage({ searchParams: search() }));

    expect(
      screen.getByRole("link", { name: "Build my path" }).getAttribute("href"),
    ).toBe("/goals/g1/path");
  });

  it("says when a built path has no hand-ins left on it", async () => {
    calendarForMock.mockResolvedValue(view({ checkpoints: [] }));
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.queryByRole("link", { name: "Build my path" })).toBeNull();
    expect(
      screen.getByText(/Nothing left on your path has a hand-in attached/),
    ).toBeDefined();
  });

  it("says when there is more work than time, whatever the pace", async () => {
    calendarForMock.mockResolvedValue(
      view({ deadline: "2026-08-20", checkpoints: [checkpoint()] }),
    );
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText("More work than time")).toBeDefined();
    expect(
      screen.getByText(/a checkpoint lands after 20 August 2026/),
    ).toBeDefined();
  });

  it("separates a plan that does not fit from a pace that does not keep up", async () => {
    // The plan clears 1 September; last week's pace does not. Those are two
    // different problems and the second one is the learner's to decide about.
    calendarForMock.mockResolvedValue(
      view({ deadline: "2026-09-01", checkpoints: [checkpoint()] }),
    );
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByText("Behind the pace, not the plan")).toBeDefined();
    expect(screen.queryByText("More work than time")).toBeNull();
    expect(screen.getByText(/The plan fits 1 September 2026/)).toBeDefined();
  });

  it("claims nothing about a deadline the shown work clears", async () => {
    // The list is capped, so silence has to mean "not shown" rather than
    // "you're fine" — and the screen must not say the second one.
    calendarForMock.mockResolvedValue(
      view({ deadline: "2026-12-01", checkpoints: [checkpoint()] }),
    );
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.queryByText("More work than time")).toBeNull();
    expect(screen.queryByText("Behind the pace, not the plan")).toBeNull();
    expect(screen.getByText("by 1 December 2026")).toBeDefined();
  });
});

describe("the house rules", () => {
  it("shows no percentage anywhere (§24 E9)", async () => {
    calendarForMock.mockResolvedValue(view({ deadline: "2026-12-01" }));
    const { container } = render(
      await CalendarPage({ searchParams: search() }),
    );
    expect(container.textContent).not.toMatch(/\d%|percent/i);
  });

  it("carries the facts about the goal on the header's rule", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await CalendarPage({ searchParams: search() }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Your calendar",
    );
    expect(screen.getByText(pack.name)).toBeDefined();
    expect(screen.getByText("3 hours a week")).toBeDefined();
  });
});
