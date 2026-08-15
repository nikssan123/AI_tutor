/**
 * The shape of a streamed intake turn, agreed by both ends.
 *
 * The body is the analyzer's reply as it is written, then a separator, then how
 * the turn ended. The verdict has to travel in the body because by the time it
 * is known the response has been flowing for seconds — there is no status code
 * left to say it with, and a failed turn still has to land the learner on
 * `/start?error=analyzer` rather than on a sentence that stopped.
 *
 * The reply half is no longer read by anyone. `Composer` waits for the whole
 * body and shows none of it: the stored turn arrives with the page refresh, in
 * the same render that reopens the answer box, so painting a preview first only
 * put a finished question above a box that was still shut. What the reply still
 * does is keep the response flowing while the model works, which is what stops
 * a multi-second call looking like a stalled connection to whatever is between
 * us and the browser — so it keeps being sent, and the client reads to the end
 * of it for the verdict below.
 *
 * Its own module because the route handler and the client component both need
 * it, and importing the route into the client would drag `getDb` and the
 * Anthropic client into the browser bundle.
 */

/** Built rather than typed, so no control byte sits raw in the source. */
export const OUTCOME_SEPARATOR = String.fromCharCode(0);

export const TURN_OK = "ok";
export const TURN_FAILED = "failed";

/** Whether the stream ended by saying the turn could not be completed. */
export function turnFailed(buffer: string): boolean {
  return buffer.endsWith(`${OUTCOME_SEPARATOR}${TURN_FAILED}`);
}
