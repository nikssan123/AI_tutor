/**
 * The shape of a streamed intake turn, agreed by both ends.
 *
 * The body is the analyzer's reply as it is written, then a separator, then how
 * the turn ended. The verdict has to travel in the body because by the time it
 * is known the response has been flowing for seconds — there is no status code
 * left to say it with, and a failed turn still has to land the learner on
 * `/start?error=analyzer` rather than on a sentence that stopped.
 *
 * Its own module because the route handler and the client component both need
 * it, and importing the route into the client would drag `getDb` and the
 * Anthropic client into the browser bundle.
 */

/** Built rather than typed, so no control byte sits raw in the source. */
export const OUTCOME_SEPARATOR = String.fromCharCode(0);

export const TURN_OK = "ok";
export const TURN_FAILED = "failed";

/** The reply, without the verdict that may already have arrived after it. */
export function replyPart(buffer: string): string {
  return buffer.split(OUTCOME_SEPARATOR)[0]!;
}

/** Whether the stream ended by saying the turn could not be completed. */
export function turnFailed(buffer: string): boolean {
  return buffer.endsWith(`${OUTCOME_SEPARATOR}${TURN_FAILED}`);
}
