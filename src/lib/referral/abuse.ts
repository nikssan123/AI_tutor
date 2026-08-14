import { createHash } from "node:crypto";

/**
 * The five rules — PLAN-MONETIZATION §9.3.
 *
 * Written in the first commit rather than after the first abuse, and pure so
 * every one of them is exhaustively testable. What they are defending is not
 * enormous — a referral reward is fourteen days resolved at the trial spend cap,
 * so a farmed grant is worth about $5 of inference rather than $15 — but a
 * scheme with no rules at all is one somebody automates in an afternoon.
 *
 * Note what is deliberately *not* here: any rule that could refuse a real
 * person. Two learners in one office share an IP; a couple share a surname and
 * a card. So the collision rule needs **both** signals *and* a 24-hour window,
 * and everything else keys on identity rather than on circumstance.
 */

export const REJECTION_REASONS = [
  "self_referral",
  "duplicate_signals",
  "refunded",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

/**
 * An address reduced to the account it actually reaches.
 *
 * Lowercased, `+tag` stripped, and — for Gmail-shaped domains only — dots
 * removed, because Gmail ignores them and `a.b@gmail.com` is the same inbox as
 * `ab@gmail.com`. Dots are **not** stripped elsewhere: plenty of providers
 * treat `first.last@` and `firstlast@` as two different people, and merging
 * them would refuse a real referral.
 */
export function canonicalEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;

  const domain = trimmed.slice(at + 1);
  let local = trimmed.slice(0, at);

  const plus = local.indexOf("+");
  if (plus !== -1) local = local.slice(0, plus);

  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "");
  }

  return `${local}@${domain}`;
}

/**
 * A signup signal, hashed with a server-side pepper.
 *
 * PLAN-LOCALIZATION §5.2 says no IP value appears in any log or database row,
 * and a fraud heuristic is not a reason to break that: comparing two signups
 * needs equality, which a hash preserves, and never the address itself.
 *
 * The pepper means the hashes are useless outside this deployment — a dumped
 * `referral` table cannot be rainbow-tabled back into a list of IP addresses.
 */
export function hashSignal(
  value: string | null | undefined,
  pepper: string,
): string | null {
  if (!value) return null;
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex");
}

export interface AttributionCheck {
  referrerId: string;
  refereeId: string;
  referrerEmail: string;
  refereeEmail: string;
  /** Already hashed. Null when the header was absent. */
  refereeIpHash: string | null;
  refereeUaHash: string | null;
  /** The referrer's own signup signals, for the collision rule. */
  referrerIpHash: string | null;
  referrerUaHash: string | null;
  referrerSignupAt: Date | null;
  now: Date;
}

export type AttributionVerdict =
  | { ok: true }
  | { ok: false; reason: RejectionReason };

/** How close two signups have to be for shared signals to look deliberate. */
export const COLLISION_WINDOW_HOURS = 24;

/**
 * Whether this referral may be recorded as pending.
 *
 * Refusing here rather than at reward time is deliberate: a person who is told
 * at signup that their invite did not apply can go and ask why, whereas one who
 * finds out a fortnight later has already done the work.
 */
export function checkAttribution(
  input: AttributionCheck,
): AttributionVerdict {
  // 1. Self-referral, by account or by the address behind it.
  if (input.referrerId === input.refereeId) {
    return { ok: false, reason: "self_referral" };
  }
  if (
    canonicalEmail(input.referrerEmail) === canonicalEmail(input.refereeEmail)
  ) {
    return { ok: false, reason: "self_referral" };
  }

  // 2. Same machine, same browser, same day.
  //
  // Both signals **and** the window. Either alone refuses real people: an
  // office shares an IP, and a popular browser on a popular OS produces
  // identical user-agent strings by the million.
  const sameIp =
    input.refereeIpHash !== null && input.refereeIpHash === input.referrerIpHash;
  const sameUa =
    input.refereeUaHash !== null && input.refereeUaHash === input.referrerUaHash;

  if (sameIp && sameUa && input.referrerSignupAt) {
    const hours =
      (input.now.getTime() - input.referrerSignupAt.getTime()) / 3_600_000;
    if (hours >= 0 && hours < COLLISION_WINDOW_HOURS) {
      return { ok: false, reason: "duplicate_signals" };
    }
  }

  return { ok: true };
}

/**
 * The two rules that are not in this file, and where they live instead.
 *
 * - **"Already referred"** is `uniqueIndex(referral.refereeId)` in
 *   `src/db/schema/billing.ts`. A check here could be raced by two concurrent
 *   signups; a constraint cannot.
 * - **"Reward only after payment"** is the webhook: `invoice.paid` is the only
 *   thing that sets `firstPaymentAt`, and `rewardReferral` refuses without it.
 *
 * Both are written down here because the natural place to look for a rule is
 * the file named after the rules.
 */
export const RULES_ENFORCED_ELSEWHERE = [
  "already_referred: uniqueIndex(referral.referee_id)",
  "reward_after_payment: stripe/webhook.ts invoice.paid",
] as const;
