import type { Db } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import { activeGoal, masteryFor, type StoredGoal } from "@/lib/goals/store";
import { currentCurriculum } from "@/lib/curriculum/store";
import { artefactEvidence } from "@/lib/mastery/store";
import { buildLedger } from "@/lib/mastery/ledger";
import { dueRetrieval } from "@/lib/session/store";
import { toEngineGraph } from "@/lib/packs/validate";
import { effectiveMastery } from "@/lib/engine/bkt";
import { remainingHoursFor } from "@/lib/engine/scoring";
import type { DomainPack } from "@/lib/packs/types";
import type { RetrievalCandidate } from "@/lib/engine";
import {
  addDays,
  dayOf,
  firstOfMonth,
  isMonthKey,
  monthLabel,
  monthOf,
  shiftMonth,
  type DayKey,
  type MonthKey,
} from "./dates";
import { buildMonth, type DayCell } from "./month";
import { claimLapses } from "./lapse";
import { projectCheckpoints, type Checkpoint } from "./checkpoints";
import {
  buildEntries,
  commitmentFrom,
  STREAK_LOOKBACK_WEEKS,
  type CalendarEntry,
  type Commitment,
  type DueSkill,
} from "./schedule";
import { workedDays } from "./store";

/**
 * Everything `/calendar` needs, assembled from rows the product already has.
 *
 * Kept out of the page for the reason `goals/today.ts` and `mastery/view.ts`
 * give: what is worth testing is which dates reach the screen, and a render test
 * would check the sentence they produced instead.
 *
 * **Nothing here is a new source of truth.** The retrieval dates come from the
 * queue the planner reads, the lapse dates from the ledger `/mastery` builds,
 * the remaining hours from the same `remainingHoursFor` the path screen quotes,
 * and the pace actually kept from the same rolling seven days `/progress` prices
 * its second estimate at. A calendar that computed its own version of any of
 * those would be a fourth screen quietly disagreeing with three others.
 */

/** How many dated things the "what's coming" list will name. */
export const AHEAD_LIMIT = 8;

/** Enough queue rows to fill a month; the planner reads far fewer per session. */
export const QUEUE_DEPTH = 60;

/**
 * A checkpoint is dated in its own band, with the two paces beside it, so it is
 * kept out of "what's coming" rather than printed twice on one screen. The two
 * lists then mean different things: what the plan asks *of* you, and what you
 * are heading *towards*.
 */
const IN_AHEAD = (entry: CalendarEntry): boolean =>
  entry.certainty !== "recorded" && entry.kind !== "checkpoint";

export interface CalendarView {
  goal: StoredGoal;
  pack: DomainPack;
  month: MonthKey;
  label: string;
  previousMonth: MonthKey;
  nextMonth: MonthKey;
  today: DayKey;
  weeks: DayCell[][];
  /** Overdue first, then soonest — everything that has not happened yet. */
  ahead: CalendarEntry[];
  checkpoints: Checkpoint[];
  commitment: Commitment;
  deadline: string | null;
  /** False when no path has been built, so there are no checkpoints to date. */
  hasPath: boolean;
  /**
   * Whether the month on screen has anything on it at all.
   *
   * A learner who has just had their path built has five dated checkpoints and
   * a month that shows one of them, or none — the rest are September, October,
   * November. The grid then reads as "the calendar is empty", which is a
   * misreading it invites: the dates exist, they are simply not in this view.
   * So the screen is given the fact rather than left to infer it from a grid it
   * cannot count.
   */
  hasMarks: boolean;
  /**
   * The next dated thing the month on screen does not reach.
   *
   * Undefined when there is genuinely nothing ahead, which is a different
   * sentence and a different offer: one is "look later", the other is "there is
   * nothing to look at yet".
   */
  next: CalendarEntry | undefined;
}

export interface CalendarOptions {
  /** `?month=2026-09`. Anything unreadable falls back to the month we are in. */
  month?: string | undefined;
}

/**
 * The window of sessions to read, wide enough for both jobs at once: the month
 * on screen, and the year of weeks behind today that the streak counts over.
 *
 * One read rather than two because the two windows usually overlap, and asking
 * the database twice for the same August would be paying for the tidier code.
 */
