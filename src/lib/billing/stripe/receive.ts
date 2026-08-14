import type { Db } from "@/db";
import type { EnvLike } from "@/lib/env-types";
import { handleEvent, type StripeEvent } from "./webhook";
import { verifySignature } from "./signature";

/**
 * The billing webhook, as a function of its inputs rather than of a `Request`.
 *
 * Split out from the route for the same reason `lib/mail/webhook.ts` is: every
 * branch — unsigned, stale, replayed, unparseable, a handler that threw — is
 * then exercised by a test that constructs two strings instead of an HTTP
 * request and a Next.js runtime around it.
 */

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

export interface ReceiveOptions {
  env?: EnvLike;
  nowSeconds?: number;
  now?: Date;
}

/**
 * Status codes here are instructions to Stripe, not decoration.
 *
 * Stripe retries anything that is not 2xx, with backoff, for up to three days.
 * So: **5xx for our problems** — a missing secret, a handler that threw — because
 * those are worth retrying and the event is safe to replay (the `billing_event`
 * unique index makes the second delivery a no-op for anything that already
 * landed). **4xx for theirs**, because a body that will not parse now will not
 * parse in an hour, and an endless retry buries the real failure.
 *
 * A bad signature is 400 rather than 401: it is not an authentication challenge
 * anybody can answer, and Stripe should stop rather than back off.
 */
export async function receiveWebhook(
  db: Db,
  request: { body: string; signature: string | null },
  options: ReceiveOptions = {},
): Promise<WebhookResult> {
  const env = options.env ?? process.env;

  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // An endpoint that writes subscriptions and cannot check who is calling it
    // is one anybody can grant themselves Pro through.
    console.error("[billing] STRIPE_WEBHOOK_SECRET is not set — refusing");
    return { status: 500, body: { error: "billing webhooks are not configured" } };
  }

  const verified = verifySignature(
    secret,
    request.signature,
    request.body,
    options.nowSeconds,
  );
  if (!verified.ok) return { status: 400, body: { error: verified.reason } };

  let event: StripeEvent;
  try {
    event = JSON.parse(request.body) as StripeEvent;
  } catch {
    return { status: 400, body: { error: "body is not JSON" } };
  }

  if (typeof event?.id !== "string" || typeof event?.type !== "string") {
    return { status: 400, body: { error: "not a Stripe event" } };
  }

  // A signed event with no `data.object` is not something Stripe sends, but the
  // handler reads it unconditionally and a crash here would be a retry loop.
  const object = event.data?.object;
  if (typeof object !== "object" || object === null) {
    return { status: 400, body: { error: "event carries no object" } };
  }

  try {
    const result = await handleEvent(db, event, options.now);
    return { status: 200, body: { ...result } };
  } catch (error) {
    console.error("[billing] handler failed for", event.type, error);
    // 500 so Stripe retries. The event row is already filed with the error on
    // it, so the retry re-enters as a replay for anything that did land and the
    // failure is visible in the table rather than only in a log.
    return { status: 500, body: { error: "could not handle the event" } };
  }
}
