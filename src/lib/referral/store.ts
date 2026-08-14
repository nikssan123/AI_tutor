import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { referral, referralCode, user } from "@/db/schema";
import { createGrant } from "@/lib/billing/store";
import { capture } from "@/lib/observability";
import { generateCode, normalizeCode } from "./code";
import {
  checkAttribution,
  hashSignal,
  type RejectionReason,
} from "./abuse";

/**
 * Reading and writing referrals — PLAN-MONETIZATION §9.
 *
 * The mechanic in one sentence: the referee gets 14 days of Pro at signup with
 * no card, and the referrer gets 14 days when the referee's **first payment
 * succeeds**. Both are `plan_grant` rows, and both resolve at the trial spend
 * cap, because a grant is not a payment.
 */

/** §9 — what each side gets. */
export const REWARD_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export function endsAfter(days: number, from: Date): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * This account's code, made on first use.
 *
 * Generated lazily rather than at signup: most people never open the referral
 * page, and a column filled for everybody is a column mostly full of codes
 * nobody will ever type.
 *
 * The retry loop exists because the code is short enough to collide. Three
 * attempts against a 31^8 space is theatre for the first collision and
 * insurance against a broken random source, which is the case actually worth
 * defending — a `getRandomValues` that returned zeros would otherwise spin.
 */
export async function codeFor(
  db: Db,
  userId: string,
  attempts = 3,
  makeCode: () => string = generateCode,
): Promise<string> {
  const [existing] = await db
    .select({ code: referralCode.code })
    .from(referralCode)
    .where(eq(referralCode.userId, userId))
    .limit(1);

  if (existing) return existing.code;

  for (let i = 0; i < attempts; i++) {
    try {
      /*
       * Two unique indexes can reject this insert, and they mean opposite
       * things:
       *
       * - **`referral_code_user_idx`** — this account got a code from a
       *   concurrent request. Not a problem: the no-op `set` makes the
       *   statement return the row that already exists, so both callers get
       *   the same code from one round trip. Re-reading afterwards would be a
       *   second query and a second chance to race.
       * - **`referral_code_code_idx`** — the generated code is taken by
       *   somebody else. That one is not resolvable in SQL, so it throws and
       *   the loop generates another.
       */
      const [claimed] = await db
        .insert(referralCode)
        .values({ userId, code: makeCode() })
        .onConflictDoUpdate({
          target: referralCode.userId,
          set: { userId },
        })
        .returning({ code: referralCode.code });

      // An upsert with `returning` always yields exactly one row.
      capture("referral_link_created", { surface: "account" });
      return claimed!.code;
    } catch {
      // A code collision. At 31^8 this is insurance against a broken random
      // source rather than something anyone will hit.
      continue;
    }
  }

  throw new Error(
    `Could not allocate a referral code for ${userId} after ${attempts} attempts.`,
  );
}

export interface Referrer {
  userId: string;
  name: string;
  email: string;
  signupAt: Date;
  ipHash: string | null;
  uaHash: string | null;
}

/** Who owns a code, if anybody. */
export async function referrerFor(
  db: Db,
  rawCode: string,
): Promise<Referrer | undefined> {
  const code = normalizeCode(rawCode);

  const [row] = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      signupAt: user.createdAt,
    })
    .from(referralCode)
    .innerJoin(user, eq(user.id, referralCode.userId))
    .where(eq(referralCode.code, code))
    .limit(1);

  if (!row) return undefined;

  // The referrer's own signup signals live on their `referral` row, when they
  // were themselves referred. Absent for an organic signup, which is the
  // common case and simply means the collision rule cannot fire.
  const [own] = await db
    .select({
      ipHash: referral.signupIpHash,
      uaHash: referral.signupUaHash,
    })
    .from(referral)
    .where(eq(referral.refereeId, row.userId))
    .limit(1);

  return {
    ...row,
    ipHash: own?.ipHash ?? null,
    uaHash: own?.uaHash ?? null,
  };
}

export interface AttributeInput {
  code: string;
  referee: { userId: string; email: string };
  ip?: string | null;
  userAgent?: string | null;
  pepper: string;
  now?: Date;
}

export type AttributeResult =
  | { status: "recorded"; referralId: string }
  | { status: "rejected"; reason: RejectionReason }
  | { status: "ignored"; why: "unknown_code" | "already_referred" };

/**
 * Record a referral at signup, and give the referee their 14 days.
 *
 * The referee is rewarded immediately and the referrer is not: §9.3's "reward
 * before payment" rule cuts one way only. Somebody arriving on an invitation
 * should find the good version of the product on their first evening, which is
 * the whole point of the invitation.
 *
 * A rejection is recorded rather than dropped. "How many invitations were
 * refused, and why" is the number that says whether the scheme is being farmed,
 * and §14 puts a threshold on it.
 */
