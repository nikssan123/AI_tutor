import { describe, expect, it } from "vitest";
import { buildMonth, CERTAINTIES } from "@/lib/calendar/month";
import type { CalendarEntry } from "@/lib/calendar/schedule";

/**
 * The grid.
 *
 * It is the one thing on the screen that is a picture rather than a sentence,
 * so the test it has to pass is that it never says anything the words underneath
 * it do not: every marked square carries its own description, and a square with
 * nothing on it carries none.
 */

const TODAY = "2026-08-14";

const entry = (overrides: Partial<CalendarEntry> = {}): CalendarEntry => ({
  day: TODAY,
  kind: "session",
  certainty: "recorded",
  title: "25 minutes",
  detail: "You sat down once.",
  ...overrides,
});

const month = (entries: CalendarEntry[] = []) =>
  buildMonth({ month: "2026-08", today: TODAY, entries });

const cellFor = (day: string, entries: CalendarEntry[] = []) =>
  month(entries)
    .flat()
    .find((c) => c.day === day)!;

describe("buildMonth", () => {
  it("lays the month out in whole weeks", () => {
    const weeks = month();
    expect(weeks).toHaveLength(6);
    for (const week of weeks) expect(week).toHaveLength(7);
  });

  it("knows which days belong to the month it is showing", () => {
    // August 2026 opens on a Saturday, so the first row is mostly July — and
    // those days are still real days that can carry a session.
    expect(cellFor("2026-07-27").inMonth).toBe(false);
    expect(cellFor("2026-08-01").inMonth).toBe(true);
    expect(cellFor("2026-09-06").inMonth).toBe(false);
  });

  it("marks today, and only today", () => {
    const days = month().flat().filter((c) => c.isToday);
    expect(days.map((c) => c.day)).toEqual([TODAY]);
  });

  it("says nothing about a day with nothing on it", () => {
    const cell = cellFor("2026-08-20");
    expect(cell.certainties).toEqual([]);
    expect(cell.description).toBeNull();
  });

  it("carries one mark per kind of thing, in one fixed order", () => {
    const cell = cellFor(TODAY, [
      entry({ kind: "checkpoint", certainty: "projected", title: "First print" }),
      entry({ kind: "retrieval", certainty: "due", title: "1 question" }),
      entry(),
      // A second recorded thing on the same day does not earn a second mark.
      entry({ title: "10 minutes" }),
    ]);

    expect(cell.certainties).toEqual(CERTAINTIES);
  });

  it("writes out everything on a day for a reader who cannot see the marks", () => {
    // §8.5.5 bans colour as the sole carrier of meaning, and a grid of dots is
    // exactly where a product breaks that rule without noticing.
    const cell = cellFor(TODAY, [
      entry(),
      entry({ kind: "retrieval", certainty: "due", title: "1 question comes back to you" }),
    ]);

    expect(cell.description).toBe(
      "Fri 14 Aug — 25 minutes; 1 question comes back to you",
    );
  });

  it("ignores entries that fall outside the month on screen", () => {
    const weeks = buildMonth({
      month: "2026-08",
      today: TODAY,
      entries: [entry({ day: "2026-12-01" })],
    });
    expect(weeks.flat().every((c) => c.description === null)).toBe(true);
  });
});
