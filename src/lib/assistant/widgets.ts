import type { DayKey } from "@/lib/calendar/dates";
import type { DayCell } from "@/lib/calendar/month";
import type { CalendarEntry } from "@/lib/calendar/schedule";
import type { CalendarView } from "@/lib/calendar/view";
import type { Digest } from "@/lib/mastery/digest";
import type { CourseSummary } from "@/components/course-list";
import type { PlanId } from "@/lib/billing/catalog";

/**
 * What a tool may put on screen — `ASSISTANT-PLAN.md` §2.
 *
 * The contract between a tool and a component, and the reason the model is not
 * in the middle of it. A tool projects the learner's own data into one of these
 * shapes; the frame carries it verbatim; a real component renders it. The model
 * chose *which* widget by choosing which tool, and never saw what is in it.
 *
 * **Types, not Zod schemas.** The plan asked for Zod, and the plan was thinking
 * about a model boundary — which this is not. Every payload here is projected
 * from a value `calendarFor` already typed, so a runtime parse would re-check
 * what `tsc` has already proved and buy nothing. What *is* worth guarding is
 * the wire: the panel gets `unknown` out of `JSON.parse`, and a version skew
 * could hand it a payload this build's component cannot render. That guard
 * lives in the panel as a few lines of structural check per widget, which keeps
 * Zod out of the one bundle a signed-in learner receives.
 *
 * These types are the single source of truth for both sides, so drift between a
 * tool and its component is a compile error rather than a runtime one.
 */

export interface CalendarMonthPayload {
  label: string;
  weeks: DayCell[][];
  hasMarks: boolean;
  /**
   * Null rather than absent.
   *
   * `CalendarMonth` takes `CalendarEntry | undefined`, but `undefined` does not
   * survive `JSON.stringify` — the key simply vanishes, and "no next date" and
   * "this build forgot to send one" become the same thing on the wire. The
   * panel converts it back on arrival.
   */
  next: CalendarEntry | null;
}

export interface AheadListPayload {
  today: DayKey;
  entries: CalendarEntry[];
  hasCheckpoints: boolean;
}

export interface WeekDigestPayload {
  digest: Digest;
}

export interface CourseListPayload {
  courses: CourseSummary[];
}

export interface PlanCardPayload {
  planId: PlanId;
  /** `YYYY-MM-DD`, or null where there is no paid-for window. */
  renewsOn: string | null;
}

/** Every widget, by the name that travels on the wire. */
export type WidgetView =
  | { widget: "calendar_month"; payload: CalendarMonthPayload }
  | { widget: "ahead_list"; payload: AheadListPayload }
  | { widget: "week_digest"; payload: WeekDigestPayload }
  | { widget: "course_list"; payload: CourseListPayload }
  | { widget: "plan_card"; payload: PlanCardPayload };

export type WidgetName = WidgetView["widget"];

/**
 * Every widget name, as a value.
 *
 * `satisfies` rather than a plain array, so adding a member to `WidgetView`
 * without listing it here is a type error. A stored layout is read back against
 * this list, and a name missing from it would silently drop a view that this
 * build can in fact render.
 */
export const WIDGET_NAMES = [
  "calendar_month",
  "ahead_list",
  "week_digest",
  "course_list",
  "plan_card",
] as const satisfies readonly WidgetName[];

/**
 * One turn's layout: prose and views, in the order they arrived.
 *
 * Lives here rather than in the panel because both ends need it — the route
 * builds the list as it streams, the panel redraws from it, and the database
 * stores it between the two. Arrival order is the only order that reads
 * correctly: a tool runs *before* the sentence that introduces its result, so
 * appending views would put every calendar underneath the words explaining it.
 */
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "view"; view: WidgetView };

/**
 * Prose onto the end of a turn: extending the last passage if that is what it
 * is, opening a new one if a view came between.
 */
export function appendText(segments: Segment[], text: string): Segment[] {
  const last = segments[segments.length - 1];

  return last?.kind === "text"
    ? [...segments.slice(0, -1), { kind: "text", text: last.text + text }]
    : [...segments, { kind: "text", text }];
}

/**
 * The month, as the grid needs it.
 *
 * Four fields out of a `CalendarView` that also carries the whole pack and the
 * learner's goal. Projecting rather than passing it along is not only about
 * size: everything not sent is something the panel cannot accidentally start
 * depending on, and the payload is the contract.
 */
export function calendarMonthPayload(view: CalendarView): CalendarMonthPayload {
  return {
    label: view.label,
    weeks: view.weeks,
    hasMarks: view.hasMarks,
    next: view.next ?? null,
  };
}

export function aheadListPayload(view: CalendarView): AheadListPayload {
  return {
    today: view.today,
    entries: view.ahead,
    hasCheckpoints: view.checkpoints.length > 0,
  };
}

/**
 * The one-line summary the model is given instead of the payload (§2.1).
 *
 * Deliberately thin. It says what is now on screen and how much of it, so the
 * model can write a sentence *around* the view — and it withholds the figures,
 * so the model cannot read the calendar back to somebody already looking at it.
 * That is the rule §7 states and this is what makes it structural.
 */
export function summarise(view: WidgetView): string {
  switch (view.widget) {
    case "calendar_month": {
      const marked = view.payload.weeks
        .flat()
        .filter((cell) => cell.certainties.length > 0).length;
      return `Their calendar for ${view.payload.label} is now on screen: ${marked} ${marked === 1 ? "day has" : "days have"} something on them. Do not list the dates.`;
    }
    case "ahead_list": {
      const { entries } = view.payload;
      const overdue = entries.filter(
        (entry) => entry.certainty === "due" && entry.day < view.payload.today,
      ).length;
      return entries.length === 0
        ? "Nothing is due. The list on screen says so and says why."
        : `${entries.length} ${entries.length === 1 ? "thing is" : "things are"} ahead of them${overdue > 0 ? `, ${overdue} overdue` : ""}, now on screen. Do not list them.`;
    }
    case "week_digest": {
      const { digest } = view.payload;
      return `Their week is on screen: ${digest.moved.length} ${digest.moved.length === 1 ? "skill" : "skills"} moved, ${digest.slipping} of ${digest.tracked} slipping. Do not repeat the numbers, and do not tell them whether it is good.`;
    }
    case "course_list": {
      const { courses } = view.payload;
      const running = courses.filter((course) => course.status === "active").length;
      return courses.length === 0
        ? "They have no courses at all. Say so, and offer the subjects page."
        : `${courses.length} ${courses.length === 1 ? "course" : "courses"} on screen, ${running} running. Do not list them. They can start, pause or stop a course on the progress page — you cannot.`;
    }
    case "plan_card":
      return `Their plan is on screen: ${view.payload.planId}. Do not read the features back to them. Anything they want changed happens on the billing page, which the card links to.`;
  }
}
