import type { Db } from "@/db";
import type { CallResult } from "@/lib/ai/call";
import {
  isComplete,
  MAX_TURNS,
  shouldFinishNext,
  turnsTaken,
  type AnalyzerInput,
  type AnalyzerTurn,
  type Message,
} from "./analyzer";
import { catalogueFor, subjectToNarrow } from "./match";
import { saveIntake, type Intake } from "./intake-store";

/**
 * One exchange of the goal intake, minus the part that talks to the model.
 *
 * Two callers now run a turn — the Server Action that has always done it, and
 * the route handler that streams the reply as it is typed — and everything
 * around the model call has to be identical between them: the same context
 * built for the model, the same turn cap enforced in application code (§24 E3),
 * the same saved-anyway behaviour when the call fails. Two copies of that is
 * two places for the cap to be enforced once.
 */

/** Bounds what one person can type into one turn. */
export const MAX_REPLY = 500;

export function askedWith(intake: Intake, said: string): Message[] {
  return [...intake.messages, { r: "l", t: said }];
}

/**
 * The course this conversation is committed to, named for the model.
 *
 * The name comes off the catalogue rather than out of a second stored column,
 * because the catalogue is on disk and synchronous — a name lookup that cost a
 * database round trip would cost one on every turn of every conversation.
 *
 * A locked pack that the catalogue does not know is a Generated one (§7.1),
 * which exists only in the database. Its slug stands in for its name: worse
 * prose in one line of a prompt, and the slug is still the thing the model is
 * being told to echo, so nothing that matters is lost.
 */
export function committedPack(
  packSlug: string | null,
): { slug: string; name: string } | null {
  if (!packSlug) return null;
  const known = catalogueFor().find((c) => c.slug === packSlug);
  return { slug: packSlug, name: known?.name ?? packSlug };
}

/** The context for this turn, including whether the analyzer must close. */
export function contextFor(
  intake: Intake,
  messages: Message[],
  today: Date = new Date(),
): AnalyzerInput {
  /*
   * A subject we would have to write, that nobody has scoped yet.
   *
   * Null the moment a course is chosen: `committed` settles the subject a few
   * lines down, and a learner who pressed a button on a page naming one pack
   * has nothing left to narrow.
   */
  const unscoped =
    intake.packSlug === null ? subjectToNarrow(intake.captured) : null;

  /*
   * The one question allowed to overrule "you have enough, close now".
   *
   * Clarity is the analyzer's read on whether it could plan — and it can plan
   * without this, which is exactly the problem: an unscoped subject produces a
   * confident spec and a course built to the wrong size. So the conversation is
   * held open for it, at the cost of a turn.
   *
   * **Never the last turn.** §24 E3's cap is "≤6 turns, always" and it is
   * enforced in application code precisely so no later rule can spend a seventh.
   * On the final turn `finalTurn` goes back to whatever `shouldFinishNext` says
   * and the conversation closes unscoped — `scopeFrom` is what covers that, by
   * handing the pack author their own words instead of nothing.
   */
  const lastTurn = turnsTaken(messages) >= MAX_TURNS - 1;
  const holdOpen = unscoped !== null && !lastTurn;

  return {
    messages,
    catalogue: catalogueFor(),
    today: today.toISOString().slice(0, 10),
    // Told to close either because the last turn showed it has enough, or
    // because this is the last turn it gets. Without this the conversation
    // ends on an unanswered question.
    finalTurn: shouldFinishNext(intake.clarity, messages) && !holdOpen,
    committed: committedPack(intake.packSlug),
    // Only while the conversation is actually being held open for it. Asking a
    // model to close *and* to ask one more thing is asking it to pick one.
    toNarrow: holdOpen ? unscoped : null,
  };
}

/**
 * How a turn ended, for the caller that has to decide what happens next.
 *
 * Two facts rather than one, because "it worked" and "it was the last one" send
 * the learner to two different places: a turn that closed the conversation ends
 * on the button that builds the plan, and every other turn ends on the question
 * it just produced.
 */
export interface TurnOutcome {
  /** The model answered and the turn was recorded in full. */
  ok: boolean;
  /** That answer closed the conversation — there is nothing left to ask. */
  done: boolean;
}

/**
 * Stores the outcome, whichever way it went, and says how it went.
 *
 * A model that could not answer is not a reason to lose what they typed, so
 * the failure path still saves the conversation — one message longer than it
 * was, ending on them.
 */
export async function recordTurn(
  db: Db,
  userId: string,
  intake: Intake,
  messages: Message[],
  result: CallResult<AnalyzerTurn>,
): Promise<TurnOutcome> {
  if (result.status !== "ok") {
    await saveIntake(db, userId, { ...intake, messages });
    return { ok: false, done: false };
  }

  const turn = result.value;
  const withReply: Message[] = [...messages, { r: "a", t: turn.reply }];
  const done = isComplete(turn, withReply);

  await saveIntake(db, userId, {
    messages: withReply,
    captured: turn.captured,
    chips: turn.chips,
    clarity: turn.clarity,
    done,
    // Carried rather than re-derived. Everything else here is this turn's
    // output; the chosen course is the learner's, from before the conversation
    // started, and a turn is not allowed to change it.
    packSlug: intake.packSlug,
  });

  return { ok: true, done };
}
