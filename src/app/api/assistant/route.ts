import { getDb } from "@/db";
import { currentSession } from "@/lib/account/session";
import { streamAgent, type AgentFrame } from "@/lib/ai/agent";
import { getAnthropic } from "@/lib/ai/client";
import { recordAgentRun } from "@/lib/ai/runlog";
import { assistantAllowance, overCapMessage } from "@/lib/billing/gate";
import { PLANS, resolvePlanId } from "@/lib/billing/catalog";
import { ASSISTANT_PROMPT } from "@/lib/assistant/prompt";
import {
  assistantHistory,
  logAssistantTurn,
  messagesToday,
} from "@/lib/assistant/store";
import { buildTools } from "@/lib/assistant/tools";

/**
 * The Assistant — `ASSISTANT-PLAN.md` §4.
 *
 * A route handler rather than a Server Action for the reason the tutor is one:
 * an action returns when it is finished, and the point of streaming is that the
 * answer starts arriving before it exists. What is new here is that the stream
 * carries more than prose — a turn can put a rendered view on screen mid-answer
 * — so it is NDJSON rather than raw text (§3).
 *
 * Everything the panel guarantees is re-checked here rather than assumed. A
 * route handler is a public URL, and "the button was disabled" is not a property
 * of the request that arrives at it.
 */

export const dynamic = "force-dynamic";

const MAX_MESSAGE_CHARS = 2_000;

/**
 * A wall clock for the whole turn, tools and every step included.
 *
 * The step cap bounds how many requests a turn may make; this bounds how long
 * it may take to make them. Both are needed: four steps of a model that is
 * answering slowly is still a person watching a spinner, and the panel has no
 * way to tell that from a hang.
 */
export const ASSISTANT_BUDGET_MS = 45_000;

/**
 * Everything that can appear on the wire: what the loop yields, plus the two
 * frames only the route can send — the turn finished, or it did not.
 */
export type StreamFrame =
  | AgentFrame
  | { t: "done" }
  | { t: "error"; message: string };

/** One NDJSON line. Text is JSON-escaped, so a newline in prose cannot frame. */
export function line(frame: StreamFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

export function parseBody(body: unknown): { message: string } | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { message } = body as Record<string, unknown>;
  if (typeof message !== "string" || message.trim() === "") return undefined;
  return { message: message.slice(0, MAX_MESSAGE_CHARS) };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await currentSession();
  if (!auth) return new Response("Sign in first.", { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const parsed = parseBody(body);
  if (!parsed) return new Response("Bad request.", { status: 400 });

  const db = getDb();
  const now = new Date();
  const planId = resolvePlanId(auth.user.plan);

  /*
   * The day's allowance, before anything is spent.
   *
   * 429 rather than 402: nothing is over budget and nothing is forbidden — they
   * have asked as much as this plan answers in a day, and tomorrow it is
   * available again. The sentence says the consequence rather than the
   * mechanism; a learner does not need to know what a step is.
   */
  const limit = PLANS[planId].entitlements.assistantMessagesPerDay;
  const asked = await messagesToday(db, auth.user.id, now);
  if (asked >= limit) {
    return new Response(
      `That is everything the assistant answers in a day on your plan. It starts fresh tomorrow.`,
      { status: 429 },
    );
  }

  /*
   * §14.9.7 limit 1, with the month's remaining sessions and evaluations held
   * back — see `assistantAllowance`.
   *
   * Not `aiAccess`. That answers "is there budget" first-come-first-served,
   * which is right for a session and wrong here: the assistant spends from the
   * same ledger, so racing it would let a chatty afternoon take the budget the
   * learner's session needed. The support surface yields to the product.
   *
   * It refuses rather than degrades, because the assistant already runs on the
   * standard tier and there is no cheaper one to fall to. Every page it would
   * have pointed at is still there to open, which is what makes refusing honest
   * rather than merely cheaper.
   */
  const allowance = await assistantAllowance(db, auth.user.id, planId, now);
  if (allowance.blocked) {
    return new Response(overCapMessage(planId), { status: 402 });
  }

  const history = await assistantHistory(db, auth.user.id);

  const stream = streamAgent(getAnthropic(), {
    step: "assistant",
    prompt: ASSISTANT_PROMPT,
    system: ASSISTANT_PROMPT.text,
    messages: [
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user" as const, content: parsed.message },
    ],
    // The context the data tools close over. `userId` comes from the session
    // and never from the model — see §9.1 and `buildTools`.
    tools: buildTools({ db, userId: auth.user.id, plan: auth.user.plan, now }),
    budgetMs: ASSISTANT_BUDGET_MS,
  });

  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          let next = await stream.next();
          while (!next.done) {
            controller.enqueue(encoder.encode(line(next.value)));
            next = await stream.next();
          }

          const outcome = next.value;

          await logAssistantTurn(db, {
            userId: auth.user.id,
            question: parsed.message,
            answer: outcome.text,
            steps: outcome.steps,
            now,
          });

          /*
           * One row per model request, never one averaged row (§10).
           *
           * A turn that spent four requests and a turn that spent one cost
           * very different amounts, and the weekly per-agent cost review is
           * the thing that would notice a loop misbehaving — which it cannot
           * do if a loop reports as a single call.
           */
          for (const meta of outcome.steps) {
            await recordAgentRun(db, {
              userId: auth.user.id,
              meta,
              status: outcome.refused ? "refusal" : "ok",
            });
          }

          controller.enqueue(encoder.encode(line({ t: "done" })));
        } catch (error) {
          // The stream has already started, so there is no status code left to
          // change. A frame saying so is the only honest option — a silent
          // truncation reads as the assistant trailing off mid-sentence.
          controller.enqueue(
            encoder.encode(
              line({
                t: "error",
                message: `The assistant stopped early: ${error instanceof Error ? error.message : "unknown error"}`,
              }),
            ),
          );
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
