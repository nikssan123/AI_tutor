import { getDb } from "@/db";
import { receiveWebhook } from "@/lib/billing/stripe/receive";

/**
 * Where Stripe reports what happened to the money.
 *
 * Thin on purpose — everything beyond reading the request lives in
 * `lib/billing/stripe/receive.ts`, which is testable without a runtime.
 *
 * The one thing this route must not be talked out of: **the body is read as
 * text**, and parsed afterwards. Stripe signs the exact bytes, and
 * `await request.json()` would reserialize them into something that no longer
 * matches — the same note `api/email/inbound/route.ts` carries, for the same
 * reason.
 *
 * There is deliberately no `export const runtime`. Verification is an HMAC from
 * `node:crypto`, so this has to be the Node runtime — which it is by default,
 * and the docs are explicit that the export should now be removed rather than
 * pinned (`02-route-segment-config/runtime.md`: the Edge Runtime is deprecated).
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();

  const result = await receiveWebhook(getDb(), {
    body,
    signature: request.headers.get("stripe-signature"),
  });

  return Response.json(result.body, { status: result.status });
}
