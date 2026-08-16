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
 * The dated half of `/progress` — what used to be `/calendar`, before the two
 * merged into one destination.
 *
 * Kept as its own file rather than folded into `progress-page.test.tsx` because
 * the questions are different: that file is about the honesty of the week's
 * sentences, this one is about whether a date says what it actually rests on. A
 * calendar is where a product is most tempted to draw a guess like a fact, so
 * the assertions below are mostly about the difference between the three marks.
 *
 * `calendarFor` is stubbed; what it computes is tested against a real database
 * in tests/calendar/store.test.ts.
 */

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const getSessionMock = vi.fn();
const calendarForMock = vi.fn();
const digestForMock = vi.fn();
const coursesForMock = vi.fn();
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
// The screen's other half. Stubbed to something valid throughout this file so
// the dates are what is under test — `progress-page.test.tsx` owns the digest.
vi.mock("@/lib/mastery/view", () => ({
  digestFor: (...args: unknown[]) => digestForMock(...(args as [])),
}));
vi.mock("@/lib/goals/courses", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/goals/courses")>()),
  coursesFor: (...args: unknown[]) => coursesForMock(...(args as [])),
}));
// What the learner has on when there is nothing to date. Stubbed for the same
// reason `calendarFor` is: it is a database read, tested in tests/goals.
vi.mock("@/lib/goals/standing", () => ({
  standingFor: (...args: unknown[]) => standingForMock(...(args as [])),
}));

const { default: ProgressPage } = await import("@/app/(app)/progress/page");

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

  const weeks = buildMonth({ month: "2026-08", today: TODAY, entries });

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
    weeks,
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
    /*
     * Derived the way `calendarFor` derives them rather than passed in, so a
     * fixture cannot claim a month is empty while handing the screen a grid
     * full of marks. `nextAfter` itself is not imported: this file mocks the
     * view module wholesale, and it is one `find` over an already-sorted list.
     */
    hasMarks: weeks.flat().some((cell) => cell.certainties.length > 0),
    next: entries.find((e) => e.day > weeks.at(-1)!.at(-1)!.day),
  };
}

const DIGEST = {
  goal: {
    id: "g1",
    packSlug: pack.slug,
    spec: {} as CalendarView["goal"]["spec"],
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
  },
  pack,
  digest: {
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
  },
  from: new Date("2026-08-06T12:00:00.000Z"),
  to: new Date("2026-08-13T12:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(SIGNED_IN);
  standingForMock.mockResolvedValue(NOTHING_ON);
  coursesForMock.mockResolvedValue([]);
  digestForMock.mockResolvedValue(DIGEST);
});

afterEach(cleanup);

