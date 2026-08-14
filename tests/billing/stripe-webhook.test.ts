import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createClient } from "@/db";
import { billingEvent, planGrant, referral, subscription, user } from "@/db/schema";
import {
  handleEvent,
  messageOf,
  onInvoicePaid,
  planFromSubscription,
  secondsToDate,
  type StripeEvent,
  userIdFrom,
} from "@/lib/billing/stripe/webhook";
import { receiveWebhook } from "@/lib/billing/stripe/receive";
import { signPayload } from "@/lib/billing/stripe/signature";
import { createGrant } from "@/lib/billing/store";

/**
 * What Stripe says, turned into rows.
 *
 * Against a real database, because the claims worth checking are database
 * claims: that a redelivered event changes nothing, that a failed one can be
 * retried, and that `user.plan` tracks the subscription through the whole
 * lifecycle rather than only at the moment somebody pays.
 */

describe("planFromSubscription", () => {
  it("reads the plan we wrote at checkout", () => {
    expect(planFromSubscription({ metadata: { planId: "learner" } })).toBe(
      "learner",
    );
  });

  it("calls anything still trialing a trial, whatever the metadata says", () => {
    // The one case where Stripe knows better than the note we left ourselves.
    expect(
      planFromSubscription({ status: "trialing", metadata: { planId: "pro" } }),
    ).toBe("trial");
  });

  it("falls back to free rather than guessing", () => {
    expect(planFromSubscription({})).toBe("free");
    expect(planFromSubscription({ metadata: { planId: "enterprise" } })).toBe(
      "free",
    );
  });
});

describe("userIdFrom", () => {
  it("prefers metadata", () => {
    expect(userIdFrom({ metadata: { userId: "u1" }, client_reference_id: "u2" })).toBe(
      "u1",
    );
  });

  it("falls back to the checkout reference", () => {
    expect(userIdFrom({ client_reference_id: "u2" })).toBe("u2");
  });

  it("is null when neither is present", () => {
    expect(userIdFrom({})).toBeNull();
    expect(userIdFrom({ metadata: { userId: "" } })).toBeNull();
  });
});

describe("messageOf", () => {
  it("uses an Error's own message", () => {
    expect(messageOf(new Error("customer had gone away"))).toBe(
      "customer had gone away",
    );
  });

  it("stringifies anything else", () => {
    // Its own function precisely because this arm cannot be provoked through
    // the handler — everything in there throws an Error.
    expect(messageOf("a bare string")).toBe("a bare string");
    expect(messageOf(undefined)).toBe("undefined");
  });
});

