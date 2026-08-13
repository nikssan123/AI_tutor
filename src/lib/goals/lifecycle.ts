/**
 * What can happen to a course, and who is allowed to make it happen.
 *
 * `learning_goal.status` has declared `active | paused | achieved | abandoned`
 * since §15 was written, and until now nothing in the product ever wrote
 * anything but `active`. A course could be started and never finished, paused
 * or swapped — which also made *between courses* an unreachable state, and so
 * the ledger that outlives a goal (`learner_skill_mastery` and
 * `retrieval_queue_item` are both keyed per learner per skill) had nowhere it
 * could ever be shown.
 *
 * The rule that shapes this file: **three of the four statuses are the
 * learner's to set, and `achieved` is not one of them.** §3 makes a point of
 * roadmap.sh's progress being self-declared, and §4.2 law 1 says a mastery
 * claim can only come from a graded observation on work the learner produced.
 * A button that marks a course complete would be the same self-declaration one
 * level up — the learner would be claiming the whole course rather than a
 * single skill, on no evidence at all.
 */

export const GOAL_STATUSES = [
  "active",
  "paused",
  "achieved",
  "abandoned",
] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export function isGoalStatus(value: unknown): value is GoalStatus {
  return (GOAL_STATUSES as readonly unknown[]).includes(value);
}

/**
 * The transitions a learner may make, as they appear on a form.
 *
 * There is no `finish`. See the note at the top of the file.
 */
export const LEARNER_ACTIONS = ["pause", "abandon", "resume"] as const;
export type LearnerAction = (typeof LEARNER_ACTIONS)[number];

export function isLearnerAction(value: unknown): value is LearnerAction {
  return (LEARNER_ACTIONS as readonly unknown[]).includes(value);
}

/** Where each learner action leaves the course. */
export const RESULT_OF: Record<LearnerAction, GoalStatus> = {
  pause: "paused",
  abandon: "abandoned",
  resume: "active",
};

/** A course the learner can pick up again. Achieved ones are not offered. */
export function isResumable(status: GoalStatus): boolean {
  return status === "paused" || status === "abandoned";
}

/** What the status is called on screen. Plain words, never the column value. */
export const STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Running",
  paused: "Paused",
  achieved: "Finished",
  abandoned: "Stopped",
};

export interface AchievementInput {
  /**
   * Every non-optional skill the course covers — `courseSkillIds`, not
   * `requiredSkillIds`.
   *
   * This distinction is the whole of it. `requiredSkillIds` is what is *left*,
   * and a skill leaves it at `MASTERY_TARGET` — the same bar `buildLedger`
   * claims it at. So "every required skill is claimed" is a question whose
   * answer is always no: the two sets are disjoint by construction, and a
   * finished course has an empty required list. Which is also what a learner
   * who aced the diagnostic has, so the remainder cannot tell the two apart at
   * all. The set that does not move can.
   */
  courseSkillIds: readonly string[];
  /** Skills with a marked hand-in behind them: `ledger.canDo`, by slug. */
  claimed: ReadonlySet<string>;
}

/**
 * Whether a course has been finished — the only route to `achieved`.
 *
 * Every skill the course is for must be *claimed*, which in the ledger's
 * vocabulary means backed by a hand-in that was marked. Answering questions
 * moves a learner along the path and never onto that list (§8 screen 10), so a
 * course cannot be finished by doing the reading — and cannot be finished by
 * acing the diagnostic either, which is the case this rule exists for. Those
 * skills are skipped on the strength of *answers*, and §4.2 law 1 is explicit
 * that answers are not evidence.
 *
 * A course with no skills on it is not finished; it is empty.
 */
export function isAchieved(input: AchievementInput): boolean {
  if (input.courseSkillIds.length === 0) return false;
  return input.courseSkillIds.every((slug) => input.claimed.has(slug));
}
