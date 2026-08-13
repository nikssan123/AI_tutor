import { describe, expect, it } from "vitest";
import {
  GOAL_STATUSES,
  isAchieved,
  isGoalStatus,
  isLearnerAction,
  isResumable,
  LEARNER_ACTIONS,
  RESULT_OF,
  STATUS_LABEL,
} from "@/lib/goals/lifecycle";

/**
 * What can happen to a course, and who may make it happen.
 *
 * The load-bearing rule is the absence: three of the four statuses are the
 * learner's to set and `achieved` is not one of them, because §4.2 law 1 allows
 * a claim only from a graded observation on work the learner produced.
 */

describe("who may set what", () => {
  it("offers the learner three actions and no way to finish a course", () => {
    expect([...LEARNER_ACTIONS]).toEqual(["pause", "abandon", "resume"]);
    expect(Object.values(RESULT_OF)).not.toContain("achieved");
  });

  it("knows every status the column can hold", () => {
    for (const status of GOAL_STATUSES) expect(isGoalStatus(status)).toBe(true);
  });

  /** Both arrive off a form, so both are untrusted strings until checked. */
  it("rejects anything that is not one of them", () => {
    expect(isGoalStatus("finished")).toBe(false);
    expect(isGoalStatus(undefined)).toBe(false);
    expect(isLearnerAction("achieve")).toBe(false);
    expect(isLearnerAction(null)).toBe(false);
  });

  it("accepts the three real actions", () => {
    for (const action of LEARNER_ACTIONS) {
      expect(isLearnerAction(action)).toBe(true);
    }
  });

  it("names every status in plain words rather than the column value", () => {
    for (const status of GOAL_STATUSES) {
      expect(STATUS_LABEL[status]).not.toBe(status);
    }
  });
});

describe("what can be picked up again", () => {
  it("offers a paused or stopped course", () => {
    expect(isResumable("paused")).toBe(true);
    expect(isResumable("abandoned")).toBe(true);
  });

  /**
   * The running one is already running, and a finished one has no action on it
   * — offering it would be offering a row that does nothing when tapped.
   */
  it("offers neither the running one nor a finished one", () => {
    expect(isResumable("active")).toBe(false);
    expect(isResumable("achieved")).toBe(false);
  });
});

describe("when a course is finished", () => {
  it("is finished once every skill on it has work behind it", () => {
    expect(
      isAchieved({
        courseSkillIds: ["metering", "focus"],
        claimed: new Set(["metering", "focus", "extra"]),
      }),
    ).toBe(true);
  });

  it("is not finished while one of them is unclaimed", () => {
    expect(
      isAchieved({
        courseSkillIds: ["metering", "focus"],
        claimed: new Set(["metering"]),
      }),
    ).toBe(false);
  });

  /**
   * The question is asked of the *course*, not of what is left of it, and this
   * is why. A skill leaves `requiredSkillIds` at `MASTERY_TARGET`, the same bar
   * `buildLedger` claims it at — so had this been asked of the remainder, the
   * two sets would be disjoint by construction and the answer always no.
   */
  it("asks about the whole course, not the part still to do", () => {
    // What a half-finished course looks like: one proved, one to go. Asked of
    // the remainder ("focus"), "all claimed" would be false forever; asked of
    // the course, it is simply not finished yet — and will be.
    expect(
      isAchieved({
        courseSkillIds: ["metering", "focus"],
        claimed: new Set(["metering"]),
      }),
    ).toBe(false);

    expect(
      isAchieved({
        courseSkillIds: ["metering", "focus"],
        claimed: new Set(["metering", "focus"]),
      }),
    ).toBe(true);
  });

  /**
   * A learner who aces the diagnostic has every skill excluded as
   * already-known and nothing handed in. Those skills were skipped on the
   * strength of answers, and §4.2 law 1 is explicit that answers are not
   * evidence — so this must not be a finished course.
   */
  it("does not finish a course nothing has been handed in on", () => {
    expect(
      isAchieved({
        courseSkillIds: ["metering", "focus"],
        claimed: new Set(),
      }),
    ).toBe(false);
  });

  it("does not finish a course with no skills on it", () => {
    expect(isAchieved({ courseSkillIds: [], claimed: new Set() })).toBe(false);
    expect(
      isAchieved({ courseSkillIds: [], claimed: new Set(["metering"]) }),
    ).toBe(false);
  });
});
