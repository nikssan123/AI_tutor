import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOf,
  daysApart,
  firstOfMonth,
  isMonthKey,
  monthGrid,
  monthLabel,
  monthOf,
  relativeDay,
  shiftMonth,
  shortDate,
  weekdayIndex,
  WEEKDAYS,
} from "@/lib/calendar/dates";

/**
 * Calendar arithmetic. Every case here is a date that would be *wrong by one*
 * under the obvious implementation — the month boundary, the year boundary, the
 * leap day, and the west-of-Greenwich reader who would otherwise see yesterday.
 */

describe("days", () => {
  it("takes the day off an instant", () => {
    expect(dayOf("2026-08-14T23:59:59.999Z")).toBe("2026-08-14");
  });

  it("adds and subtracts across a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("adds across a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("counts the leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysApart("2028-02-01", "2028-03-01")).toBe(29);
  });

  it("counts backwards as a negative", () => {
    expect(daysApart("2026-08-14", "2026-08-07")).toBe(-7);
  });

  /**
   * The whole reason this file does string arithmetic rather than local `Date`
   * maths: `new Date("2026-08-01")` is UTC midnight, so anywhere west of
   * Greenwich it formats as 31 July. A day that moves with the reader is not a
   * small bug on a calendar.
   */
  it("does not shift with the runtime's timezone", () => {
    const before = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(addDays("2026-08-01", 0)).toBe("2026-08-01");
      expect(dayOf("2026-08-01T00:00:00.000Z")).toBe("2026-08-01");
    } finally {
      process.env.TZ = before;
    }
  });
});

describe("weekdays", () => {
  it("puts Monday first", () => {
    expect(WEEKDAYS[0]).toBe("Mon");
    expect(weekdayIndex("2026-08-31")).toBe(0);
  });

  it("puts Sunday last", () => {
    expect(weekdayIndex("2026-02-01")).toBe(6);
  });

  it("names a day the way a person writing a list would", () => {
    expect(shortDate("2026-08-14")).toBe("Fri 14 Aug");
    // No leading zero: "Fri 04 Sep" is a serial number, not a date.
    expect(shortDate("2026-09-04")).toBe("Fri 4 Sep");
  });
});

describe("months", () => {
  it("reads a month off a day", () => {
    expect(monthOf("2026-08-14")).toBe("2026-08");
    expect(firstOfMonth("2026-08")).toBe("2026-08-01");
  });

  it("rolls the year over in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-01", -13)).toBe("2024-12");
    expect(shiftMonth("2026-08", 0)).toBe("2026-08");
  });

  it("names a month the way the intake screen names a deadline", () => {
    expect(monthLabel("2026-08")).toBe("August 2026");
    expect(monthLabel("2026-01")).toBe("January 2026");
  });

  it.each([
    ["2026-08", true],
    ["2026-01", true],
    ["2026-12", true],
    ["2026-00", false],
    ["2026-13", false],
    ["2026-8", false],
    ["lol", false],
    ["", false],
    ["2026-08-14", false],
  ])("reads %s as a month: %s", (value, valid) => {
    expect(isMonthKey(value)).toBe(valid);
  });
});

describe("the grid", () => {
  it("pads to whole weeks from the months either side", () => {
    // August 2026 opens on a Saturday and closes on a Monday, so it needs five
    // days of July in front of it and six of September behind.
    const weeks = monthGrid("2026-08");
    expect(weeks).toHaveLength(6);
    expect(weeks[0]![0]).toBe("2026-07-27");
    expect(weeks[5]![6]).toBe("2026-09-06");
  });

  it("gives every row seven days, starting on a Monday", () => {
    for (const month of ["2026-02", "2026-08", "2026-11", "2028-02"]) {
      for (const week of monthGrid(month)) {
        expect(week).toHaveLength(7);
        expect(weekdayIndex(week[0]!)).toBe(0);
      }
    }
  });

  it("holds every day of the month exactly once", () => {
    const days = monthGrid("2028-02").flat().filter((d) => monthOf(d) === "2028-02");
    // A leap February, which is the month an off-by-one loses.
    expect(days).toHaveLength(29);
    expect(new Set(days).size).toBe(29);
    expect(days.at(-1)).toBe("2028-02-29");
  });

  it("fits a short month into five rows", () => {
    expect(monthGrid("2026-02")).toHaveLength(5);
  });
});

describe("relative days", () => {
  it.each([
    ["2026-08-14", "today"],
    ["2026-08-15", "tomorrow"],
    ["2026-08-13", "yesterday"],
    ["2026-08-18", "in 4 days"],
    ["2026-08-07", "7 days ago"],
  ])("reads %s as %s", (day, expected) => {
    expect(relativeDay("2026-08-14", day)).toBe(expected);
  });
});
