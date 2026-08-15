import { getDb } from "@/db";
import { getAnthropic } from "@/lib/ai/client";
import { currentSession } from "@/lib/account/session";
import { recordAgentRun } from "@/lib/ai/runlog";
import { sessionView } from "@/lib/session/view";
import {
  logTurn,
  transcriptFor,
  turnsTaken,
  tutorStream,
} from "@/lib/session/tutor";
import { noteTurn } from "@/lib/session/signals";
import { aiAccess, overCapMessage } from "@/lib/billing/gate";
import { PLANS, resolvePlanId } from "@/lib/billing/catalog";

/**
 * §14.9.3 — the tutor, streamed, because a person is watching it type.
 *
 * This is a route handler rather than a Server Action because Server Actions
 * return a value when they are done; streaming needs the response to start
 * before the answer exists. It is the only endpoint in the product that streams,
 * and the only reason `/session/[id]` ships any client JavaScript at all.
 *
 * Everything the page already guarantees is re-checked here rather than assumed:
 * a route handler is a public URL, and "the page checked" is not a property of
 * the request that arrives at it.
 */

export const dynamic = "force-dynamic";

const MAX_MESSAGE_CHARS = 2_000;

export async function POST(request: Request): Promise<Response> {
  const auth = await currentSession();
  if (!auth) return new Response("Sign in first.", { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const parsed = parseBody(body);
  if (!parsed) return new Response("Bad request.", { status: 400 });

  const db = getDb();
  const now = new Date();

  // `sessionView` scopes by user id, so a learner asking about someone else's
  // session gets the same answer as one asking about a session that does not
  // exist. That is the intended shape: no id is confirmed to exist by a 403.
  const view = await sessionView(db, auth.user.id, parsed.sessionId, now);
  if (!view) return new Response("No such session.", { status: 404 });

  const planId = resolvePlanId(auth.user.plan);
  const limit = PLANS[planId].entitlements.tutorTurnsPerSession;

  /*
   * §14.9.7 limit 4 — the plan's own allowance, then a new session.
   *
   * Not a cost control: the monthly cap below is that. It is §17.2's "DON'T
   * BUILD: a general chatbot — the tutor is scoped to the session", enforced.
   * 409 rather than 403 because nothing is forbidden; the conversation is
   * simply finished.
   *
   * The number comes from the plan rather than from `MAX_TUTOR_TURNS`, and the
   * sentence quotes it. A message that said "thirty" to a learner whose plan
   * stops at fifteen would contradict itself for exactly the people the limit
   * is new for — and `plan-copy.ts`'s second rule is that nothing may be
   * claimed which nothing enforces, which cuts both ways.
   */
  const turns = await turnsTaken(db, view.session.id, auth.user.id);
  if (turns >= limit) {
    return new Response(
      `That is ${limit} questions on this session — enough for one sitting. Finish the block and the next session starts fresh.`,
      { status: 409 },
    );
  }

  /*
   * §14.9.7 limit 1 — "checked *before* every call".
   *
   * The tutor is the highest-volume spender in the product and was, until this
   * line, the largest thing the cap did not cover: it recorded every cent
   * faithfully and nothing ever read the total back.
   *
   * `standard` because §14.9.3 puts the tutor on Sonnet, which means there is
   * no cheaper tier to fall to — so over the cap this refuses rather than
   * degrades. The lesson on the page is still readable without it, which is
   * what makes refusing honest rather than merely cheaper.
   */
  const access = await aiAccess(db, auth.user.id, planId, "standard");
  if (access.blocked) {
    return new Response(overCapMessage(planId), { status: 402 });
  }

  const history = await transcriptFor(db, view.session.id, auth.user.id);

  const stream = tutorStream(getAnthropic(), {
    learnerContext: view.learnerContext,
    block: view.block,
    history,
    message: parsed.message,
  });

  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          let next = await stream.next();
          while (!next.done) {
            controller.enqueue(encoder.encode(next.value));
            next = await stream.next();
          }

          const outcome = next.value;
          await logTurn(db, {
            userId: auth.user.id,
            sessionId: view.session.id,
            question: parsed.message,
            answer: outcome.text,
            meta: outcome.meta,
            now,
          });
          await recordAgentRun(db, {
            userId: auth.user.id,
            meta: outcome.meta,
            status: outcome.refused ? "refusal" : "ok",
          });

          // After the answer, never before it: the learner already has what
          // they asked for, so a slow or failed classification costs them
          // nothing.
          //
          // Its own try, rather than relying on the one `noteTurn` keeps
          // internally. That catch cannot cover this call *site* — `getAnthropic`
          // throws when there is no API key, before `noteTurn` is entered — and
          // an error escaping to the outer handler would append "[The tutor
          // stopped early]" to an answer that arrived complete. A label the
          // learner will never see must not be able to spoil one they did.
          try {
            await noteTurn(db, getAnthropic(), {
              userId: auth.user.id,
              sessionId: view.session.id,
              packSlug: view.goal.packSlug,
              block: view.block,
              question: parsed.message,
              answer: outcome.text,
              now,
            });
          } catch {
            // Nothing to do and nobody to tell: the turn is logged, the answer
            // is delivered, and the only thing lost is a label.
          }
        } catch (error) {
          // The stream has already started, so there is no status code left to
          // change. Saying so in the body is the only honest option — a silent
          // truncation reads as the tutor trailing off mid-sentence.
          controller.enqueue(
            encoder.encode(
              `\n\n[The tutor stopped early: ${error instanceof Error ? error.message : "unknown error"}]`,
            ),
          );
        } finally {
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

export function parseBody(
  body: unknown,
): { sessionId: string; message: string } | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { sessionId, message } = body as Record<string, unknown>;
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  if (typeof message !== "string" || message.trim() === "") return undefined;
  return { sessionId, message: message.slice(0, MAX_MESSAGE_CHARS) };
}
