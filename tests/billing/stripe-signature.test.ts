import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  parseSignatureHeader,
  signPayload,
  TIMESTAMP_TOLERANCE_SECONDS,
  verifySignature,
} from "@/lib/billing/stripe/signature";

/**
 * Stripe's webhook signature.
 *
 * The endpoint this guards can grant somebody Pro, so the tests that matter are
 * the refusals: a body edited after signing, a captured request replayed
 * tomorrow, and a header shaped like a signature but carrying none.
 */

const SECRET = "whsec_test_secret";
const BODY = '{"id":"evt_1","type":"invoice.paid"}';
const NOW = 1_760_000_000;

describe("parseSignatureHeader", () => {
  it("reads the timestamp and every v1", () => {
    // More than one v1 is a secret rotation in progress, not an attack.
    expect(parseSignatureHeader("t=123,v1=aaa,v1=bbb")).toEqual({
      timestamp: "123",
      signatures: ["aaa", "bbb"],
    });
  });

  it("ignores schemes it does not know", () => {
    expect(parseSignatureHeader("t=123,v0=xxx,v1=aaa")).toEqual({
      timestamp: "123",
      signatures: ["aaa"],
    });
  });

  it("tolerates spacing", () => {
    expect(parseSignatureHeader(" t=123 , v1=aaa ")).toEqual({
      timestamp: "123",
      signatures: ["aaa"],
    });
  });

  it("keeps a value containing an equals sign intact", () => {
    expect(parseSignatureHeader("t=1,v1=ab=cd").signatures).toEqual(["ab=cd"]);
  });

  it("returns nothing useful for a header with no pairs", () => {
    expect(parseSignatureHeader("nonsense")).toEqual({
      timestamp: null,
      signatures: [],
    });
  });
});

describe("verifySignature", () => {
  const valid = () => signPayload(SECRET, BODY, NOW);

  it("accepts a signature it just produced", () => {
    expect(verifySignature(SECRET, valid(), BODY, NOW)).toEqual({ ok: true });
  });

  it("accepts when one of several signatures matches", () => {
    const header = `t=${NOW},v1=${"0".repeat(64)},v1=${
      parseSignatureHeader(valid()).signatures[0]
    }`;
    expect(verifySignature(SECRET, header, BODY, NOW)).toEqual({ ok: true });
  });

  it("rejects a body edited after signing", () => {
    // The reason the route reads raw bytes rather than re-serialising JSON.
    const tampered = BODY.replace("invoice.paid", "invoice.void");
    expect(verifySignature(SECRET, valid(), tampered, NOW)).toEqual({
      ok: false,
      reason: "signature did not match",
    });
  });

  it("rejects the wrong secret", () => {
    expect(verifySignature("whsec_other", valid(), BODY, NOW)).toEqual({
      ok: false,
      reason: "signature did not match",
    });
  });

  it("rejects a replay from outside the tolerance", () => {
    const later = NOW + TIMESTAMP_TOLERANCE_SECONDS + 1;
    expect(verifySignature(SECRET, valid(), BODY, later)).toEqual({
      ok: false,
      reason: "timestamp outside tolerance",
    });
  });

  it("accepts one at the edge of the tolerance", () => {
    const edge = NOW + TIMESTAMP_TOLERANCE_SECONDS;
    expect(verifySignature(SECRET, valid(), BODY, edge)).toEqual({ ok: true });
  });

  it("rejects a timestamp from the future beyond tolerance", () => {
    const header = signPayload(SECRET, BODY, NOW + 10_000);
    expect(verifySignature(SECRET, header, BODY, NOW)).toEqual({
      ok: false,
      reason: "timestamp outside tolerance",
    });
  });

  it.each([
    [null, "missing signature header"],
    ["", "missing signature header"],
    ["nonsense", "malformed signature header"],
    ["t=123", "malformed signature header"],
    ["v1=abc", "malformed signature header"],
    ["t=later,v1=abc", "bad timestamp"],
  ])("rejects %o as %s", (header, reason) => {
    expect(verifySignature(SECRET, header, BODY, NOW)).toEqual({
      ok: false,
      reason,
    });
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch rather than returning
    // false, so the guard in front of it is required, not an optimisation.
    expect(verifySignature(SECRET, `t=${NOW},v1=abcd`, BODY, NOW)).toEqual({
      ok: false,
      reason: "signature did not match",
    });
  });

  it("signs the timestamp and body, not the body alone", () => {
    // Matches Stripe's documented scheme; signing only the body would let a
    // captured signature be replayed with any timestamp.
    const digest = createHmac("sha256", SECRET)
      .update(`${NOW}.${BODY}`)
      .digest("hex");
    expect(valid()).toBe(`t=${NOW},v1=${digest}`);
  });

  it("uses the secret as raw text rather than base64", () => {
    // Differs from the Resend verifier next door, which base64-decodes its key.
    const digest = createHmac("sha256", SECRET)
      .update(`${NOW}.${BODY}`)
      .digest("hex");
    expect(verifySignature(SECRET, `t=${NOW},v1=${digest}`, BODY, NOW)).toEqual(
      { ok: true },
    );
  });

  it("defaults its clock to now", () => {
    const seconds = Math.floor(Date.now() / 1000);
    expect(verifySignature(SECRET, signPayload(SECRET, BODY, seconds), BODY)).toEqual(
      { ok: true },
    );
  });
});
