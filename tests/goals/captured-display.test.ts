import { describe, expect, it } from "vitest";
import type { CapturedGoal } from "@/lib/goals/analyzer";
import {
  displayDeadline,
  displayHours,
  displayLevel,
  formatDeadline,
} from "@/lib/goals/captured-display";

/**
 * The rule this file exists to hold: quote them, fall back to our reading,
 * never invent precision. The card claims to be repeating what it heard, so a
 * row that paraphrases is worse than a row left blank.
 */
const EMPTY: CapturedGoal = {
  subject: null,
  matchedPack: null,
  outcomeType: null,
  statedLevel: null,
  weeklyHours: null,
  deadline: null,
  motivation: null,
  constraints: [],
  existingAssets: [],
  levelSaid: null,
  weeklyHoursSaid: null,
  deadlineSaid: null,
};

const captured = (fields: Partial<CapturedGoal>): CapturedGoal => ({
  ...EMPTY,
  ...fields,
});

describe("displayLevel", () => {
  it("quotes the learner rather than our bucket for it", () => {
    // The bug that started this: someone answered "Complete beginner" and the
    // card said "Dabbled a bit" two inches from their own message, because the
    // model had filed it under `beginner`.
    expect(
      displayLevel(
        captured({ statedLevel: "beginner", levelSaid: "Complete beginner" }),
      ),
    ).toBe("Complete beginner");
  });

  it("falls back to our wording when they never said it plainly", () => {
    // Inferred from context rather than answered — so it is ours to phrase.
    expect(displayLevel(captured({ statedLevel: "intermediate" }))).toBe(
      "Can do the basics",
    );
  });

  it("shows nothing rather than a guess", () => {
    expect(displayLevel(captured({}))).toBeNull();
    expect(displayLevel(undefined)).toBeNull();
  });

  it("shows nothing for a level outside the vocabulary", () => {
    expect(
      displayLevel(
        captured({ statedLevel: "godlike" as CapturedGoal["statedLevel"] }),
      ),
    ).toBeNull();
  });
});

describe("displayHours", () => {
  it("keeps the range they picked instead of the number we derived", () => {
    // They tapped the chip "1-2 hrs". Nobody said 1.5.
    expect(
      displayHours(captured({ weeklyHours: 1.5, weeklyHoursSaid: "1-2 hrs" })),
    ).toBe("1-2 hrs");
  });

  it("falls back to the figure the planner is using", () => {
    expect(displayHours(captured({ weeklyHours: 3 }))).toBe("3 hrs/week");
  });

  it("shows nothing rather than a guess", () => {
    expect(displayHours(captured({}))).toBeNull();
    expect(displayHours(undefined)).toBeNull();
  });
});

describe("displayDeadline", () => {
  it("keeps how they put it rather than the date we resolved", () => {
    expect(
      displayDeadline(
        captured({
          deadline: "2027-06-01",
          deadlineSaid: "before a trip next summer",
        }),
      ),
    ).toBe("before a trip next summer");
  });

  it("falls back to a date written for a person, not an ISO string", () => {
    expect(displayDeadline(captured({ deadline: "2027-06-01" }))).toBe(
      "1 June 2027",
    );
  });

  it("shows nothing rather than a guess", () => {
    expect(displayDeadline(captured({}))).toBeNull();
    expect(displayDeadline(undefined)).toBeNull();
  });
});

describe("formatDeadline", () => {
  it("does not shift the day for readers west of Greenwich", () => {
    // `new Date("2027-06-01")` is UTC midnight, which formats as 31 May in any
    // negative offset. A deadline that moves with the reader is not cosmetic.
    expect(formatDeadline("2027-06-01")).toBe("1 June 2027");
    expect(formatDeadline("2027-01-31")).toBe("31 January 2027");
    expect(formatDeadline("2027-12-25")).toBe("25 December 2027");
  });

  it("passes through anything that is not the date the contract promises", () => {
    // Better an odd string on screen than a confidently wrong date.
    expect(formatDeadline("next summer")).toBe("next summer");
    expect(formatDeadline("2027-13-01")).toBe("2027-13-01");
    expect(formatDeadline("2027-06")).toBe("2027-06");
  });
});