export function readRange(
  month: MonthKey,
  today: DayKey,
): { from: Date; to: Date } {
  const streakStart = addDays(today, -(STREAK_LOOKBACK_WEEKS * 7));
  const monthStart = firstOfMonth(month);
  const monthEnd = addDays(firstOfMonth(shiftMonth(month, 1)), -1);

  return {
    from: new Date(
      `${monthStart < streakStart ? monthStart : streakStart}T00:00:00.000Z`,
    ),
    to: new Date(`${monthEnd > today ? monthEnd : today}T23:59:59.999Z`),
  };
}

/** Queue rows in the pack's own words. A skill the pack no longer names is
 *  dropped rather than shown as a slug, for the reason `masteryFor` gives: a
 *  removed skill must not reappear as a mystery entry in someone's month. */
export function dueSkills(
  queue: RetrievalCandidate[],
  names: Map<string, string>,
): DueSkill[] {
  return queue.flatMap((item) => {
    const skillName = names.get(item.skillId);
    return skillName === undefined
      ? []
      : [{ day: dayOf(item.dueAt), skillName }];
  });
}

export async function calendarFor(
  db: Db,
  userId: string,
  now: Date,
  options: CalendarOptions = {},
): Promise<CalendarView | undefined> {
  const goal = await activeGoal(db, userId);
  if (!goal) return undefined;

  // A goal can outlive the pack it was created against — a pack removed from
  // disk is a deployment event, not a corrupt row — so this degrades to the
  // "no goal yet" screen exactly as `/today` and `/mastery` do.
  const pack = await resolvePack(db, goal.packSlug);
  if (!pack) return undefined;

  const nowIso = now.toISOString();
  const today = dayOf(nowIso);
  const month =
    options.month !== undefined && isMonthKey(options.month)
      ? options.month
      : monthOf(today);

  const [mastery, worked, queue, evidence, curriculum] = await Promise.all([
    masteryFor(db, userId, goal.packSlug),
    workedDays(db, { userId, goalId: goal.id, ...readRange(month, today) }),
    dueRetrieval(db, userId, goal.packSlug, QUEUE_DEPTH),
    artefactEvidence(db, userId, goal.packSlug),
    currentCurriculum(db, goal.id),
  ]);

  const names = new Map(pack.skills.map((s) => [s.slug, s.name]));
  const ledger = buildLedger({
    skills: pack.skills,
    mastery,
    evidence,
    now: nowIso,
  });

  const commitment = commitmentFrom({
    worked,
    weeklyHours: goal.spec.weeklyHours,
    today,
  });

  const graph = toEngineGraph(pack);
  const byId = new Map(mastery.map((m) => [m.skillId, m]));
  const remaining = new Map(
    graph.skills.map((skill) => {
      const state = byId.get(skill.id);
      return [
        skill.id,
        remainingHoursFor(skill, state ? effectiveMastery(state, nowIso) : 0),
      ];
    }),
  );

  const checkpoints = projectCheckpoints({
    modules: curriculum?.modules ?? [],
    remainingHours: remaining,
    weeklyHours: goal.spec.weeklyHours,
    // The same window `/progress` prices its second estimate at, deliberately:
    // one definition of "the pace you actually kept" in the product.
    actualWeeklyHours: commitment.thisWeekHours,
    today,
  });

  const entries = buildEntries({
    worked,
    retrieval: dueSkills(queue, names),
    lapses: claimLapses({ claims: ledger.canDo, mastery: byId, now: nowIso }),
    checkpoints,
    deadline: goal.spec.deadline,
    targetOutcome: goal.spec.targetOutcome,
  });

  const weeks = buildMonth({ month, today, entries });

  return {
    goal,
    pack,
    month,
    label: monthLabel(month),
    previousMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    today,
    weeks,
    ahead: entries.filter(IN_AHEAD).slice(0, AHEAD_LIMIT),
    checkpoints,
    commitment,
    deadline: goal.spec.deadline,
    hasPath: curriculum !== undefined,
    hasMarks: weeks.flat().some((cell) => cell.certainties.length > 0),
    // The grid's own last day rather than the month's: the trailing padding
    // days are on screen, so something landing on one of them is not something
    // the learner has to go and look for.
    next: nextAfter(entries, weeks.at(-1)!.at(-1)!.day),
  };
}

/**
 * The first entry beyond a day, or nothing.
 *
 * `buildEntries` sorts by day, so the first match is the earliest — which is
 * the only property this relies on and the reason it is not re-sorting here.
 */
export function nextAfter(
  entries: CalendarEntry[],
  lastDay: DayKey,
): CalendarEntry | undefined {
  return entries.find((entry) => entry.day > lastDay);
}