describe("secondsToDate", () => {
  it("converts Stripe's seconds", () => {
    expect(secondsToDate(1_760_000_000)).toEqual(new Date(1_760_000_000_000));
  });

  it.each([[null], [undefined], ["soon"], [Number.NaN]])(
    "is null for %s",
    (value) => {
      expect(secondsToDate(value)).toBeNull();
    },
  );
});

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("against a real database", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  afterAll(() => close());

  const PAYER = "billing-hook-payer";
  const FRIEND = "billing-hook-friend";
  const IDS = [PAYER, FRIEND];
  const NOW = new Date("2026-08-15T12:00:00.000Z");
  const PERIOD_END = Math.floor(
    new Date("2026-09-15T12:00:00.000Z").getTime() / 1000,
  );

  const eventIds = [
    "evt_hook_1",
    "evt_hook_2",
    "evt_hook_3",
    "evt_hook_4",
    "evt_hook_5",
  ];

  const subscriptionObject = (over: Record<string, unknown> = {}) => ({
    id: "sub_hook_1",
    customer: "cus_hook_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: PERIOD_END,
    metadata: { userId: PAYER, planId: "pro" },
    items: {
      data: [
        {
          price: {
            unit_amount: 2_499,
            currency: "eur",
            recurring: { interval: "month" },
          },
        },
      ],
    },
    ...over,
  });

  const event = (
    id: string,
    type: string,
    object: Record<string, unknown>,
  ): StripeEvent => ({ id, type, data: { object } });

  const planOf = async (userId: string) => {
    const [row] = await db
      .select({ plan: user.plan })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return row!.plan;
  };

  beforeEach(async () => {
    await db.delete(billingEvent).where(inArray(billingEvent.stripeEventId, eventIds));
    await db.delete(user).where(inArray(user.id, IDS));
    await db.insert(user).values([
      { id: PAYER, name: "Ana", email: "ana@billing-hook.local" },
      { id: FRIEND, name: "Bo", email: "bo@billing-hook.local" },
    ]);
  });

  describe("the subscription lifecycle", () => {
    it("records a new subscription and moves the plan", async () => {
      const result = await handleEvent(
        db,
        event(eventIds[0]!, "customer.subscription.created", subscriptionObject()),
        NOW,
      );

      expect(result).toEqual({
        status: "handled",
        event: "customer.subscription.created",
      });
      expect(await planOf(PAYER)).toBe("pro");

      const [row] = await db
        .select({
          amountCents: subscription.amountCents,
          currency: subscription.currency,
          interval: subscription.interval,
        })
        .from(subscription)
        .where(eq(subscription.userId, PAYER));
      expect(row).toEqual({ amountCents: 2_499, currency: "eur", interval: "month" });
    });

    it("stores a trialing subscription as the trial plan", async () => {
      await handleEvent(
        db,
        event(
          eventIds[0]!,
          "customer.subscription.created",
          subscriptionObject({ status: "trialing", trial_end: PERIOD_END }),
        ),
        NOW,
      );
      expect(await planOf(PAYER)).toBe("trial");
    });

    it("keeps the customer id on the account for the portal", async () => {
      await handleEvent(
        db,
        event(eventIds[0]!, "customer.subscription.created", subscriptionObject()),
        NOW,
      );

      const [row] = await db
        .select({ customer: user.stripeCustomerId })
        .from(user)
        .where(eq(user.id, PAYER));
      expect(row!.customer).toBe("cus_hook_1");
    });

    it("marks a cancellation that has not taken effect yet", async () => {
      await handleEvent(
        db,
        event(eventIds[0]!, "customer.subscription.created", subscriptionObject()),
        NOW,
      );
      await handleEvent(
        db,
        event(
          eventIds[1]!,
          "customer.subscription.updated",
          subscriptionObject({ cancel_at_period_end: true }),
        ),
        NOW,
      );

      const [row] = await db
        .select({ flag: subscription.cancelAtPeriodEnd })
        .from(subscription)
        .where(eq(subscription.userId, PAYER));
      expect(row!.flag).toBe(true);
      // Still paid for, so still Pro.
      expect(await planOf(PAYER)).toBe("pro");
    });

    it("drops the plan when the subscription is finally deleted", async () => {
      await handleEvent(
        db,
        event(eventIds[0]!, "customer.subscription.created", subscriptionObject()),
        NOW,
      );
      await handleEvent(
        db,
        event(eventIds[1]!, "customer.subscription.deleted", subscriptionObject()),
        NOW,
      );

      expect(await planOf(PAYER)).toBe("free");
    });

    it("stores safe defaults for a subscription with nothing readable on it", async () => {
      // Every fallback arm at once: no items, no status, no period end, an
      // unknown currency. Defaults that entitle nothing and charge nothing are
      // the right direction for a shape we did not expect.
      await handleEvent(
        db,
        event(eventIds[0]!, "customer.subscription.created", {
          id: "sub_hook_1",
          customer: "cus_hook_1",
          metadata: { userId: PAYER, planId: "pro" },
        }),
        NOW,
      );

      const [row] = await db
        .select({
          amountCents: subscription.amountCents,
          currency: subscription.currency,
          status: subscription.status,
          interval: subscription.interval,
        })
        .from(subscription)
        .where(eq(subscription.userId, PAYER));

      expect(row).toEqual({
        amountCents: 0,
        currency: "usd",
        status: "incomplete",
        interval: "month",
      });
      // Nothing readable means nothing entitled.
      expect(await planOf(PAYER)).toBe("free");
    });

    it("does not report a renewal as a cancellation", async () => {
      await handleEvent(
        db,
        event(eventIds[0]!, "customer.subscription.created", subscriptionObject()),
        NOW,
      );
      const result = await handleEvent(
        db,
        event(eventIds[1]!, "customer.subscription.updated", subscriptionObject()),
        NOW,
      );

      expect(result.status).toBe("handled");
      const [row] = await db
        .select({ flag: subscription.cancelAtPeriodEnd })
        .from(subscription)
        .where(eq(subscription.userId, PAYER));
      expect(row!.flag).toBe(false);
    });

    it("ignores a subscription it cannot attribute to an account", async () => {
      const result = await handleEvent(
        db,
        event(
          eventIds[0]!,
          "customer.subscription.created",
          subscriptionObject({ metadata: {}, client_reference_id: undefined }),
        ),
        NOW,
      );

      expect(result.status).toBe("handled");
      const rows = await db.select().from(subscription).where(eq(subscription.userId, PAYER));
      expect(rows).toHaveLength(0);
    });
  });

  describe("idempotency", () => {
    it("does nothing the second time an event is delivered", async () => {
      const e = event(eventIds[0]!, "customer.subscription.created", subscriptionObject());

      expect((await handleEvent(db, e, NOW)).status).toBe("handled");
      expect((await handleEvent(db, e, NOW)).status).toBe("replay");

      const rows = await db
        .select({ id: subscription.id })
        .from(subscription)
        .where(eq(subscription.userId, PAYER));
      expect(rows).toHaveLength(1);
    });

    it("acknowledges the checkout session without writing a subscription", async () => {
      // The session says a checkout finished; `subscription.created` says what
      // was bought, arrives however the subscription was started, and is the
      // only one of the two carrying the price.
      const result = await handleEvent(
        db,
        event(eventIds[0]!, "checkout.session.completed", {
          metadata: { userId: PAYER, planId: "pro" },
        }),
        NOW,
      );

      expect(result.status).toBe("handled");
      const rows = await db
        .select({ id: subscription.id })
        .from(subscription)
        .where(eq(subscription.userId, PAYER));
      expect(rows).toHaveLength(0);
    });

    it("writes nothing on a failed payment", async () => {
      // Stripe moves the subscription to `past_due` and sends
      // `customer.subscription.updated`, which is what this product reads.
      const result = await handleEvent(
        db,
        event(eventIds[0]!, "invoice.payment_failed", { customer: "cus_hook_1" }),
        NOW,
      );
      expect(result).toEqual({ status: "handled", event: "invoice.payment_failed" });
    });

    it("records the failure on the row and lets Stripe retry", async () => {
      // A handler that throws must leave the event reclaimable, or a transient
      // failure loses the event for good.
      // A subscription for an account that no longer exists: the foreign key
      // rejects the write, which is what a deleted learner mid-flight looks
      // like from here.
      const broken = event(
        eventIds[0]!,
        "customer.subscription.created",
        subscriptionObject({ metadata: { userId: "nobody-at-all", planId: "pro" } }),
      );

      await expect(handleEvent(db, broken, NOW)).rejects.toThrow();

      const [row] = await db
        .select({ error: billingEvent.error, processedAt: billingEvent.processedAt })
        .from(billingEvent)
        .where(eq(billingEvent.stripeEventId, eventIds[0]!));
      expect(row!.error).toContain('insert into "subscription"');
      expect(row!.processedAt).toBeNull();

      // And the retry gets to try again rather than being dismissed as a replay.
      await expect(handleEvent(db, broken, NOW)).rejects.toThrow();
    });

    it("files an event it does not act on, and says so", async () => {
      const result = await handleEvent(
        db,
        event(eventIds[0]!, "customer.discount.created", {}),
        NOW,
      );

      expect(result).toEqual({ status: "ignored", event: "customer.discount.created" });
      const rows = await db
        .select({ processedAt: billingEvent.processedAt })
        .from(billingEvent)
        .where(eq(billingEvent.stripeEventId, eventIds[0]!));
      expect(rows[0]!.processedAt).not.toBeNull();
    });
  });

  describe("referral qualification", () => {
    beforeEach(async () => {
      await db.insert(referral).values({
        code: "anacode",
        referrerId: FRIEND,
        refereeId: PAYER,
        status: "pending",
        signupAt: NOW,
      });
    });

    it("qualifies and pays out on the money arriving, never on the signup", async () => {
      await handleEvent(
        db,
        event(eventIds[0]!, "invoice.paid", {
          customer: "cus_hook_1",
          metadata: { userId: PAYER },
        }),
        NOW,
      );

      const [row] = await db
        .select({
          status: referral.status,
          paidAt: referral.firstPaymentAt,
          rewardedAt: referral.rewardedAt,
        })
        .from(referral)
        .where(eq(referral.refereeId, PAYER));

      expect(row!.paidAt).toEqual(NOW);
      // Qualification and payout happen together: there is no state in which
      // the money has arrived and the referrer is still waiting.
      expect(row!.status).toBe("rewarded");
      expect(row!.rewardedAt).toEqual(NOW);

      // And the referrer actually has the days.
      const grants = await db
        .select({ id: planGrant.id })
        .from(planGrant)
        .where(eq(planGrant.userId, FRIEND));
      expect(grants).toHaveLength(1);
    });

    it("does not pay out twice when the second month's invoice arrives", async () => {
      // `qualifyReferral` narrows to `pending`, so a renewal cannot restart the
      // clock on a reward that has already been given.
      await handleEvent(
        db,
        event(eventIds[0]!, "invoice.paid", { metadata: { userId: PAYER } }),
        NOW,
      );
      await handleEvent(
        db,
        event(eventIds[1]!, "invoice.paid", { metadata: { userId: PAYER } }),
        NOW,
      );

      const grants = await db
        .select({ id: planGrant.id })
        .from(planGrant)
        .where(eq(planGrant.userId, FRIEND));
      expect(grants).toHaveLength(1);
    });

    it("reverses the reward on a refund", async () => {
      await handleEvent(
        db,
        event(eventIds[0]!, "customer.subscription.created", subscriptionObject()),
        NOW,
      );
      const [ref] = await db
        .select({ id: referral.id })
        .from(referral)
        .where(eq(referral.refereeId, PAYER));

      await createGrant(
        db,
        {
          userId: FRIEND,
          planId: "pro",
          source: "referral",
          referralId: ref!.id,
          endsAt: new Date(NOW.getTime() + 14 * 86_400_000),
        },
        NOW,
      );
      expect(await planOf(FRIEND)).toBe("pro");

      await handleEvent(
        db,
        event(eventIds[1]!, "charge.refunded", { customer: "cus_hook_1" }),
        NOW,
      );

      const [row] = await db
        .select({ status: referral.status, reason: referral.rejectedReason })
        .from(referral)
        .where(eq(referral.refereeId, PAYER));
      expect(row!.status).toBe("rejected");
      expect(row!.reason).toBe("refunded");

      // The fourteen days go back too.
      expect(await planOf(FRIEND)).toBe("free");
      const [grant] = await db
        .select({ revokedAt: planGrant.revokedAt })
        .from(planGrant)
        .where(eq(planGrant.userId, FRIEND));
      expect(grant!.revokedAt).not.toBeNull();
    });

    it("shrugs at a refund for a customer it does not know", async () => {
      const result = await handleEvent(
        db,
        event(eventIds[0]!, "charge.refunded", { customer: "cus_stranger" }),
        NOW,
      );
      expect(result.status).toBe("handled");
    });

    it("shrugs at a refund with no customer on it", async () => {
      const result = await handleEvent(
        db,
        event(eventIds[0]!, "charge.refunded", {}),
        NOW,
      );
      expect(result.status).toBe("handled");
    });

    it("finds the payer by customer when the invoice carries no metadata", async () => {
      // Invoices do not inherit the subscription's metadata, so the customer id
      // is usually the only link back to an account.
      await handleEvent(
        db,
        event(eventIds[0]!, "customer.subscription.created", subscriptionObject()),
        NOW,
      );
      await handleEvent(
        db,
        event(eventIds[1]!, "invoice.paid", { customer: "cus_hook_1" }),
        NOW,
      );

      const [row] = await db
        .select({ status: referral.status })
        .from(referral)
        .where(eq(referral.refereeId, PAYER));
      expect(row!.status).toBe("rewarded");
    });

    describe("onInvoicePaid", () => {
      it("identifies the payer from metadata", async () => {
        expect(await onInvoicePaid(db, { metadata: { userId: PAYER } }, NOW)).toBe(
          true,
        );
      });

      it("identifies the payer from the customer id", async () => {
        // An invoice does not inherit the subscription's metadata, so this is
        // usually the only link back to an account.
        await handleEvent(
          db,
          event(eventIds[0]!, "customer.subscription.created", subscriptionObject()),
          NOW,
        );
        expect(await onInvoicePaid(db, { customer: "cus_hook_1" }, NOW)).toBe(true);
      });

      it("gives up on a payment with nothing to attribute it by", async () => {
        expect(await onInvoicePaid(db, {}, NOW)).toBe(false);
      });

      it("gives up on a customer with no subscription here", async () => {
        expect(await onInvoicePaid(db, { customer: "cus_never_seen" }, NOW)).toBe(
          false,
        );
      });
    });

    it("reverses on a dispute as well as on a refund", async () => {
      await handleEvent(
        db,
        event(eventIds[0]!, "customer.subscription.created", subscriptionObject()),
        NOW,
      );
      await handleEvent(
        db,
        event(eventIds[1]!, "charge.dispute.created", { customer: "cus_hook_1" }),
        NOW,
      );

      const [row] = await db
        .select({ status: referral.status })
        .from(referral)
        .where(eq(referral.refereeId, PAYER));
      expect(row!.status).toBe("rejected");
    });

    it("shrugs at a refund from a payer nobody referred", async () => {
      await db.delete(referral).where(eq(referral.refereeId, PAYER));
      await handleEvent(
        db,
        event(eventIds[0]!, "customer.subscription.created", subscriptionObject()),
        NOW,
      );

      const result = await handleEvent(
        db,
        event(eventIds[1]!, "charge.refunded", { customer: "cus_hook_1" }),
        NOW,
      );
      expect(result.status).toBe("handled");
    });

    it("leaves a payment alone when nobody referred the payer", async () => {
      await db.delete(referral).where(eq(referral.refereeId, PAYER));
      const result = await handleEvent(
        db,
        event(eventIds[0]!, "invoice.paid", { metadata: { userId: PAYER } }),
        NOW,
      );
      expect(result.status).toBe("handled");
    });
  });

  describe("receiveWebhook", () => {
    const SECRET = "whsec_receive_test";
    const seconds = Math.floor(NOW.getTime() / 1000);
    const env = { STRIPE_WEBHOOK_SECRET: SECRET };

    const post = (body: string, signature: string | null) =>
      receiveWebhook(db, { body, signature }, { env, nowSeconds: seconds, now: NOW });

    it("accepts a correctly signed event", async () => {
      const body = JSON.stringify(
        event(eventIds[0]!, "customer.subscription.created", subscriptionObject()),
      );
      const result = await post(body, signPayload(SECRET, body, seconds));

      expect(result.status).toBe(200);
      expect(await planOf(PAYER)).toBe("pro");
    });

    it("refuses an unsigned call", async () => {
      const result = await post("{}", null);
      expect(result.status).toBe(400);
    });

    it("refuses a tampered body", async () => {
      const body = JSON.stringify(event(eventIds[0]!, "invoice.paid", {}));
      const signature = signPayload(SECRET, body, seconds);
      const result = await post(body.replace("invoice.paid", "charge.refunded"), signature);

      expect(result.status).toBe(400);
      expect(result.body.error).toBe("signature did not match");
    });

    it("refuses a body that is not JSON", async () => {
      const body = "not json";
      const result = await post(body, signPayload(SECRET, body, seconds));
      expect(result.body.error).toBe("body is not JSON");
    });

    it("refuses JSON that is not an event", async () => {
      const body = JSON.stringify({ hello: "world" });
      const result = await post(body, signPayload(SECRET, body, seconds));
      expect(result.body.error).toBe("not a Stripe event");
    });

    it("refuses an event carrying no object", async () => {
      // Not something Stripe sends, but the handler reads it unconditionally
      // and a crash here would be a retry loop.
      const body = JSON.stringify({ id: "evt_x", type: "invoice.paid", data: {} });
      const result = await post(body, signPayload(SECRET, body, seconds));
      expect(result.body.error).toBe("event carries no object");
    });

    it("answers 500 so Stripe retries when the handler throws", async () => {
      // The event row keeps the error, and the retry re-enters as a fresh
      // claim because nothing marked it processed.
      const body = JSON.stringify(
        event(
          eventIds[0]!,
          "customer.subscription.created",
          subscriptionObject({
            metadata: { userId: "nobody-at-all", planId: "pro" },
          }),
        ),
      );

      const result = await post(body, signPayload(SECRET, body, seconds));

      expect(result.status).toBe(500);
      expect(result.body.error).toBe("could not handle the event");

      // The failure is on the row, not only in a log.
      const [row] = await db
        .select({ error: billingEvent.error })
        .from(billingEvent)
        .where(eq(billingEvent.stripeEventId, eventIds[0]!));
      expect(row!.error).not.toBeNull();
    });

    it("refuses everything when the secret is not configured", async () => {
      // An endpoint that writes subscriptions and cannot check its caller is
      // one anybody can grant themselves Pro through.
      const result = await receiveWebhook(
        db,
        { body: "{}", signature: "t=1,v1=x" },
        { env: {} },
      );
      expect(result.status).toBe(500);
    });

    it("reads the environment when none was passed", async () => {
      // The default argument is a branch like any other, and this is the one
      // the route actually takes.
      const result = await receiveWebhook(db, { body: "{}", signature: null });
      expect([400, 500]).toContain(result.status);
    });
  });
});
