import { MONTHS } from "@/lib/goals/captured-display";

/**
 * Calendar arithmetic, in whole days.
 *
 * **Days are UTC days**, keyed by the same `YYYY-MM-DD` string the rest of the
 * product already uses — the planner writes `plannedFor: now.slice(0, 10)`, and
 * a goal's deadline is a `date` column. This file does not invent a second
 * notion of what day it is.
 *
 * That is a real limitation and worth naming: a learner who finishes a session
 * at 11pm in Auckland has it recorded on the following UTC day, so their square
 * lands one to the right. Fixing it needs the learner's timezone, which nothing
 * in §15 stores yet. Guessing at it from the server would move dates around for
 * everyone, which is worse than being consistently one boundary off for the few
 * who work either side of UTC midnight.
 *
 * Every function here is arithmetic on that string. Nothing constructs a local
 * `Date` from a date literal — `new Date("2026-08-01")` is UTC midnight, so it
 * formats as 31 July anywhere west of Greenwich (`captured-display.ts` was bitten
 * by exactly that).
 */

/** A calendar day: `YYYY-MM-DD`. */
export type DayKey = string;

/** A calendar month: `YYYY-MM`. */
export type MonthKey = string;

const DAY_MS = 86_400_000;

/** Monday first: this product writes British English and dates it that way. */
export const WEEKDAYS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

function midnight(day: DayKey): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** The day an instant falls on. */
export function dayOf(iso: string): DayKey {
  return iso.slice(0, 10);
}

export function addDays(day: DayKey, delta: number): DayKey {
  return new Date(midnight(day) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from one to the other; negative when `to` is the earlier one. */
export function daysApart(from: DayKey, to: DayKey): number {
  return Math.round((midnight(to) - midnight(from)) / DAY_MS);
}

/** 0 for Monday through 6 for Sunday, matching `WEEKDAYS`. */
export function weekdayIndex(day: DayKey): number {
  return (new Date(midnight(day)).getUTCDay() + 6) % 7;
}

export function monthOf(day: DayKey): MonthKey {
  return day.slice(0, 7);
}

export function firstOfMonth(month: MonthKey): DayKey {
  return `${month}-01`;
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [year, index] = month.split("-").map(Number);
  // Months since year 0, so the year rolls over without a special case.
  const absolute = year! * 12 + (index! - 1) + delta;
  const shifted = String(absolute % 12 + 1).padStart(2, "0");
  return `${String(Math.floor(absolute / 12)).padStart(4, "0")}-${shifted}`;
}

/** `2026-08` → `August 2026`. */
export function monthLabel(month: MonthKey): string {
  const [year, index] = month.split("-");
  return `${MONTHS[Number(index) - 1]} ${year}`;
}

/** `2026-08-18` → `Tue 18 Aug` — the form a list of dates reads best in. */
export function shortDate(day: DayKey): string {
  const [, month, date] = day.split("-");
  const name = MONTHS[Number(month) - 1]!.slice(0, 3);
  return `${WEEKDAYS[weekdayIndex(day)]} ${Number(date)} ${name}`;
}

/**
 * How far off a day is, in the words a person would use.
 *
 * Beside a date rather than instead of one: "Tue 18 Aug" is what you check
 * against your own week, "in 4 days" is what tells you whether to care now.
 */
export function relativeDay(from: DayKey, to: DayKey): string {
  const days = daysApart(from, to);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const size = Math.abs(days);
  return days > 0 ? `in ${size} days` : `${size} days ago`;
}

/**
 * A query string is user input, and `?month=lol` must not render `NaN`.
 * Rejecting rather than repairing: a month we cannot read is not a month the
 * learner meant, so the screen falls back to the one they are in.
 */
export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * The month laid out as whole weeks, padded from the previous and next months
 * so every row has seven days in it.
 *
 * The padding days are real days rather than blanks: a session on 31 July shows
 * up in August's leading row where the learner would look for it, and the cell
 * knows it is out of month so it can be drawn quietly.
 */
export function monthGrid(month: MonthKey): DayKey[][] {
  const first = firstOfMonth(month);
  const last = addDays(firstOfMonth(shiftMonth(month, 1)), -1);
  const start = addDays(first, -weekdayIndex(first));
  const total = daysApart(start, last) + (6 - weekdayIndex(last)) + 1;

  const weeks: DayKey[][] = [];
  for (let offset = 0; offset < total; offset += 7) {
    weeks.push(
      Array.from({ length: 7 }, (_, index) => addDays(start, offset + index)),
    );
  }
  return weeks;
}
