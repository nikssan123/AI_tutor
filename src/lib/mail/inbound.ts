import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "@/db";
import type { EnvLike } from "@/lib/env-types";
import { parseMailbox, threadIdFromRecipients } from "@/lib/email/addresses";
import {
  appendMessage,
  createThread,
  findThreadByMessageId,
  findThreadBySubject,
  getThread,
  normalizeAddress,
  type ThreadRow,
} from "./store";

/**
 * Mail arriving from Resend, and what has to be true before we believe it.
 *
 * This is a public endpoint that writes to the database, so the signature check
 * is the whole security model: without it, anyone who learns the URL can file a
 * support request from any address they like — including one belonging to an
 * account — and get an operator to answer it. Everything else here is
 * bookkeeping.
 *
 * Resend signs with Svix's scheme, which is verified by hand rather than with
 * the `svix` package: it is an HMAC over three strings, and the package would
 * add a dependency to the one route where I most want to be able to read every
 * line of what runs.
 */

/**
 * How far out of step with us a webhook's clock may be.
 *
 * Five minutes is Svix's own recommendation. It bounds replay: a captured
 * request stops working before anyone can do much with it, and a retry from a
 * genuinely delayed queue still lands.
 */
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type Verification = { ok: true } | { ok: false; reason: string };

/**
 * Svix's manual scheme: HMAC-SHA256 over `${id}.${timestamp}.${body}`, keyed by
 * the base64 secret after its `whsec_` prefix, compared against a
 * space-separated list of `v1,<base64>` candidates.
 *
 * The body must be the bytes as received. Re-serialising parsed JSON reorders
 * keys and changes spacing, and the signature is over the exact string — which
 * is why the route reads `await request.text()` and parses afterwards.
 */
export function verifyWebhook(
  secret: string,
  headers: WebhookHeaders,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Verification {
  const { id, timestamp, signature } = headers;
  if (id === null || timestamp === null || signature === null) {
    return { ok: false, reason: "missing signature headers" };
  }

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSeconds - sent) > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest();

  for (const candidate of signature.split(" ")) {
    const [version, value] = candidate.split(",");
    if (version !== "v1" || value === undefined) continue;

    const given = Buffer.from(value, "base64");
    // `timingSafeEqual` throws on a length mismatch rather than returning
    // false, so the guard is required and not merely an optimisation.
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "signature did not match" };
}

/** The events this endpoint acts on; everything else is acknowledged and dropped. */
export type WebhookEvent =
  | { kind: "received"; emailId: string }
  | {
      kind: "delivery";
      emailId: string;
      status: "bounced" | "complained";
      reason: string | null;
    }
  | { kind: "ignored"; name: string };

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * What kind of event this is, and the one id we need from it.
 *
 * Resend's `email.received` payload carries metadata only — "webhooks do not
 * include the email body, headers, or attachments, only their metadata" — so
 * the body is fetched separately. Reading nothing but `email_id` here means a
 * payload whose shape changes around it cannot break the endpoint.
 */
export function parseWebhook(payload: unknown): WebhookEvent | null {
  if (typeof payload !== "object" || payload === null) return null;

  const { type, data } = payload as { type?: unknown; data?: unknown };
  if (typeof type !== "string") return null;

  const fields = (typeof data === "object" && data !== null ? data : {}) as {
    email_id?: unknown;
    id?: unknown;
    reason?: unknown;
  };
  const emailId = stringOrNull(fields.email_id) ?? stringOrNull(fields.id);

  if (emailId === null) return { kind: "ignored", name: type };

  if (type === "email.received") return { kind: "received", emailId };
  if (type === "email.bounced" || type === "email.complained") {
    return {
      kind: "delivery",
      emailId,
      status: type === "email.bounced" ? "bounced" : "complained",
      reason: stringOrNull(fields.reason),
    };
  }

  return { kind: "ignored", name: type };
}

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  subject: string;
  text: string | null;
  html: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
}

