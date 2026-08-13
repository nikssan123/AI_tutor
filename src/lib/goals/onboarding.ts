import { MAX_TURNS, turnsTaken } from "./analyzer";
import type { Intake } from "./intake-store";

/**
 * What a learner with no course yet can be offered.
 *
 * §8 screen 6 says `/today` must answer "what do I do now" in under two seconds,
 * and it says so about the learner who has a goal. The learner who does not had
 * the same screen answering "nothing" — and so did `/mastery`, `/progress` and
 * `/calendar`, in the same words. Four destinations, one dead end, repeated.
 *
 * The thing that made it a dead end was not a missing feature. `goal_intake`
 * rows already persist a conversation someone walked away from mid-question,
 * and nothing anywhere told them it was still there. This is that row, read as
 * an offer rather than as storage.
 */

export interface ResumableIntake {
  /**
   * The subject the analyzer had settled on, or null if it had not got there.
   *
   * The analyzer's wording, not ours — the same rule `captured-display.ts` was
   * written for. A screen that says "carry on with SQL" when the learner said
   * "spreadsheets at work" is inventing the part it is claiming to repeat.
   */
  subject: string | null;
  /** Exchanges already taken. */
  turns: number;
  /** Out of this many, so the screen can say "3 of 6" rather than a bare count. */
  ofTurns: number;
  /**
   * The analyzer closed the conversation and the course was never built — one
   * tap finishes it. Worth distinguishing because "carry on answering" and
   * "we have everything, build it" are different offers, and the second one is
   * the better thing to have walked away from.
   */
  ready: boolean;
}

/**
 * Pure over a loaded `Intake` rather than reading it, so the offer can be tested
 * without a database — the page does the loading it was already doing.
 *
 * An intake with no messages is not something to resume. That is the row a
 * learner gets by opening `/start` and leaving, and offering to "carry on" with
 * a conversation that never had a turn in it would be an invitation to nothing.
 */
export function resumableIntake(intake: Intake): ResumableIntake | undefined {
  if (intake.messages.length === 0) return undefined;

  return {
    subject: intake.captured?.subject ?? null,
    turns: turnsTaken(intake.messages),
    ofTurns: MAX_TURNS,
    ready: intake.done,
  };
}
