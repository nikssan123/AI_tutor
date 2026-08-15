import type { Db } from "@/db";
import type { CallResult } from "@/lib/ai/call";
import {
  isComplete,
  shouldFinishNext,
  type AnalyzerInput,
  type AnalyzerTurn,
  type Message,
} from "./analyzer";
import { catalogueFor } from "./match";
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
  return {
    messages,
    catalogue: catalogueFor(),
    today: today.toISOString().slice(0, 10),
    // Told to close either because the last turn showed it has enough, or
    // because this is the last turn it gets. Without this the conversation
    // ends on an unanswered question.
    finalTurn: shouldFinishNext(intake.clarity, messages),
    committed: committedPack(intake.packSlug),
  };
}

/**
 * Stores the outcome, whichever way it went, and says whether it worked.
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
): Promise<boolean> {
  if (result.status !== "ok") {
    await saveIntake(db, userId, { ...intake, messages });
    return false;
  }

  const turn = result.value;
  const withReply: Message[] = [...messages, { r: "a", t: turn.reply }];

  await saveIntake(db, userId, {
    messages: withReply,
    captured: turn.captured,
    chips: turn.chips,
    clarity: turn.clarity,
    done: isComplete(turn, withReply),
    // Carried rather than re-derived. Everything else here is this turn's
    // output; the chosen course is the learner's, from before the conversation
    // started, and a turn is not allowed to change it.
    packSlug: intake.packSlug,
  });

  return true;
}
