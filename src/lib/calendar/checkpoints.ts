import { addDays, type DayKey } from "./dates";
import type { OutputArtifact } from "@/lib/contracts/curriculum";

/**
 * When the work ahead lands on a date.
 *
 * A checkpoint is a module that ends in something you hand in (§14.4's
 * `outputArtifact`). The path screen lists them in order; this puts a date on
 * them, which is the only thing a calendar adds and the only thing the learner
 * cannot work out for themselves.
 *
 * **Every date here is a projection and is labelled as one.** It is the hours
 * still owed on the skills the module targets, at the learner's current level,
 * divided by a pace. Two paces, for the reason `/progress` gives: the one they
 * committed to and the one they have actually kept. A single date computed from
 * the intended pace is a wish, and §4.2 law 3 forbids printing a wish as an
 * estimate.
 */

/** Beyond a handful, a date built on a pace is arithmetic rather than a plan. */
export const CHECKPOINT_LIMIT = 5;

export interface CheckpointModule {
  title: string;
  targetSkillIds: string[];
  outputArtifact: OutputArtifact;
}

export interface Checkpoint {
  title: string;
  /** Hours between here and finishing it, at the learner's current level. */
  hoursAway: number;
  /** At the pace they set aside. */
  day: DayKey;
  /** At the pace they have actually kept, or null when there isn't one yet. */
  dayAtActualPace: DayKey | null;
  /** §4.2 law 2 — marked against a published rubric, rather than just made. */
  graded: boolean;
}

export interface CheckpointInput {
  /** In the order the curriculum puts them. */
  modules: CheckpointModule[];
  /** Hours still owed per skill — `remainingHoursFor`, not a fresh formula. */
  remainingHours: Map<string, number>;
  weeklyHours: number;
  /** Zero when the week holds no pace to project from, which is not an error. */
  actualWeeklyHours: number;
  today: DayKey;
  limit?: number;
}

/**
 * Rounded up, both paces. A completion estimate that rounds down is flattering
 * in exactly the direction §4.2 law 3 forbids — the same call `digest.ts` makes.
 */
function landsOn(today: DayKey, hours: number, weeklyHours: number): DayKey {
  return addDays(today, Math.ceil((hours / weeklyHours) * 7));
}

export function projectCheckpoints(input: CheckpointInput): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];
  let cumulative = 0;

  for (const mod of input.modules) {
    // Counted before the skips below: you still have to do the work in a module
    // you are not being given a date for.
    // A skill the curriculum names and the pack does not owes no hours. The
    // validator's `no_hallucinated_skills` check is what catches that properly
    // (§14.6); a calendar is not the screen to relitigate it on.
    const hours = mod.targetSkillIds.reduce(
      (sum, id) => sum + (input.remainingHours.get(id) ?? 0),
      0,
    );
    cumulative += hours;

    if (mod.outputArtifact === "none") continue;

    // Nothing left to learn for this one. It is not a *date* — it is something
    // the learner could sit down and do now — so it belongs on the path screen
    // rather than in a list of things that have not happened yet.
    if (hours === 0) continue;

    checkpoints.push({
      title: mod.title,
      // One decimal: the input is expert-estimated hours, so a second would be
      // precision the number does not have (`projection.ts` makes the same cut).
      hoursAway: Math.round(cumulative * 10) / 10,
      day: landsOn(input.today, cumulative, input.weeklyHours),
      dayAtActualPace:
        input.actualWeeklyHours <= 0
          ? null
          : landsOn(input.today, cumulative, input.actualWeeklyHours),
      graded: mod.outputArtifact === "project",
    });

    if (checkpoints.length === (input.limit ?? CHECKPOINT_LIMIT)) break;
  }

  return checkpoints;
}

/**
 * - `plan` · the work runs past the deadline even at the pace they set aside
 * - `pace` · the plan fits and last week's pace does not
 */
export type DeadlineVerdict = "plan" | "pace" | null;

/**
 * Whether the dated work provably lands after the deadline, and on which pace.
 *
 * Only ever **provable**: a checkpoint dated after the deadline is evidence the
 * plan runs past it. The reverse is not evidence of anything, because the list
 * is capped — so `null` means "nothing shown says otherwise", never "you are
 * fine", and the screen has to stay silent rather than reassure.
 *
 * The two verdicts are different problems and get different sentences. A plan
 * that does not fit is the planner's to compress (§16.1 step 3). A pace that
 * does not keep up is the learner's, and is the number `/progress` exists to
 * put in front of them.
 */
export function deadlineVerdict(
  checkpoints: Checkpoint[],
  deadline: string,
): DeadlineVerdict {
  if (checkpoints.some((c) => c.day > deadline)) return "plan";
  return checkpoints.some(
    (c) => c.dayAtActualPace !== null && c.dayAtActualPace > deadline,
  )
    ? "pace"
    : null;
}
