import { addDays, type DayKey } from "./dates";
import type { Checkpoint } from "./checkpoints";

/**
 * Everything the calendar has a date for, turned into rows a learner can read.
 *
 * The axis that matters is **certainty**, not category. A session that happened
 * and a checkpoint the arithmetic lands on in November are both squares on a
 * grid, and drawing them the same way would be the calendar quietly claiming to
 * know the future. So every entry declares which of three things it is, the
 * screen marks each one differently, and the legend says so in words.
 *
 * No sentence in this file names a mechanism. A learner is told a skill "stops
 * counting", not that its half-life has run out — the consequence is theirs, the
 * mechanism is ours.
 */

/**
 * - `recorded` · it happened, and we have the row to prove it
 * - `due` · a date the schedule or the learner already fixed
 * - `projected` · where the arithmetic lands, given a pace or a curve
 */
export type Certainty = "recorded" | "due" | "projected";

export type EntryKind =
  | "session"
  | "retrieval"
  | "lapse"
  | "checkpoint"
  | "deadline";

export interface CalendarEntry {
  day: DayKey;
  kind: EntryKind;
  certainty: Certainty;
  title: string;
  detail: string;
}

/** One day's work, as the sessions table recorded it. */
export interface WorkedDay {
  day: DayKey;
  minutes: number;
  sessions: number;
}

/** One skill coming back round, from the spaced-retrieval queue. */
export interface DueSkill {
  day: DayKey;
  skillName: string;
}

export interface ScheduleInput {
  worked: WorkedDay[];
  /** Queued retrieval, one row per item; days with several are merged below. */
  retrieval: DueSkill[];
  /** Claims with a date on which they stop counting. */
  lapses: DueSkill[];
  checkpoints: Checkpoint[];
  /** The learner's own deadline, and what they set it for. */
  deadline: string | null;
  targetOutcome: string;
}

/** Within a day: what happened, then what is owed, then what is guessed at. */
const KIND_ORDER: EntryKind[] = [
  "session",
  "retrieval",
  "lapse",
  "checkpoint",
  "deadline",
];

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sessionEntry(day: WorkedDay): CalendarEntry {
  return {
    day: day.day,
    kind: "session",
    certainty: "recorded",
    title: count(day.minutes, "minute", "minutes"),
    detail: `You sat down ${count(day.sessions, "time", "times")}.`,
  };
}

/**
 * Merged per day rather than one row per item. "Four questions come back on
 * Tuesday" is the fact; four identical rows on one square is a wall.
 */
function retrievalEntries(due: DueSkill[]): CalendarEntry[] {
  const byDay = new Map<DayKey, string[]>();
  for (const item of due) {
    byDay.set(item.day, [...(byDay.get(item.day) ?? []), item.skillName]);
  }

  return [...byDay].map(([day, names]) => ({
    day,
    kind: "retrieval" as const,
    certainty: "due" as const,
    title: `${count(names.length, "question", "questions")} ${
      names.length === 1 ? "comes" : "come"
    } back to you`,
    detail: [...new Set(names)].join(" · "),
  }));
}

export function buildEntries(input: ScheduleInput): CalendarEntry[] {
  const entries: CalendarEntry[] = [
    ...input.worked.map(sessionEntry),
    ...retrievalEntries(input.retrieval),
    ...input.lapses.map(
      (lapse): CalendarEntry => ({
        day: lapse.day,
        kind: "lapse",
        certainty: "projected",
        title: `${lapse.skillName} stops counting`,
        detail: "You showed this once. A few minutes on it keeps the claim.",
      }),
    ),
    ...input.checkpoints.map(
      (checkpoint): CalendarEntry => ({
        day: checkpoint.day,
        kind: "checkpoint",
        certainty: "projected",
        title: checkpoint.title,
        detail: checkpoint.graded
          ? "Something to hand in and have marked against the rubric."
          : "Something to make and hand in.",
      }),
    ),
  ];

  if (input.deadline !== null) {
    entries.push({
      day: input.deadline,
      kind: "deadline",
      certainty: "due",
      title: "The date you set yourself",
      detail: input.targetOutcome,
    });
  }

  return entries.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.title.localeCompare(b.title),
  );
}

/* ── The commitment ─────────────────────────────────────────────────────── */

/**
 * §2.4 — "it holds you accountable". The one number this product is allowed to
 * keep a streak on.
 *
 * **Weeks, not days.** A daily streak would punish someone whose plan is three
 * hours a week for not turning up on a Tuesday, which is a lie about their own
 * plan — and §17 bans gamification beyond a streak precisely so the one streak
 * we keep has to mean something. This one is measured against the commitment
 * the learner set themselves.
 *
 * The week in progress counts if it has already been met and is never counted
 * against them: a streak that breaks on Monday morning because the week is young
 * is a guilt mechanic, and §8 screen 6 spends a whole interaction ("Not today")
 * refusing to build those.
 */
export const STREAK_LOOKBACK_WEEKS = 52;

export interface Commitment {
  weeklyHours: number;
  /** Rolling weeks in a row the commitment was met, most recent first. */
  weeksKept: number;
  thisWeekHours: number;
  keptThisWeek: boolean;
}

/** One decimal, then compared — the same order `digest.ts` does it in, so the
 *  two screens cannot disagree about whether a week was kept. */
function hoursIn(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

export interface CommitmentInput {
  worked: WorkedDay[];
  weeklyHours: number;
  today: DayKey;
}

export function commitmentFrom(input: CommitmentInput): Commitment {
  const minutesByDay = new Map(input.worked.map((d) => [d.day, d.minutes]));

  /** Window 0 is the seven days ending today; window 1 the seven before it. */
  const hoursInWeek = (week: number): number => {
    let minutes = 0;
    for (let day = 0; day < 7; day += 1) {
      minutes += minutesByDay.get(addDays(input.today, -(week * 7 + day))) ?? 0;
    }
    return hoursIn(minutes);
  };

  const thisWeekHours = hoursInWeek(0);
  const keptThisWeek = thisWeekHours >= input.weeklyHours;

  let weeksKept = 0;
  for (
    let week = keptThisWeek ? 0 : 1;
    week < STREAK_LOOKBACK_WEEKS;
    week += 1
  ) {
    if (hoursInWeek(week) < input.weeklyHours) break;
    weeksKept += 1;
  }

  return {
    weeklyHours: input.weeklyHours,
    weeksKept,
    thisWeekHours,
    keptThisWeek,
  };
}
