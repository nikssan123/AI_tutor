import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe's webhook signature — PLAN-MONETIZATION §6.
 *
 * The same shape `src/lib/mail/inbound.ts` verifies for Resend, with three
 * differences worth naming rather than discovering: Stripe's secret is used as
 * raw UTF-8 rather than base64-decoded, the signed payload is
 * `${timestamp}.${body}` with no event id in it, and the digest is hex rather
 * than base64.
 *
 * **The body must be the raw bytes.** Any parse-and-reserialize — even one that
 * produces equivalent JSON — reorders keys or changes spacing and invalidates
 * the signature. The route reads `request.text()` for exactly this reason.
 */

/**
 * How far out of date a delivery may be.
 *
 * Five minutes, Stripe's own recommendation. The window is what stops a
 * captured request being replayed later; the `billing_event` unique index is
 * what stops it being replayed *now*. Both are needed — the first bounds how
 * long a stolen body is useful, the second makes it useless immediately.
 */
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

export type Verification = { ok: true } | { ok: false; reason: string };

/**
 * Parses `t=1699999999,v1=abc...,v1=def...`.
 *
 * More than one `v1` is normal rather than an attack: it is what a secret
 * rotation looks like while both endpoints' secrets are live.
 */
export function parseSignatureHeader(header: string): {
  timestamp: string | null;
  signatures: string[];
} {
  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }

  return { timestamp, signatures };
}

export function verifySignature(
  secret: string,
  header: string | null,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Verification {
  if (!header) return { ok: false, reason: "missing signature header" };

  const { timestamp, signatures } = parseSignatureHeader(header);
  if (timestamp === null || signatures.length === 0) {
    return { ok: false, reason: "malformed signature header" };
  }

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSeconds - sent) > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest();

  for (const candidate of signatures) {
    const given = Buffer.from(candidate, "hex");
    // `timingSafeEqual` throws on a length mismatch rather than returning
    // false, so the guard is required and not merely an optimisation.
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "signature did not match" };
}

/** The other half, so a test can sign a body the way Stripe would. */
export function signPayload(
  secret: string,
  body: string,
  timestampSeconds: number,
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${body}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}