/** Header lookup that does not care how the sender capitalised the name. */
function header(headers: unknown, name: string): string | null {
  if (typeof headers !== "object" || headers === null) return null;

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return stringOrNull(value);
  }
  return null;
}

/**
 * Fetches the message body, which the webhook did not include.
 *
 * Throws rather than degrading. The caller answers a non-200 to Resend, which
 * retries — and a retry is strictly better than filing a support request with
 * an empty body that an operator has to answer blind.
 */
export async function fetchReceivedEmail(
  emailId: string,
  apiKey: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ReceivedEmail> {
  const response = await fetchImpl(
    `https://api.resend.com/emails/receiving/${emailId}`,
    { headers: { authorization: `Bearer ${apiKey}` } },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Resend would not return the received email (${response.status}): ${detail || "no response body"}`,
    );
  }

  const body = (await response.json()) as Record<string, unknown>;

  return {
    id: stringOrNull(body.id) ?? emailId,
    from: stringOrNull(body.from) ?? "",
    // `received_for` is the address the mail was routed to, which is where the
    // thread token lives when a forwarding rule rewrote the visible `to`.
    to: [...stringList(body.to), ...stringList(body.received_for)],
    subject: stringOrNull(body.subject) ?? "(no subject)",
    text: stringOrNull(body.text),
    html: stringOrNull(body.html),
    messageId:
      stringOrNull(body.message_id) ?? header(body.headers, "message-id"),
    inReplyTo: header(body.headers, "in-reply-to"),
    references: (header(body.headers, "references") ?? "")
      .split(/\s+/)
      .filter((value) => value !== ""),
  };
}

/**
 * A readable fallback when a message arrived as HTML only.
 *
 * Not a renderer and not trying to be — an operator needs to know what was
 * said, and the original HTML is kept alongside for the cases where the
 * stripping loses something that mattered.
 */
export function textFromHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Which conversation an arriving message belongs to.
 *
 * In order of how much we trust it:
 *
 * 1. **The reply-to token.** Ours, unforgeable by accident, and present on
 *    every message we have ever sent in a thread.
 * 2. **`In-Reply-To` / `References`.** Reliable when the chain started with
 *    someone else's mail client.
 * 3. **Same person, same subject, still open.** A guess, and the reason it is
 *    last — but a much better one than starting a fresh thread for every reply
 *    from a client that dropped its headers.
 */
export async function resolveThread(
  db: Db,
  email: ReceivedEmail,
  env: EnvLike = process.env,
): Promise<ThreadRow | undefined> {
  const token = threadIdFromRecipients(email.to, env);
  if (token !== null) {
    const tagged = await getThread(db, token);
    if (tagged !== undefined) return tagged;
  }

  const references = [
    ...(email.inReplyTo === null ? [] : [email.inReplyTo]),
    ...email.references,
  ];
  for (const reference of references) {
    const referenced = await findThreadByMessageId(db, reference);
    if (referenced !== undefined) return referenced;
  }

  const from = parseMailbox(email.from).address;
  return findThreadBySubject(db, from, email.subject);
}

export interface RecordResult {
  threadId: string;
  /** False when this exact message had already been filed — a webhook retry. */
  stored: boolean;
}

export async function recordReceived(
  db: Db,
  email: ReceivedEmail,
  env: EnvLike = process.env,
): Promise<RecordResult> {
  const sender = parseMailbox(email.from);
  const from = normalizeAddress(sender.address);

  const thread =
    (await resolveThread(db, email, env)) ??
    (await createThread(db, {
      participantEmail: from,
      participantName: sender.name,
      subject: email.subject,
      kind: "support",
      needsReply: true,
    }));

  const stored = await appendMessage(db, {
    threadId: thread.id,
    direction: "inbound",
    fromAddress: from,
    toAddress: email.to[0] ?? "",
    subject: email.subject,
    body: email.text ?? textFromHtml(email.html ?? ""),
    html: email.html,
    providerId: email.id,
    messageId: email.messageId,
    inReplyTo: email.inReplyTo,
    status: "received",
  });

  return { threadId: thread.id, stored: stored !== undefined };
}