describe("before there is anything to date", () => {
  it("redirects an unauthenticated visitor to sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(ProgressPage({ searchParams: search() })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("says what this screen will hold rather than only what is missing", async () => {
    calendarForMock.mockResolvedValue(undefined);
    digestForMock.mockResolvedValue(undefined);
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText(/everything owed turns up on a date/i)).toBeDefined();
    expect(screen.getByText("Pick a subject")).toBeDefined();
  });

  /**
   * Two reads, so both are checked. They ask the same two questions — is there
   * an active goal, does its pack still resolve — but they ask separately, and
   * a course paused between the two answers would leave one view and not the
   * other. Half a screen is worse than the offer.
   */
  it("shows the offer when only the dates are missing", async () => {
    calendarForMock.mockResolvedValue(undefined);
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText("Pick a subject")).toBeDefined();
    expect(screen.queryByText("The month")).toBeNull();
  });

  it("shows the offer when only the week is missing", async () => {
    digestForMock.mockResolvedValue(undefined);
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText("Pick a subject")).toBeDefined();
    expect(screen.queryByText("The month")).toBeNull();
  });

  /**
   * The bug this shares a fix with: `/today` told the learner they were partway
   * through creating a subject, and this screen — one tab along, same learner,
   * same moment — told them they had nothing and should go and pick something.
   */
  it("carries the conversation they left, rather than offering a fresh start", async () => {
    calendarForMock.mockResolvedValue(undefined);
    digestForMock.mockResolvedValue(undefined);
    standingForMock.mockResolvedValue({
      ...NOTHING_ON,
      resume: { subject: "Kite surfing", turns: 2, ofTurns: 6, ready: false },
    });
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText("You were partway through")).toBeDefined();
    expect(screen.getByText(/2 of 6 questions answered/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Carry on" }).getAttribute("href"),
    ).toBe("/start#latest");
    expect(screen.queryByText("Pick something to get good at")).toBeNull();
  });

  it("sends them to the wait screen while a subject is being written", async () => {
    calendarForMock.mockResolvedValue(undefined);
    digestForMock.mockResolvedValue(undefined);
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
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText(/writing your course now/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: /See how it/ }).getAttribute("href"),
    ).toBe("/start/building?subject=kite-surfing");
  });

  /**
   * No `PickBackUp` on this branch, unlike the screen `/calendar` used to be:
   * the courses band below already lists every course, this one included, and
   * is where a course is managed rather than re-entered. Two offers to resume
   * the same course on one screen is the drift the merge existed to stop.
   */
  it("offers a course they put aside, which already has dates behind it", async () => {
    calendarForMock.mockResolvedValue(undefined);
    digestForMock.mockResolvedValue(undefined);
    coursesForMock.mockResolvedValue([
      {
        goalId: "g-old",
        name: "Photography",
        taxonomyParent: "creative",
        status: "paused" as const,
      },
    ]);
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText("What you have on")).toBeDefined();
    expect(screen.getByRole("button", { name: "Pick it up" })).toBeDefined();
  });

  /** See the same test on `/mastery`: nothing here can tell the two apart. */
  it("does not claim the learner has no goal, which it cannot know", async () => {
    calendarForMock.mockResolvedValue(undefined);
    digestForMock.mockResolvedValue(undefined);
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.queryByText(/don't have a goal yet/i)).toBeNull();
  });

  it("is noindexed in its own right as well as by the layout", async () => {
    const { metadata } = await import("@/app/(app)/progress/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

/**
 * One hero, not two.
 *
 * `/calendar` led with a streak in weeks and `/progress` with the hours in the
 * last seven days — the same commitment read twice, on two destinations. The
 * hours keep the `Figure` because they are what the learner can still act on
 * today; the streak survives as a `Status` beside it, which is also what
 * §8.5.10's "one Figure per band, never a row" requires.
 *
 * The figure itself is `progress-page.test.tsx`'s; what is checked here is that
 * the streak came across the merge rather than being dropped with the screen.
 */
describe("the streak, after the merge", () => {
  it("credits the weeks kept without giving them a figure of their own", async () => {
    // A daily streak would tell someone on three hours a week that they failed
    // on Tuesday. The commitment they set is the thing worth counting against.
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText("2 weeks running, kept")).toBeDefined();
  });

  it("counts a single kept week in the singular", async () => {
    calendarForMock.mockResolvedValue(view({ commitment: { weeksKept: 1 } }));
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText("1 week running, kept")).toBeDefined();
  });

  it("says nothing at all when there is no run to report", async () => {
    // Silence, not "0 weeks": §8 screen 6 spends a whole interaction refusing
    // to build guilt mechanics, and a streak is where they come back.
    calendarForMock.mockResolvedValue(view({ commitment: { weeksKept: 0 } }));
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.queryByText(/running, kept/)).toBeNull();
  });
});

/**
 * The grid's own squares. Every other `li` on this screen is a row in a list of
 * sentences, and several of those sentences now appear twice on the page: once
 * in a list, once in the card that opens on the day they land on. Scoping is
 * what keeps a test about one of them from matching the other.
 */
const dayCell = (day: number): HTMLElement =>
  screen
    .getAllByRole("listitem")
    .find((li) => li.firstElementChild?.textContent === String(day))!;

/** The band with this heading, for the same reason. */
const band = (heading: string): HTMLElement =>
  screen.getByText(heading).closest("section")!;

describe("the month", () => {
  it("draws the month it was given, and offers the ones either side", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText("August 2026")).toBeDefined();
    expect(screen.getByRole("link", { name: "Earlier" }).getAttribute("href")).toBe(
      "/progress?month=2026-07",
    );
    expect(screen.getByRole("link", { name: "Later" }).getAttribute("href")).toBe(
      "/progress?month=2026-09",
    );
  });

  it("passes the month asked for straight through", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search({ month: "2026-11" }) }));

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
    render(await ProgressPage({ searchParams: search() }));

    for (const word of ["You worked", "Due", "Projected"]) {
      expect(screen.getByText(word)).toBeDefined();
    }
  });

  /**
   * Said twice, in two registers. A screen reader gets the whole day in one
   * line; a pointer or a tab stop opens a card that breaks it into the things
   * on it, each with the mark it carries in the grid.
   */
  it("writes out what sits on a marked day, for reading out", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText("Mon 10 Aug — 120 minutes")).toBeDefined();
    expect(
      screen.getByText("Tue 18 Aug — 1 question comes back to you"),
    ).toBeDefined();
  });

  it("opens a card on the day naming each thing on it", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));

    const card = within(dayCell(10)).getByText("Mon 10 Aug").parentElement!;

    // The date as a heading, then the thing and what it rests on.
    expect(within(card).getByText("120 minutes")).toBeDefined();
    expect(within(card).getByText("You sat down 2 times.")).toBeDefined();
    // Hidden from anyone who is already being read the line above.
    expect(card.getAttribute("aria-hidden")).toBe("true");
  });

  /** Hover is not the only way in: a day with something on it is a tab stop,
      and an empty one is not — a month of empty squares is not a tab trap. */
  it("makes only the days that have something to say focusable", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));

    const marked = screen
      .getAllByRole("listitem")
      .filter((li) => li.getAttribute("tabindex") === "0");

    expect(marked.length).toBeGreaterThan(0);
    for (const li of marked) {
      expect(li.textContent).toMatch(/—/);
    }
  });

  /**
   * The day number takes the colour of the strongest thing on it, so a day
   * reads as one object rather than a number with an unrelated stripe under it.
   */
  it("colours the day number to match what sits on it", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));

    /*
     * Found by the line a screen reader is given rather than by the numeral: a
     * six-week grid holds two 28ths, and the first of them is the padding day
     * from July.
     */
    const numeral = (day: RegExp) =>
      screen.getByText(day).closest("li")!.firstElementChild!.className;

    expect(numeral(/^Mon 10 Aug —/)).toContain("text-accent"); // you worked
    expect(numeral(/^Tue 18 Aug —/)).toContain("text-attention"); // owed
    // A projection has a hue of its own rather than borrowing the accent, which
    // means "this happened, and we checked". See `planned` in theme.ts.
    expect(numeral(/^Fri 28 Aug —/)).toContain("text-planned");
  });

  /**
   * Two competing `text-*` utilities resolve by stylesheet order rather than by
   * the order they appear in the attribute, so a numeral that carried both
   * would be a colour decided by whatever Tailwind happened to emit last.
   */
  it("gives every day number exactly one colour", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));

    const isColour = (c: string) =>
      /^text-(ink|ink-muted|ink-faint|accent|attention|on-accent|planned)$/.test(
        c,
      );

    // The grid's own squares: every other `li` on the screen is a row in a
    // list of sentences, and the day number is the thing under test.
    const days = screen
      .getAllByRole("listitem")
      .filter((li) => /^\d{1,2}$/.test(li.firstElementChild?.textContent ?? ""));

    expect(days.length).toBeGreaterThan(28);
    for (const li of days) {
      const classes = li.firstElementChild!.className.split(" ");
      expect(classes.filter(isColour)).toHaveLength(1);
    }
  });

  it("says plainly that a projected day is not a promise", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));
    expect(screen.getByText(/Nothing on them has been promised to you/)).toBeDefined();
  });

  /**
   * The month a learner sees the day their path is built, and the reading it
   * used to invite. Four of five checkpoints land past the end of this grid, so
   * the calendar looked empty to somebody who had just been given five dates.
   * A grid cannot say that about itself; the sentence under it can.
   */
  it("says where the dates went when this month has none", async () => {
    calendarForMock.mockResolvedValue(
      view({
        entries: buildEntries({
          worked: [],
          retrieval: [],
          lapses: [],
          checkpoints: [checkpoint({ day: "2026-11-07", dayAtActualPace: null })],
          deadline: null,
          targetOutcome: "a portfolio of ten",
        }),
      }),
    );
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText(/Nothing lands in August 2026/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "November 2026" }).getAttribute("href"),
    ).toBe("/progress?month=2026-11");
  });

  it("does not send them looking for dates that do not exist", async () => {
    calendarForMock.mockResolvedValue(
      view({
        entries: [],
        checkpoints: [],
      }),
    );
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText(/Days fill in as you work/)).toBeDefined();
    expect(screen.queryByText(/The next thing on your calendar/)).toBeNull();
  });

  it("keeps quiet about an empty month when the month is not empty", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));
    expect(screen.queryByText(/Nothing lands in/)).toBeNull();
  });

  /**
   * Today is already the loudest square on the grid, so a day that is both
   * today and marked keeps today's treatment rather than fighting it.
   */
  it("does not re-weight today when today carries a mark", async () => {
    calendarForMock.mockResolvedValue(
      view({
        entries: buildEntries({
          worked: [{ day: TODAY, minutes: 45, sessions: 1 }],
          retrieval: [],
          lapses: [],
          checkpoints: [],
          deadline: null,
          targetOutcome: "a portfolio of ten",
        }),
      }),
    );
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText("Fri 14 Aug — 45 minutes")).toBeDefined();
  });
});

