import { describe, expect, it } from "vitest";
import {
  aheadListPayload,
  calendarMonthPayload,
  summarise,
} from "@/lib/assistant/widgets";
import type { CalendarView } from "@/lib/calendar/view";
import type { CalendarEntry } from "@/lib/calendar/schedule";

/**
 * The contract between a tool and a component.
 *
 * `summarise` is where §2.1 is actually enforced, so most of this file is one
 * question asked several ways: does the sentence handed to the model contain
 * anything the model could read back to somebody already looking at the view?
 */

const entry = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  day: "2026-09-05",
  kind: "retrieval",
  certainty: "due",
  title: "Window functions",
  detail: "Coming back round",
  ...over,
});

function view(over: Partial<CalendarView> = {}): CalendarView {
  return {
    label: "September 2026",
    today: "2026-09-03",
    weeks: [
      [
        {
          day: "2026-09-01",
          inMonth: true,
          isToday: false,
          certainties: ["recorded"],
          items: [],
          description: "1 September: you worked",
        },
        {
          day: "2026-09-02",
          inMonth: true,
          isToday: false,
          certainties: [],
          items: [],
          description: null,
        },
        {
          day: "2026-09-03",
          inMonth: true,
          isToday: true,
          certainties: ["due"],
          items: [entry({ day: "2026-09-03" })],
          description: "3 September: due",
        },
      ],
    ],
    hasMarks: true,
    next: undefined,
    ahead: [],
    checkpoints: [],
    ...over,
  } as unknown as CalendarView;
}

describe("calendarMonthPayload", () => {
  it("sends the four fields the grid reads, and nothing else", () => {
    const payload = calendarMonthPayload(view());

    expect(Object.keys(payload).sort()).toEqual([
      "hasMarks",
      "label",
      "next",
      "weeks",
    ]);
  });

  /**
   * `undefined` does not survive `JSON.stringify` — the key vanishes, and "no
   * next date" becomes indistinguishable from "this build forgot to send one".
   */
  it("puts null on the wire where the view had nothing", () => {
    expect(calendarMonthPayload(view()).next).toBeNull();
  });

  it("carries a real next date through", () => {
    const next = entry({ day: "2026-11-03" });
    expect(calendarMonthPayload(view({ next })).next).toEqual(next);
  });

  /** The pack and the goal ride on a CalendarView and have no business on a
      wire the panel reads — everything not sent is something it cannot start
      depending on. */
  it("leaves the pack and the goal behind", () => {
    const payload = calendarMonthPayload(view()) as unknown as Record<
      string,
      unknown
    >;
    expect(payload.pack).toBeUndefined();
    expect(payload.goal).toBeUndefined();
  });
});

describe("aheadListPayload", () => {
  it("sends what is ahead, today, and whether checkpoints explain an empty list", () => {
    const payload = aheadListPayload(view({ ahead: [entry()] }));

    expect(payload.today).toBe("2026-09-03");
    expect(payload.entries).toEqual([entry()]);
    expect(payload.hasCheckpoints).toBe(false);
  });

  it("reports checkpoints as a fact rather than sending them", () => {
    const payload = aheadListPayload(
      view({
        checkpoints: [
          {
            title: "Hand-in",
            day: "2026-10-01",
            dayAtActualPace: null,
            hoursAway: 6,
            graded: true,
          },
        ],
      }),
    );

    expect(payload.hasCheckpoints).toBe(true);
    expect(payload).not.toHaveProperty("checkpoints");
  });
});

describe("summarise", () => {
  it("tells the model a calendar is up, and not what is on it", () => {
    const line = summarise({
      widget: "calendar_month",
      payload: calendarMonthPayload(view()),
    });

    expect(line).toContain("September 2026");
    expect(line).toContain("2 days have");
    expect(line).toContain("Do not list the dates");
    // The dates themselves, which are the thing it must not be able to repeat.
    expect(line).not.toContain("2026-09-01");
    expect(line).not.toContain("Window functions");
  });

  it("counts one marked day in the singular", () => {
    const line = summarise({
      widget: "calendar_month",
      payload: calendarMonthPayload(
        view({
          weeks: [
            [
              {
                day: "2026-09-01",
                inMonth: true,
                isToday: false,
                certainties: ["recorded"],
                items: [],
                description: "worked",
              },
            ],
          ],
        } as Partial<CalendarView>),
      ),
    });

    expect(line).toContain("1 day has");
  });

  it("counts what is ahead without naming any of it", () => {
    const line = summarise({
      widget: "ahead_list",
      payload: aheadListPayload(view({ ahead: [entry(), entry()] })),
    });

    expect(line).toContain("2 things are");
    expect(line).toContain("Do not list them");
    expect(line).not.toContain("Window functions");
  });

  it("says how much of it is overdue, which is the actionable part", () => {
    const line = summarise({
      widget: "ahead_list",
      payload: aheadListPayload(
        view({ ahead: [entry({ day: "2026-09-01" }), entry()] }),
      ),
    });

    expect(line).toContain("1 overdue");
  });

  it("does not mention overdue when nothing is", () => {
    const line = summarise({
      widget: "ahead_list",
      payload: aheadListPayload(view({ ahead: [entry()] })),
    });

    expect(line).toContain("1 thing is");
    expect(line).not.toContain("overdue");
  });

  /** A projection that has not happened is not overdue, whatever its date. */
  it("counts only what was actually owed as overdue", () => {
    const line = summarise({
      widget: "ahead_list",
      payload: aheadListPayload(
        view({ ahead: [entry({ day: "2026-09-01", certainty: "projected" })] }),
      ),
    });

    expect(line).not.toContain("overdue");
  });

  it("lets the empty list speak for itself", () => {
    const line = summarise({
      widget: "ahead_list",
      payload: aheadListPayload(view({ ahead: [] })),
    });

    expect(line).toContain("Nothing is due");
  });
});
