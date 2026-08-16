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

  const DIGEST = {
    hoursLogged: 3.5,
    committedHours: 4,
    keptCommitment: false,
    sessions: 2,
    moved: [{ name: "Window functions", delta: 0.2 }],
    artefacts: 1,
    remainingHours: 20,
    weeksAtCommitment: 5,
    weeksAtActualPace: 6,
    tracked: 4,
    slipping: 1,
  };

  /**
   * The one summary that forbids a verdict as well as a recital. §4.2 law 1
   * puts mastery on evidence, and a cheerful "great week!" over a digest the
   * learner can read is the assistant claiming an authority it does not have.
   */
  it("tells the model not to judge the week it just put up", () => {
    const line = summarise({
      widget: "week_digest",
      payload: { digest: DIGEST },
    });

    expect(line).toContain("1 skill moved");
    expect(line).toContain("do not tell them whether it is good");
    expect(line).not.toContain("Window functions");
  });

  it("counts what is running, and names none of the courses", () => {
    const line = summarise({
      widget: "course_list",
      payload: {
        courses: [
          {
            goalId: "g1",
            name: "SQL for data analysis",
            taxonomyParent: null,
            status: "active",
          },
          {
            goalId: "g2",
            name: "Photography",
            taxonomyParent: null,
            status: "paused",
          },
        ],
      },
    });

    expect(line).toContain("2 courses on screen, 1 running");
    expect(line).not.toContain("SQL for data analysis");
    // §9.2 — where the learner can act, and that the assistant cannot.
    expect(line).toContain("you cannot");
  });

  it("says plainly when there are no courses at all", () => {
    const line = summarise({ widget: "course_list", payload: { courses: [] } });
    expect(line).toContain("no courses at all");
  });

  it("names the plan and ends at the page that can change it", () => {
    const line = summarise({
      widget: "plan_card",
      payload: { planId: "pro", renewsOn: "2026-10-01" },
    });

    expect(line).toContain("pro");
    expect(line).toContain("billing page");
    // The features are on the card; reading them back is the double-render
    // §2.1 exists to prevent.
    expect(line).toContain("Do not read the features back");
  });
});
