// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AheadList } from "@/components/ahead-list";
import type { CalendarEntry } from "@/lib/calendar/schedule";

/**
 * What is coming, on its own terms.
 *
 * `tests/app/progress-dates.test.tsx` owns what the screen says; this owns the
 * contract the list now has with a second caller. Two things carry the weight:
 * "Waiting" is only ever said about something that was actually owed, and an
 * empty list distinguishes "you have nothing" from "your work is dated
 * somewhere else".
 */

const TODAY = "2026-09-03";

const entry = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  day: "2026-09-05",
  kind: "retrieval",
  certainty: "due",
  title: "Window functions",
  detail: "Coming back round",
  ...over,
});

afterEach(cleanup);

describe("AheadList", () => {
  it("lists what is coming, with what each thing is", () => {
    render(<AheadList entries={[entry()]} today={TODAY} hasCheckpoints={false} />);

    expect(screen.getByText("Window functions")).toBeDefined();
    expect(screen.getByText("Coming back round")).toBeDefined();
  });

  it("marks something owed and past as waiting, not as a date", () => {
    render(
      <AheadList
        entries={[entry({ day: "2026-09-01" })]}
        today={TODAY}
        hasCheckpoints={false}
      />,
    );

    expect(screen.getByText("Waiting")).toBeDefined();
  });

  /**
   * A projection that has not happened is not overdue — it is where the
   * arithmetic points, and §4.2 law 3 forbids drawing it as a fact.
   */
  it("never calls a projection overdue, however old its date", () => {
    render(
      <AheadList
        entries={[entry({ day: "2026-08-01", certainty: "projected" })]}
        today={TODAY}
        hasCheckpoints={false}
      />,
    );

    expect(screen.queryByText("Waiting")).toBeNull();
  });

  it("sets a future date rather than a status", () => {
    render(<AheadList entries={[entry()]} today={TODAY} hasCheckpoints={false} />);

    expect(screen.queryByText("Waiting")).toBeNull();
    // The date is the reason the row is in the list at all.
    expect(screen.getByText(/5 Sep/)).toBeDefined();
  });

  it("says plainly when nothing is waiting", () => {
    render(<AheadList entries={[]} today={TODAY} hasCheckpoints={false} />);

    expect(
      screen.getByText(/Nothing is waiting on you and nothing is due/),
    ).toBeDefined();
  });

  /**
   * The empty state that stops a freshly built path reading as "the build
   * produced nothing" — there are five dated hand-ins, they are simply not in
   * this list.
   */
  it("says where the dated work went when there is some", () => {
    render(<AheadList entries={[]} today={TODAY} hasCheckpoints />);

    expect(screen.getByText(/progress page/)).toBeDefined();
  });

  it("lets the caller point somewhere nearer when there is one", () => {
    render(
      <AheadList
        entries={[]}
        today={TODAY}
        hasCheckpoints
        pendingNote="What you are working towards is dated below."
      />,
    );

    expect(screen.getByText(/dated below/)).toBeDefined();
    expect(screen.queryByText(/progress page/)).toBeNull();
  });
});
