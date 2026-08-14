import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Money — PLAN-MONETIZATION §4. E13, the last epic §24 lists with nothing built.
 *
 * **`subscription` is the source of truth and `user.plan` is a cache of it.**
 * The column stays because it is on the session DTO and read on nearly every
 * request, and a join per request to answer "what plan is this" is a real cost;
 * but it is reconciled from these rows in exactly one function, called only
 * from the webhook. Two places holding one fact is tolerable only when one of
 * them is derived and the derivation lives in one place.
 *
 * `user.stripe_customer_id` already exists on the `user` table and has never
 * been read or written by anything. Choosing Stripe (§1 decision 1) makes it
 * real; it is not renamed.
 *
 * The evaluation quota needs no table here. `spend_ledger.evaluations_used` has
 * existed since `ops.ts` was written with nothing incrementing it — that column
 * is §20.1's "the evaluation quota is the meter", and it has had a home all
 * along.
 */

/**
 * Stripe's statuses, narrowed to the ones this product can be in.
 *
 * The vocabulary lives in `src/lib/billing/entitlements.ts` rather than being
 * restated here, because that is where the decision about what each one *means*
 * is made and tested. Storage is plain `text` either way; a check constraint
 * would only move the failure from a place that can degrade gracefully to a
 * place that cannot.
 */
export const subscription = pgTable(
  "subscription",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /**
     * Unique, and the uniqueness is load-bearing rather than tidy: Stripe
     * delivers `customer.subscription.updated` more than once for the same
     * subscription, and the handler upserts on this column. Without it a
     * retried delivery gives one person two subscription rows and the resolver
     * picks whichever it reads first.
     */
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull(),

    /** One of `PLAN_IDS` — what this subscription entitles its owner to. */
    planId: text("plan_id").notNull(),
    /** `month` | `year`. */
    interval: text("interval").notNull(),

    /**
     * Locked at first subscription and never changed (§6.3 rule 2).
     *
     * Both candidate processors treat currency as immutable per subscription,
     * so somebody who moves country keeps theirs until they cancel and
     * resubscribe. Stored on the row rather than read from a cookie at render
     * time, because the cookie is a preference and this is a fact.
     */
    currency: text("currency").notNull(),
    /** Minor units, as charged. The audit trail for §6.3 rule 1. */
    amountCents: integer("amount_cents").notNull(),

    /** One of the statuses in `src/lib/billing/entitlements.ts`. */
    status: text("status").notNull(),

    /** The end of the window already paid for. During a trial, the trial's end. */
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
    }).notNull(),

    /**
     * Set when someone has cancelled but not yet run out.
     *
     * Kept even though `status` stays `active` until the period ends, because
     * this is what `/account/billing` renders — "You still have Pro until
     * 20 August" needs to know the difference between a subscription that will
     * renew and one that will not, and the status cannot tell it.
     */
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),

    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("subscription_stripe_idx").on(t.stripeSubscriptionId),
    // Not unique: Stripe permits a customer to hold several, and a resubscribe
    // after a cancellation is legitimately a second row. The resolver reads the
    // newest.
    index("subscription_user_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * Every webhook Stripe has delivered, kept whether or not it was understood.
 *
 * The unique index on `stripe_event_id` **is** the idempotency mechanism: the
 * handler inserts before it acts, and a replay fails the insert and stops. That
 * is the same shape `mail_message.provider_id` uses for Resend's retries, and
 * it is preferable to a lookup because a lookup and an insert can interleave.
 *
 * The raw payload is kept because a webhook that was mishandled is only
 * debuggable from what actually arrived, and because Stripe's dashboard
 * retention is shorter than an accounting year.
 */
export const billingEvent = pgTable(
  "billing_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stripeEventId: text("stripe_event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),

    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Null while in flight; set when the handler finished without throwing. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("billing_event_stripe_idx").on(t.stripeEventId),
    index("billing_event_received_idx").on(t.receivedAt),
  ],
);