export async function attribute(
  db: Db,
  input: AttributeInput,
): Promise<AttributeResult> {
  const now = input.now ?? new Date();

  const referrer = await referrerFor(db, input.code);
  if (!referrer) return { status: "ignored", why: "unknown_code" };

  const ipHash = hashSignal(input.ip, input.pepper);
  const uaHash = hashSignal(input.userAgent, input.pepper);

  const verdict = checkAttribution({
    referrerId: referrer.userId,
    refereeId: input.referee.userId,
    referrerEmail: referrer.email,
    refereeEmail: input.referee.email,
    refereeIpHash: ipHash,
    refereeUaHash: uaHash,
    referrerIpHash: referrer.ipHash,
    referrerUaHash: referrer.uaHash,
    referrerSignupAt: referrer.signupAt,
    now,
  });

  const rows = await db
    .insert(referral)
    .values({
      code: normalizeCode(input.code),
      referrerId: referrer.userId,
      refereeId: input.referee.userId,
      status: verdict.ok ? "pending" : "rejected",
      rejectedReason: verdict.ok ? null : verdict.reason,
      signupAt: now,
      signupIpHash: ipHash,
      signupUaHash: uaHash,
      updatedAt: now,
    })
    // The unique index on `referee_id` is "one referral per person". A second
    // one arriving is not an error, it is somebody opening two invite links.
    .onConflictDoNothing({ target: referral.refereeId })
    .returning({ id: referral.id });

  if (rows.length === 0) {
    return { status: "ignored", why: "already_referred" };
  }

  if (!verdict.ok) {
    capture("referral_signup", { rejected: true, reason: verdict.reason });
    return { status: "rejected", reason: verdict.reason };
  }

  // The referee's fourteen days, now rather than on payment.
  await createGrant(
    db,
    {
      userId: input.referee.userId,
      planId: "pro",
      source: "referral",
      referralId: rows[0]!.id,
      endsAt: endsAfter(REWARD_DAYS, now),
    },
    now,
  );

  capture("referral_signup", { rejected: false });
  return { status: "recorded", referralId: rows[0]!.id };
}

export interface RewardOutcome {
  rewarded: boolean;
  referrerId?: string;
  endsAt?: Date;
}

/**
 * Pay the referrer, once their referee's money has actually arrived.
 *
 * Called from the `invoice.paid` handler after it has marked the row
 * `qualified`. Refuses on anything else: no row, no payment recorded, already
 * rewarded, or a referral that was rejected at signup.
 */
export async function rewardReferral(
  db: Db,
  refereeId: string,
  now: Date = new Date(),
): Promise<RewardOutcome> {
  const [row] = await db
    .select({
      id: referral.id,
      referrerId: referral.referrerId,
      status: referral.status,
      firstPaymentAt: referral.firstPaymentAt,
      rewardedAt: referral.rewardedAt,
    })
    .from(referral)
    .where(eq(referral.refereeId, refereeId))
    .limit(1);

  if (!row) return { rewarded: false };
  if (row.status !== "qualified") return { rewarded: false };
  if (row.firstPaymentAt === null) return { rewarded: false };
  if (row.rewardedAt !== null) return { rewarded: false };

  const endsAt = endsAfter(REWARD_DAYS, now);

  await createGrant(
    db,
    {
      userId: row.referrerId,
      planId: "pro",
      source: "referral",
      referralId: row.id,
      endsAt,
    },
    now,
  );

  await db
    .update(referral)
    .set({ status: "rewarded", rewardedAt: now, updatedAt: now })
    .where(eq(referral.id, row.id));

  capture("referral_rewarded", { days: REWARD_DAYS });
  return { rewarded: true, referrerId: row.referrerId, endsAt };
}

export interface ReferralSummary {
  invited: number;
  paying: number;
  rewardedDays: number;
  recent: Array<{
    status: string;
    signupAt: Date;
    /** First name only — a referrer never needs the address they invited. */
    name: string;
  }>;
}

/**
 * What `/account/referrals` shows.
 *
 * Deliberately not a list of email addresses. The referrer already knows who
 * they invited; showing the addresses back would turn a share page into a
 * contact export, and it is not needed to answer the only question they have,
 * which is "did it work".
 */
export async function summaryFor(
  db: Db,
  userId: string,
): Promise<ReferralSummary> {
  const rows = await db
    .select({
      status: referral.status,
      signupAt: referral.signupAt,
      name: user.name,
    })
    .from(referral)
    .innerJoin(user, eq(user.id, referral.refereeId))
    .where(
      and(
        eq(referral.referrerId, userId),
        // A rejected referral is not shown: it is either somebody's own second
        // account or a coincidence, and neither is worth explaining on a page
        // whose job is to encourage.
        sql`${referral.status} <> 'rejected'`,
      ),
    )
    .orderBy(desc(referral.signupAt))
    .limit(20);

  const paying = rows.filter(
    (r) => r.status === "qualified" || r.status === "rewarded",
  ).length;

  return {
    invited: rows.length,
    paying,
    rewardedDays:
      rows.filter((r) => r.status === "rewarded").length * REWARD_DAYS,
    recent: rows.map((r) => ({
      status: r.status,
      signupAt: r.signupAt,
      // `split` always yields at least one element, so there is nothing to
      // fall back to — the same note `resolveLocale` carries.
      name: r.name.split(" ")[0]!,
    })),
  };
}
