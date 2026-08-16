// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CalendarMonth } from "@/components/calendar-month";
import type { DayCell } from "@/lib/calendar/month";
import type { CalendarEntry } from "@/lib/calendar/schedule";

/**
 * The month grid, on its own terms.
 *
 * `tests/app/progress-dates.test.tsx` owns what the *screen* says about dates.
 * What is worth asserting here is the contract the component now has with a
 * second caller: that a projection is never drawn as a fact, that no square
 * carries its meaning in colour alone, and that an empty month says which kind
 * of empty it is. Those are the three things a quoted calendar would break
 * first.
 */

function cell(day: string, over: Partial<DayCell> = {}): DayCell {
  return {
    day,
    inMonth: true,
    isToday: false,
    certainties: [],
    items: [],
    description: null,
    ...over,
  };
}

/** A week of seven, since the grid keys a row off its first day. */
function week(start: number, over: Record<number, Partial<DayCell>> = {}) {
  return Array.from({ length: 7 }, (_, i) => {
    const day = `2026-09-${String(start + i).padStart(2, "0")}`;
    return cell(day, over[start + i] ?? {});
  });
}

const CHECKPOINT: CalendarEntry = {
  day: "2026-09-14",
  kind: "checkpoint",
  certainty: "projected",
  title: "Hand in the query pack",
  detail: "About 6 hours of work between here and it",
};

afterEach(cleanup);

describe("CalendarMonth", () => {
  it("gives every marked day its words, not just its colour", () => {
    // §8.5.5 — a grid of hues is exactly where colour becomes the sole carrier
    // of meaning, so the description is the assertion that matters.
    render(
      <CalendarMonth
        label="September 2026"
        weeks={[
          week(1, {
            3: {
              certainties: ["recorded"],
              description: "3 September: you worked for 45 minutes",
            },
          }),
        ]}
        hasMarks
        next={undefined}
      />,
    );

    expect(
      screen.getByText("3 September: you worked for 45 minutes"),
    ).toBeDefined();
  });

  it("names all three marks in the legend", () => {
    render(
      <CalendarMonth
        label="September 2026"
        weeks={[week(1)]}
        hasMarks
        next={undefined}
      />,
    );

    expect(screen.getByText("You worked")).toBeDefined();
    expect(screen.getByText("Due")).toBeDefined();
    expect(screen.getByText("Projected")).toBeDefined();
  });

  /**
   * The sentence that keeps a projection from reading as a promise. It is on
   * every month, marked or not, because the marks it qualifies are on most of
   * them.
   */
  it("says projected days are not promises", () => {
    render(
      <CalendarMonth
        label="September 2026"
        weeks={[week(1)]}
        hasMarks
        next={undefined}
      />,
    );

    expect(
      screen.getByText(/Nothing on them has been promised to you/),
    ).toBeDefined();
  });

  it("carries what is on a day into the card that explains the square", () => {
    render(
      <CalendarMonth
        label="September 2026"
        weeks={[
          week(8, {
            14: {
              certainties: ["projected"],
              items: [CHECKPOINT],
              description: "14 September: hand in the query pack",
            },
          }),
        ]}
        hasMarks
        next={undefined}
      />,
    );

    expect(screen.getByText("Hand in the query pack")).toBeDefined();
    expect(
      screen.getByText("About 6 hours of work between here and it"),
    ).toBeDefined();
  });

  /**
   * Two empty months, and the difference between them is the whole reason this
   * note exists: "you have nothing" and "your dates are in November" look
   * identical on a grid.
   */
  it("points at the month the dates actually landed in", () => {
    render(
      <CalendarMonth
        label="September 2026"
        weeks={[week(1)]}
        hasMarks={false}
        next={{ ...CHECKPOINT, day: "2026-11-03" }}
      />,
    );

    expect(screen.getByText(/Nothing lands in September 2026\./)).toBeDefined();
    const link = screen.getByRole("link", { name: "November 2026" });
    expect(link.getAttribute("href")).toBe("/progress?month=2026-11");
  });

  it("says a month is empty of everything when there is no next date", () => {
    render(
      <CalendarMonth
        label="September 2026"
        weeks={[week(1)]}
        hasMarks={false}
        next={undefined}
      />,
    );

    expect(screen.getByText(/Days fill in as you work/)).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  /** A marked month says neither of the two empty sentences. */
  it("stays quiet about emptiness when the month has marks", () => {
    render(
      <CalendarMonth
        label="September 2026"
        weeks={[week(1, { 2: { certainties: ["due"] } })]}
        hasMarks
        next={undefined}
      />,
    );

    expect(screen.queryByText(/Nothing lands in/)).toBeNull();
  });

  /**
   * Only days with something to say are tab stops. A month of empty squares
   * that all took focus would be thirty-odd stops between the learner and the
   * next thing on the page.
   */
  it("makes a day a tab stop only when it has something to say", () => {
    render(
      <CalendarMonth
        label="September 2026"
        weeks={[
          week(1, {
            2: { certainties: ["due"], description: "2 September: due" },
          }),
        ]}
        hasMarks
        next={undefined}
      />,
    );

    const stops = screen
      .getAllByRole("listitem")
      .filter((li) => li.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
  });

  it("keeps padding days readable rather than hiding them", () => {
    // A session on the 31st belongs where you would look for it.
    render(
      <CalendarMonth
        label="September 2026"
        weeks={[week(1, { 1: { inMonth: false } })]}
        hasMarks
        next={undefined}
      />,
    );

    expect(screen.getByText("1")).toBeDefined();
  });

  it("marks today", () => {
    render(
      <CalendarMonth
        label="September 2026"
        weeks={[week(1, { 4: { isToday: true } })]}
        hasMarks
        next={undefined}
      />,
    );

    expect(screen.getByText("4").className).toContain("bg-accent");
  });
});
