import type { CapturedGoal } from "./analyzer";

/**
 * What the intake sidebar shows for what it has captured so far.
 *
 * One rule, in one place: **quote them, fall back to our reading, never invent
 * precision.** The card's whole claim is that it is repeating what it heard, so
 * a row that paraphrases is worse than a row that is blank.
 *
 * It used to paraphrase on all three, and the screenshot that started this is
 * the argument for the file: a learner answered "Complete beginner" and the
 * card said **Dabbled a bit** two inches away from their own message. They
 * tapped the chip **1-2 hrs** and it said **1.5 hrs/week**. They wrote "before
 * a trip next summer" and it said **2027-06-01** — a raw ISO string, and a
 * calendar day nobody had picked.
 *
 * The enums and the number are still captured, because the planner needs an
 * enum and a number. They just stopped being the thing a person reads.
 */

/**
 * Our vocabulary for `statedLevel`, used only when the learner never said it
 * plainly — inferred from context rather than answered.
 */
export const LEVELS: Record<string, string> = {
  none: "Never done it",
  beginner: "Dabbled a bit",
  intermediate: "Can do the basics",
  advanced: "Experienced",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * `2027-06-01` → `1 June 2027`.
 *
 * Split rather than parsed: `new Date("2027-06-01")` is UTC midnight, so
 * anywhere west of Greenwich it formats as the day before. A deadline that
 * moves depending on where the reader is sitting is not a small bug.
 */
export function formatDeadline(iso: string): string {
  const [year, month, day] = iso.split("-");
  const name = MONTHS[Number(month) - 1];

  // Anything that is not the ISO date the contract promises is shown as it
  // came rather than mangled into a wrong date.
  if (!year || !month || !day || !name) return iso;

  return `${Number(day)} ${name} ${year}`;
}

export function displayLevel(captured: CapturedGoal | undefined): string | null {
  if (captured?.levelSaid) return captured.levelSaid;
  if (!captured?.statedLevel) return null;
  return LEVELS[captured.statedLevel] ?? null;
}

export function displayHours(captured: CapturedGoal | undefined): string | null {
  if (captured?.weeklyHoursSaid) return captured.weeklyHoursSaid;
  if (!captured?.weeklyHours) return null;
  return `${captured.weeklyHours} hrs/week`;
}

export function displayDeadline(
  captured: CapturedGoal | undefined,
): string | null {
  if (captured?.deadlineSaid) return captured.deadlineSaid;
  if (!captured?.deadline) return null;
  return formatDeadline(captured.deadline);
}
