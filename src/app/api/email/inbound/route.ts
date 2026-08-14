import { getDb } from "@/db";
import { handleWebhook } from "@/lib/mail/webhook";

/**
 * Where Resend delivers mail sent to the support address.
 *
 * Thin on purpose — everything it does beyond reading the request lives in
 * `lib/mail/webhook.ts`, which is testable without a runtime.
 *
 * The one thing this route must not be talked out of: **the body is read as
 * text**, and parsed afterwards. The signature covers the exact bytes, and
 * `await request.json()` would leave nothing to check them against.
 *
 * There is deliberately no `export const runtime`. Verification is an HMAC from
 * `node:crypto`, so this has to be the Node runtime — which it is by default,
 * and the docs are explicit that the export should now be removed rather than
 * pinned (`02-route-segment-config/runtime.md`: the Edge Runtime is deprecated).
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();

  const result = await handleWebhook(getDb(), {
    body,
    headers: {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
  });

  return Response.json(result.body, { status: result.status });
}
