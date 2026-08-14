import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { anonymousBudgetSpent, logCall } from "@/lib/ai/runlog";
import { gradeCheck } from "@/lib/session/grade";

/**
 * Whether an open answer in the anonymous Skill Check gets marked, and by whom.
 *
 * §14.2 routes free-text grading to Haiku and §19.1 budgets the check at about
 * a cent, so the *capability* was always planned. What this file adds is the
 * decision around it, because the check is the one surface in the product that
 * spends money with nobody to bill it to.
 *
 * **Four ways an answer does not get marked, and all four end in the same
 * place**: no API key, no budget left today, a blank answer, or a call that
 * failed. Each falls back to the behaviour the check shipped with — the learner
 * marks themselves against a revealed key, and §7.2 makes that Tier 5, so it
 * moves nothing. That is why this can be added without a feature flag or a
 * degraded-mode banner: the fallback is not a broken version of the feature, it
 * is the honest older one, and the result screen already says which answers
 * counted.
 *
 * **The budget is checked before the call and read from the database.** If the
 * database cannot be reached, nothing is spent: a cap that cannot be read is
 * not a cap, and §14.9.7's rule is to never silently overspend. Failing towards
 * self-marking is failing towards the cheaper and more conservative claim.
 */

export interface MarkRequest {
  /** The item's prompt, as the learner saw it. */
  question: string;
  /** The skill's can-do statement — what the answer is being held against. */
  expected: string;
  answer: string;
}

export interface Marking {
  correct: boolean;
  /** One or two sentences, addressed to the learner. */
  feedback: string;
}

export interface MarkDeps {
  /**
   * A factory rather than a connection, so a check with no marking to do never
   * opens one. `getDb()` throws when `DATABASE_URL` is unset, and the check is
   * a marketing route that otherwise touches no database at all — calling it
   * eagerly would take the whole check down in any environment configured for
   * the public site alone.
   */
  db: () => Db;
  /** Absent when there is no API key; the caller decides how to find one. */
  client: Anthropic | null;
  now?: Date;
}

/**
 * A blank answer is wrong without asking anyone, and the sentence saying so is
 * the only piece of feedback in the product that no model wrote.
 *
 * It is here rather than in the prompt because the alternative is paying for a
 * model call to be told that an empty string does not demonstrate a skill — and
 * because nine blank submissions in a row is the cheapest abuse of this surface
 * there is. It is still a real marking: recorded, incorrect, and counted.
 */
export const BLANK_FEEDBACK =
  "You left this one blank, so there is nothing to mark. Answering with what you do remember is worth more than skipping it.";

export async function markOpenAnswer(
  deps: MarkDeps,
  request: MarkRequest,
): Promise<Marking | null> {
  if (request.answer.trim() === "") {
    return { correct: false, feedback: BLANK_FEEDBACK };
  }

  if (deps.client === null) return null;

  let db: Db;
  try {
    db = deps.db();
    if (await anonymousBudgetSpent(db, deps.now)) return null;
  } catch {
    // No database, or a ledger that cannot be read: either way the spend is
    // unbounded from here. Do not spend.
    return null;
  }

  try {
    const result = await logCall(
      db,
      // §14.8 — anonymous runs are still logged. It is what the cap above
      // counts, and where an abuse spike would show up first.
      null,
      await gradeCheck(deps.client, request),
      deps.now,
    );

    return result.status === "ok"
      ? { correct: result.value.correct, feedback: result.value.feedback }
      : null;
  } catch {
    // A grader that could not run did not pass. §4.2 law 1: recording an
    // unreachable model as a correct answer would put mastery on the board
    // with nothing under it.
    return null;
  }
}
