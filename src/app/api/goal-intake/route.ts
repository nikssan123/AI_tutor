import { getDb } from "@/db";
import { getAnthropic } from "@/lib/ai/client";
import { currentSession } from "@/lib/account/session";
import { logCall } from "@/lib/ai/runlog";
import { runAnalyzer } from "@/lib/goals/analyzer";
import { analyzerStream } from "@/lib/goals/analyzer-stream";
import { loadIntake, saveIntake } from "@/lib/goals/intake-store";
import {
  OUTCOME_SEPARATOR,
  TURN_FAILED,
  TURN_OK,
} from "@/lib/goals/intake-protocol";
import { askedWith, contextFor, MAX_REPLY, recordTurn } from "@/lib/goals/turn";

/**
 * One turn of the goal intake, streamed.
 *
 * A route handler rather than a Server Action for the reason the tutor is one:
 * an action returns when it is finished, and the point of streaming is that the
 * answer starts arriving before it exists. `replyAction` still does this same
 * turn as a form POST and is still what runs with scripting off — this is the
 * faster path, not the only one.
 *
 * Everything the page already guarantees is re-checked here rather than
 * assumed: a route handler is a public URL, and "the page checked" is not a
 * property of the request that arrives at it.
 */

export const dynamic = "force-dynamic";

/**
 * Separates the reply from the verdict that follows it.
 *
 * A NUL byte because the stream is otherwise a person's sentence, and there is
 * no sentence that contains one. The client needs to know how it ended: a
 * failed turn has to land on `/start?error=analyzer` with the banner, and once
 * bytes are flowing there is no status code left to say so with.
 */
export function parseBody(body: unknown): { reply: string } | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { reply } = body as Record<string, unknown>;
  if (typeof reply !== "string") return undefined;

  const said = reply.trim().slice(0, MAX_REPLY);
  return said.length === 0 ? undefined : { reply: said };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await currentSession();
  if (!auth) return new Response("Sign in first.", { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const parsed = parseBody(body);
  if (!parsed) return new Response("Bad request.", { status: 400 });

  const db = getDb();
  const userId = auth.user.id;

  const intake = await loadIntake(db, userId);
  // §24 E3's cap, enforced here as well as in the action — this endpoint is
  // reachable directly, so "the screen stopped offering a box" is not a check.
  if (intake.done) return new Response("That conversation is finished.", { status: 409 });

  const messages = askedWith(intake, parsed.reply);
  const context = contextFor(intake, messages);
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        let ok = false;

        try {
          const stream = analyzerStream(getAnthropic(), context);

          let next = await stream.next();
          while (!next.done) {
            controller.enqueue(encoder.encode(next.value));
            next = await stream.next();
          }

          let result = next.value;

          /*
           * The blocking path retries a schema failure by telling the model
           * what was wrong and asking again, which cannot be done halfway
           * through a sentence already on screen. So a streamed turn gets one
           * attempt and then hands over to the path that can retry. The words
           * the learner watched appear are replaced by the real ones when the
           * page refreshes — a rare, visible correction, which is the honest
           * outcome when the first answer was unusable.
           */
          if (result.status !== "ok") {
            result = await runAnalyzer(getAnthropic(), context);
          }

          await logCall(db, userId, result);
          ok = await recordTurn(db, userId, intake, messages, result);
        } catch {
          // Keeps what they typed rather than losing it to a failure that was
          // never theirs. `ok` stays false, so the client lands on the banner.
          await saveIntake(db, userId, { ...intake, messages });
        } finally {
          controller.enqueue(
            encoder.encode(`${OUTCOME_SEPARATOR}${ok ? TURN_OK : TURN_FAILED}`),
          );
          controller.close();
        }
      },
    }),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
