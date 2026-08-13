import { describe, expect, it } from "vitest";
import { MAX_TURNS } from "@/lib/goals/analyzer";
import { EMPTY_INTAKE, type Intake } from "@/lib/goals/intake-store";
import { resumableIntake } from "@/lib/goals/onboarding";

/**
 * The offer made to a learner with no course running.
 *
 * Pure over a loaded `Intake` on purpose — what is worth testing is which
 * conversations count as resumable and what the screen is allowed to say about
 * them, and a database would only be re-testing `loadIntake`.
 */

const intake = (overrides: Partial<Intake> = {}): Intake => ({
  ...EMPTY_INTAKE,
  messages: [
    { r: "l", t: "I want to get better at spreadsheets" },
    { r: "a", t: "What do you use them for at the moment?" },
    { r: "l", t: "Budgets, mostly" },
    { r: "a", t: "How many hours a week have you got?" },
  ],
  ...overrides,
});

describe("what counts as something to resume", () => {
  it("is nothing when the conversation never had a turn in it", () => {
    expect(resumableIntake(EMPTY_INTAKE)).toBeUndefined();
  });

  /**
   * The row a learner gets by opening `/start` and leaving. Offering to "carry
   * on" with it would be an invitation to nothing, and it is the common case —
   * every visit to `/start` writes one.
   */
  it("is nothing when there are no messages, whatever else the row holds", () => {
    expect(
      resumableIntake({ ...EMPTY_INTAKE, clarity: 0.9, done: true }),
    ).toBeUndefined();
  });

  it("counts a conversation with any history at all", () => {
    expect(resumableIntake(intake())).toBeDefined();
  });
});

describe("what the screen may say about it", () => {
  it("counts the analyzer's turns, not the learner's", () => {
    // Four messages, two of them the analyzer's.
    expect(resumableIntake(intake())?.turns).toBe(2);
  });

  it("carries the cap so the count reads as progress rather than a tally", () => {
    expect(resumableIntake(intake())?.ofTurns).toBe(MAX_TURNS);
  });

  /**
   * `captured-display.ts`'s rule, applied one screen further out: quote them,
   * never invent. A screen that says "carry on with SQL" when the analyzer had
   * not settled on a subject is inventing the part it claims to be repeating.
   */
  it("has no subject before the analyzer has captured anything", () => {
    expect(resumableIntake(intake())?.subject).toBeNull();
  });

  it("has no subject when it captured other fields but not that one", () => {
    const captured = { subject: null } as Intake["captured"];
    expect(resumableIntake(intake({ captured }))?.subject).toBeNull();
  });

  it("uses the analyzer's own wording for the subject when it has one", () => {
    const captured = { subject: "SQL and data analysis" } as Intake["captured"];
    expect(resumableIntake(intake({ captured }))?.subject).toBe(
      "SQL and data analysis",
    );
  });

  it("is not ready while the analyzer is still asking", () => {
    expect(resumableIntake(intake())?.ready).toBe(false);
  });

  /** Answered everything and never pressed the button — a different offer. */
  it("is ready once the analyzer has closed", () => {
    expect(resumableIntake(intake({ done: true }))?.ready).toBe(true);
  });
});