/** One shareable code per account. */
export const referralCode = pgTable(
  "referral_code",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /**
     * Lowercased, and unique across accounts.
     *
     * It appears in a URL somebody types off a screenshot, so it is compared
     * case-insensitively by being stored one way — the same reasoning
     * `mail_thread.participant_email` gives for lowercasing an address.
     */
    code: text("code").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("referral_code_code_idx").on(t.code),
    uniqueIndex("referral_code_user_idx").on(t.userId),
  ],
);

/** `pending` → `qualified` → `rewarded`, or `rejected` at any point. */
export const REFERRAL_STATUSES = [
  "pending",
  "qualified",
  "rewarded",
  "rejected",
] as const;

export const referral = pgTable(
  "referral",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The code as it was used, kept even if the referrer later regenerates it. */
    code: text("code").notNull(),

    referrerId: text("referrer_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /**
     * **Unique.** "One referral per person" is a database constraint rather
     * than a check in application code, because a check can be raced by two
     * concurrent signups and this is the single rule the whole abuse story
     * rests on.
     */
    refereeId: text("referee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /** One of `REFERRAL_STATUSES`. */
    status: text("status").notNull().default("pending"),

    signupAt: timestamp("signup_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The trigger for the referrer's reward. Never rewarded before this is set. */
    firstPaymentAt: timestamp("first_payment_at", { withTimezone: true }),
    rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),

    /**
     * Hashed signup signals, for the collision rule in §9.3.
     *
     * Hashes rather than values, with a server-side pepper. PLAN-LOCALIZATION
     * §5.2 already says no IP value appears in any log or database row, and a
     * fraud heuristic is not a reason to break that — comparing two accounts
     * needs equality, which a hash preserves, and not the address itself.
     */
    signupIpHash: text("signup_ip_hash"),
    signupUaHash: text("signup_ua_hash"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("referral_referee_idx").on(t.refereeId),
    index("referral_referrer_idx").on(t.referrerId, t.createdAt),
    index("referral_status_idx").on(t.status),
  ],
);

/** Why somebody holds a plan they did not pay for. */
export const GRANT_SOURCES = ["referral", "comp"] as const;

/**
 * Time-boxed entitlement that no money bought.
 *
 * Kept apart from `subscription` deliberately. A grant has no invoice, no
 * currency and nothing to reconcile with Stripe, and putting it in the
 * subscription table would mean every query that asks "what are we owed" has to
 * remember to exclude it. It is also the route an operator's comp takes —
 * `setUserPlan` writing `user.plan` directly would desynchronise the cache from
 * the subscription that owns it.
 */
export const planGrant = pgTable(
  "plan_grant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /** One of `PLAN_IDS`. Entitlements resolve it at the trial spend cap. */
    planId: text("plan_id").notNull(),
    /** One of `GRANT_SOURCES`. */
    source: text("source").notNull(),
    /** Free text for a comp: who authorised it and why. */
    reason: text("reason"),

    /**
     * The referral this grant paid out, when it was one.
     *
     * `set null` rather than `cascade`: if a referral row is ever removed, the
     * fourteen days somebody was actually given do not thereby vanish from
     * under them.
     */
    referralId: uuid("referral_id").references(() => referral.id, {
      onDelete: "set null",
    }),

    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Set by a refund or a dispute. Beats the dates. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The resolver's only query: what is running for this person, right now.
    index("plan_grant_user_idx").on(t.userId, t.endsAt),
  ],
);

/**
 * §25.1 marks the cancellation reason **mandatory**, in bold, and it is the
 * only structured signal this product will get about why people leave.
 */
export const CANCELLATION_REASONS = [
  "too_expensive",
  "not_enough_time",
  "didnt_find_what_i_wanted",
  "ai_quality",
  "learning_experience",
  "other",
] as const;

export const cancellationSurvey = pgTable(
  "cancellation_survey",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /**
     * Nullable and `set null`: the answer outlives the subscription it was
     * given about, because the whole point of collecting it is to read it long
     * after the subscription is gone.
     */
    subscriptionId: uuid("subscription_id").references(() => subscription.id, {
      onDelete: "set null",
    }),

    /** One of `CANCELLATION_REASONS`. Never null — that is what mandatory means. */
    reason: text("reason").notNull(),
    comment: text("comment"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("cancellation_survey_reason_idx").on(t.reason, t.createdAt)],
);
