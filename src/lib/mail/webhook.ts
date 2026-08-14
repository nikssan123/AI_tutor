import type { Db } from "@/db";
import type { EnvLike } from "@/lib/env-types";
import {
  fetchReceivedEmail,
  parseWebhook,
  recordReceived,
  verifyWebhook,
  type WebhookHeaders,
} from "./inbound";
import { markDelivery } from "./store";

/**
 * The webhook, as a function of its inputs rather than of a `Request`.
 *
 * Split out from the route so every branch — an unsigned call, a replayed one,
 * a retry of a message already filed, a bounce for mail we never recorded — is
 * exercised by a test that constructs three strings, instead of by one that
 * constructs an HTTP request and a Next.js runtime around it.
 */

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

export interface WebhookOptions {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  nowSeconds?: number;
}

/**
 * Status codes here are instructions to Resend, not decoration.
 *
 * Resend retries anything that is not a 2xx, and keeps the message while it
 * does. So: **5xx for our problems** (a missing key, an API that would not
 * answer) because those are worth retrying, and **2xx or 4xx for theirs**,
 * because a payload we cannot parse will not parse any better in ten minutes
 * and an endless retry loop hides the real failure.
 */
export async function handleWebhook(
  db: Db,
  request: { body: string; headers: WebhookHeaders },
  options: WebhookOptions = {},
): Promise<WebhookResult> {
  const env = options.env ?? process.env;

  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Refusing everything is the only safe behaviour: an endpoint that writes
    // to the database and cannot check who is calling it is one anybody can
    // file a support request through, from any address they choose.
    console.error("[mail] RESEND_WEBHOOK_SECRET is not set — refusing inbound");
    return { status: 500, body: { error: "inbound email is not configured" } };
  }

  const verified = verifyWebhook(
    secret,
    request.headers,
    request.body,
    options.nowSeconds,
  );
  if (!verified.ok) {
    return { status: 401, body: { error: verified.reason } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(request.body);
  } catch {
    return { status: 400, body: { error: "body is not JSON" } };
  }

  const event = parseWebhook(payload);
  if (event === null) return { status: 400, body: { error: "unknown payload" } };

  if (event.kind === "ignored") {
    return { status: 200, body: { ignored: event.name } };
  }

  if (event.kind === "delivery") {
    const matched = await markDelivery(
      db,
      event.emailId,
      event.status,
      event.reason,
    );
    // An unmatched bounce is the ordinary case, not an error: auth mail is
    // deliberately not in `mail_message`, and its bounces arrive here too.
    return { status: 200, body: { status: event.status, matched } };
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[mail] RESEND_API_KEY is not set — cannot fetch the body");
    return { status: 500, body: { error: "no API key to read the message" } };
  }

  try {
    const email = await fetchReceivedEmail(
      event.emailId,
      apiKey,
      options.fetchImpl,
    );
    const result = await recordReceived(db, email, env);
    return { status: 200, body: { threadId: result.threadId, stored: result.stored } };
  } catch (error) {
    // 502 rather than 500 so the log says which side failed, and so Resend
    // retries — it still holds the message, and the usual cause of this is a
    // transient API error rather than a message we will never be able to read.
    console.error("[mail] could not record an inbound message:", error);
    return { status: 502, body: { error: "could not read the message" } };
  }
}