describe("what's coming", () => {
  it("names each thing, what it rests on, and how far off it is", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));

    // Scoped to the band: the same sentence is also on the card that opens on
    // the 18th, which is the point of the card and not a duplicate list.
    const row = within(band("What's coming"))
      .getByText("1 question comes back to you")
      .closest("li")!;
    expect(within(row).getByText("Metering and histogram")).toBeDefined();
    expect(within(row).getByText("Tue 18 Aug")).toBeDefined();
    expect(within(row).getByText("in 4 days")).toBeDefined();
  });

  it("says a skill stops counting without explaining our machinery", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));

    const row = within(band("What's coming"))
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
    render(await ProgressPage({ searchParams: search() }));

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
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.queryByText("Waiting")).toBeNull();
  });

  it("says so when nothing is owed rather than showing an empty list", async () => {
    calendarForMock.mockResolvedValue(
      view({
        entries: [],
        checkpoints: [],
      }),
    );
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText(/Nothing is waiting on you/)).toBeDefined();
  });

  /**
   * The empty state that made a working build look like a broken one. This band
   * excludes checkpoints on purpose — they are priced in their own — so a
   * learner whose path had just been cut into modules read "nothing is waiting
   * on you" and concluded the build had produced nothing.
   */
  it("says where the dated work went, rather than that there is none", async () => {
    calendarForMock.mockResolvedValue(
      view({
        entries: buildEntries({
          worked: [],
          retrieval: [],
          lapses: [],
          checkpoints: [checkpoint()],
          deadline: null,
          targetOutcome: "a portfolio of ten",
        }),
      }),
    );
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText(/What you are working towards is dated below/)).toBeDefined();
    expect(screen.queryByText(/Nothing is waiting on you/)).toBeNull();
  });
});

