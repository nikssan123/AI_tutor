import { monthGrid, monthOf, shortDate, type DayKey, type MonthKey } from "./dates";
import type { CalendarEntry, Certainty } from "./schedule";

/**
 * The month, as squares.
 *
 * A grid is the one thing on this screen that is a picture rather than a
 * sentence, so it carries the least: a day number, and up to three marks saying
 * *what kind of thing* sits on that day. Everything the marks stand for is
 * written out underneath in "What's coming", and every marked square carries the
 * same words for a reader who is not looking at the colours — §8.5.5 bans colour
 * as the sole carrier of meaning, and a grid is where that rule gets broken.
 */

/** Recorded, then due, then projected: past to promised to guessed at. */
export const CERTAINTIES: Certainty[] = ["recorded", "due", "projected"];

export interface DayCell {
  day: DayKey;
  /** False for the padding days that keep every row seven long. */
  inMonth: boolean;
  isToday: boolean;
  /** Which kinds of mark this day carries, in `CERTAINTIES` order. */
  certainties: Certainty[];
  /**
   * Everything on the day, in the order the schedule put it.
   *
   * The marks can say *what kind* of thing sits on a square and no more, so
   * until this existed the only way to find out which checkpoint landed on the
   * 25th was to read the lists further down the page — or to be using a screen
   * reader, which got the whole sentence. This is what the card on hover reads
   * from, and it is the same rows the lists are built from rather than a second
   * description of them.
   */
  items: CalendarEntry[];
  /** The day and everything on it, in words. Null when the day is empty. */
  description: string | null;
}

export interface MonthInput {
  month: MonthKey;
  today: DayKey;
  entries: CalendarEntry[];
}

export function buildMonth(input: MonthInput): DayCell[][] {
  const byDay = new Map<DayKey, CalendarEntry[]>();
  for (const entry of input.entries) {
    byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  }

  return monthGrid(input.month).map((week) =>
    week.map((day): DayCell => {
      const entries = byDay.get(day) ?? [];
      const present = new Set(entries.map((e) => e.certainty));

      return {
        day,
        inMonth: monthOf(day) === input.month,
        isToday: day === input.today,
        certainties: CERTAINTIES.filter((c) => present.has(c)),
        items: entries,
        description:
          entries.length === 0
            ? null
            : `${shortDate(day)} — ${entries.map((e) => e.title).join("; ")}`,
      };
    }),
  );
}