describe("checkpoints", () => {
  it("prices each one at the pace set aside and the pace actually kept", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));

    // The checkpoint's own card. Its title is also on the grid, in the card
    // that opens on the day it lands — which is the point of that card.
    const ahead = within(band("What's ahead"));
    expect(ahead.getByText("Ten frames of one thing")).toBeDefined();
    expect(ahead.getByText("Marked against a rubric")).toBeDefined();
    expect(
      ahead.getByText(/About 6 hours of work between here and it/),
    ).toBeDefined();
    /*
     * The date and its pace, in that order and in that weight. They used to be
     * one sentence in 13px faint grey — the smallest type on a card whose whole
     * job is to say when something lands, which is how a screen full of dates
     * came to be reported as having none.
     */
    expect(ahead.getByText("Fri 28 Aug")).toBeDefined();
    expect(ahead.getByText("at the 3 hours a week you set aside")).toBeDefined();
    // The honest half, and the one nobody else in this category shows you.
    expect(ahead.getByText("Fri 4 Sep")).toBeDefined();
    expect(ahead.getByText("at the 2 hours you actually did")).toBeDefined();
  });

  it("says nothing is marked when nothing is", async () => {
    calendarForMock.mockResolvedValue(
      view({ checkpoints: [checkpoint({ graded: false })] }),
    );
    render(await ProgressPage({ searchParams: search() }));
    expect(screen.queryByText("Marked against a rubric")).toBeNull();
  });

  it("gives no second date for a week with nothing in it", async () => {
    calendarForMock.mockResolvedValue(
      view({ checkpoints: [checkpoint({ dayAtActualPace: null })] }),
    );
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText(/no second date to give you/)).toBeDefined();
  });

  it("offers to build the path when there isn't one", async () => {
    calendarForMock.mockResolvedValue(view({ hasPath: false, checkpoints: [] }));
    render(await ProgressPage({ searchParams: search() }));

    expect(
      screen.getByRole("link", { name: "Build my path" }).getAttribute("href"),
    ).toBe("/path");
  });

  it("says when a built path has no hand-ins left on it", async () => {
    calendarForMock.mockResolvedValue(view({ checkpoints: [] }));
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.queryByRole("link", { name: "Build my path" })).toBeNull();
    expect(
      screen.getByText(/Nothing left on your path has a hand-in attached/),
    ).toBeDefined();
  });

  it("says when there is more work than time, whatever the pace", async () => {
    calendarForMock.mockResolvedValue(
      view({ deadline: "2026-08-20", checkpoints: [checkpoint()] }),
    );
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText("More work than time")).toBeDefined();
    // The date is named in the claim itself, not only in the sentence under it:
    // a verdict that says "you will not make it" without saying what it is you
    // will not make is the half of the warning nobody can act on.
    expect(
      screen.getByText("The plan does not fit 20 August 2026"),
    ).toBeDefined();
    expect(
      screen.getByText(/a week you set aside, a checkpoint lands after it/),
    ).toBeDefined();
  });

  it("separates a plan that does not fit from a pace that does not keep up", async () => {
    // The plan clears 1 September; last week's pace does not. Those are two
    // different problems and the second one is the learner's to decide about.
    calendarForMock.mockResolvedValue(
      view({ deadline: "2026-09-01", checkpoints: [checkpoint()] }),
    );
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByText("Behind the pace, not the plan")).toBeDefined();
    expect(screen.queryByText("More work than time")).toBeNull();
    expect(
      screen.getByText("At last week’s pace you miss 1 September 2026"),
    ).toBeDefined();
    expect(screen.getByText(/The plan itself fits/)).toBeDefined();
  });

  it("claims nothing about a deadline the shown work clears", async () => {
    // The list is capped, so silence has to mean "not shown" rather than
    // "you're fine" — and the screen must not say the second one.
    calendarForMock.mockResolvedValue(
      view({ deadline: "2026-12-01", checkpoints: [checkpoint()] }),
    );
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.queryByText("More work than time")).toBeNull();
    expect(screen.queryByText("Behind the pace, not the plan")).toBeNull();
    expect(screen.getByText("by 1 December 2026")).toBeDefined();
  });
});

describe("the house rules", () => {
  it("shows no percentage anywhere (§24 E9)", async () => {
    calendarForMock.mockResolvedValue(view({ deadline: "2026-12-01" }));
    const { container } = render(
      await ProgressPage({ searchParams: search() }),
    );
    expect(container.textContent).not.toMatch(/\d%|percent/i);
  });

  it("carries the facts about the goal on the header's rule", async () => {
    calendarForMock.mockResolvedValue(view());
    render(await ProgressPage({ searchParams: search() }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "The last seven days",
    );
    expect(screen.getByText(pack.name)).toBeDefined();
    expect(screen.getByText("3 hours a week")).toBeDefined();
  });
});
