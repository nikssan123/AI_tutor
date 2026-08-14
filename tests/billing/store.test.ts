import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createClient } from "@/db";
import {
  billingEvent,
  planGrant,
  referral,
  subscription,
  user,
} from "@/db/schema";
import { PLANS } from "@/lib/billing/catalog";
import {
  cancellationReasons,
  closeEvent,
  createGrant,
  entitlementsForUser,
  latestSubscription,
  liveGrants,
  reconcilePlan,
  recordCancellationSurvey,
  recordEvent,
  revokeGrantsForReferral,
  saveSubscription,
  type SubscriptionUpsert,
  toSnapshot,
} from "@/lib/billing/store";

/**
 * The billing store, against a real database.
 *
 * These are database properties — that a replayed Stripe webhook cannot be
 * filed twice, that `user.plan` never disagrees with the rows that own it,
 * that revoking a referral's grants puts both parties back where they were — so
 * a mock would be asserting on the mock.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("against a real database", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  afterAll(() => close());

  const PAYER = "billing-store-payer";
  const FRIEND = "billing-store-friend";
  const IDS = [PAYER, FRIEND];

  const NOW = new Date("2026-08-15T12:00:00.000Z");
  const days = (n: number) =>
    new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

  const upsert = (over: Partial<SubscriptionUpsert> = {}): SubscriptionUpsert => ({
    userId: PAYER,
    stripeSubscriptionId: "sub_billing_store_1",
    stripeCustomerId: "cus_billing_store_1",
    planId: "pro",
    interval: "month",
    currency: "eur",
    amountCents: 2_499,
    status: "active",
    currentPeriodEnd: days(20),
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    endedAt: null,
    ...over,
  });

  const planOf = async (id: string) => {
    const [row] = await db
      .select({ plan: user.plan })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);
    return row!.plan;
  };

  beforeEach(async () => {
    await db
      .delete(billingEvent)
      .where(eq(billingEvent.stripeEventId, "evt_billing_store_1"));
    // `subscription`, `plan_grant` and `cancellation_survey` all cascade from
    // `user`, so deleting the accounts clears them.
    await db.delete(user).where(inArray(user.id, IDS));
    await db.insert(user).values([
      { id: PAYER, name: "Ana", email: "ana@billing-store.local" },
      { id: FRIEND, name: "Bo", email: "bo@billing-store.local" },
    ]);
  });

  describe("saveSubscription", () => {
    it("writes the row and moves user.plan with it", async () => {
      await saveSubscription(db, upsert(), NOW);

      const row = await latestSubscription(db, PAYER);
      expect(row?.stripeSubscriptionId).toBe("sub_billing_store_1");
      expect(row?.amountCents).toBe(2_499);
      expect(await planOf(PAYER)).toBe("pro");
    });

    it("upserts on the Stripe id rather than adding a second row", async () => {
      // `customer.subscription.updated` arrives more than once for the same
      // subscription; without the unique index this is two rows and the
      // resolver reads whichever it finds first.
      await saveSubscription(db, upsert(), NOW);
      await saveSubscription(
        db,
        upsert({ cancelAtPeriodEnd: true, status: "active" }),
        NOW,
      );

      const rows = await db
        .select({ id: subscription.id })
        .from(subscription)
        .where(eq(subscription.userId, PAYER));
      expect(rows).toHaveLength(1);
      expect((await latestSubscription(db, PAYER))?.cancelAtPeriodEnd).toBe(
        true,
      );
    });

    it("drops user.plan back to free when the subscription ends", async () => {
      await saveSubscription(db, upsert(), NOW);
      expect(await planOf(PAYER)).toBe("pro");

      await saveSubscription(
        db,
        upsert({ status: "canceled", endedAt: NOW }),
        NOW,
      );
      expect(await planOf(PAYER)).toBe("free");
    });

    it("keeps a cancelled-but-not-expired subscription paid up", async () => {
      // Somebody who cancelled on day 2 paid for the rest of the month.
      await saveSubscription(
        db,
        upsert({ status: "active", cancelAtPeriodEnd: true }),
        NOW,
      );
      expect(await planOf(PAYER)).toBe("pro");
    });
  });

  describe("latestSubscription", () => {
    it("finds nothing for an account that never paid", async () => {
      expect(await latestSubscription(db, FRIEND)).toBeUndefined();
    });

    it("returns a lapsed row rather than hiding it", async () => {
      // The resolver needs to see that a subscription existed and ended —
      // that is what stops a stale `user.plan` handing out a paid plan.
      await saveSubscription(db, upsert({ status: "canceled" }), NOW);
      expect((await latestSubscription(db, PAYER))?.status).toBe("canceled");
    });
  });

  describe("toSnapshot", () => {
    it("reads an unknown status as entitling nothing", async () => {
      await saveSubscription(db, upsert({ status: "dunning_v2" }), NOW);
      const row = await latestSubscription(db, PAYER);
      expect(toSnapshot(row!).status).toBe("incomplete");
    });
  });

  describe("createGrant", () => {
    it("gives time nobody paid for and updates the cached plan", async () => {
      await createGrant(
        db,
        { userId: FRIEND, planId: "pro", source: "referral", endsAt: days(14) },
        NOW,
      );

      expect(await planOf(FRIEND)).toBe("pro");
      expect(await liveGrants(db, FRIEND, NOW)).toHaveLength(1);
    });

    it("caps a grant at the trial ceiling, not Pro's", async () => {
      // §1 decision 10 — a grant is not a payment.
      await createGrant(
        db,
        { userId: FRIEND, planId: "pro", source: "referral", endsAt: days(14) },
        NOW,
      );

      const resolved = await entitlementsForUser(db, FRIEND, "free", NOW);
      expect(resolved.source).toBe("grant");
      expect(resolved.spendCapCents).toBe(PLANS.trial.spendCapCents);
    });

    it("records the reason on a comp", async () => {
      await createGrant(
        db,
        {
          userId: FRIEND,
          planId: "pro",
          source: "comp",
          reason: "Conference speaker",
          endsAt: days(30),
        },
        NOW,
      );

      const [row] = await db
        .select({ reason: planGrant.reason, source: planGrant.source })
        .from(planGrant)
        .where(eq(planGrant.userId, FRIEND));
      expect(row).toEqual({ reason: "Conference speaker", source: "comp" });
    });
  });

  describe("liveGrants", () => {
    it("excludes one that has already ended", async () => {
      await createGrant(
        db,
        { userId: FRIEND, planId: "pro", source: "comp", endsAt: days(-1) },
        NOW,
      );
      expect(await liveGrants(db, FRIEND, NOW)).toHaveLength(0);
    });
  });

  describe("revokeGrantsForReferral", () => {
    it("withdraws both sides and puts both plans back", async () => {
      // The refund path. Revocation rather than deletion, so the history an
      // abuse investigation needs survives.
      const [created] = await db
        .insert(referral)
        .values({
          code: "anacode",
          referrerId: PAYER,
          refereeId: FRIEND,
          status: "rewarded",
          signupAt: NOW,
          firstPaymentAt: NOW,
        })
        .returning({ id: referral.id });
      const referralId = created!.id;

      for (const userId of [PAYER, FRIEND]) {
        await createGrant(
          db,
          {
            userId,
            planId: "pro",
            source: "referral",
            referralId,
            endsAt: days(14),
          },
          NOW,
        );
      }

      const affected = await revokeGrantsForReferral(db, referralId, NOW);
      expect(affected.sort()).toEqual([PAYER, FRIEND].sort());
      expect(await planOf(PAYER)).toBe("free");
      expect(await planOf(FRIEND)).toBe("free");
      // Revoked, not deleted.
      const rows = await db
        .select({ revokedAt: planGrant.revokedAt })
        .from(planGrant)
        .where(eq(planGrant.referralId, referralId));
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.revokedAt).not.toBeNull();
    });

    it("affects nobody when the referral paid for nothing", async () => {
      expect(
        await revokeGrantsForReferral(
          db,
          "00000000-0000-4000-8000-00000000cafe",
          NOW,
        ),
      ).toEqual([]);
    });
  });

  describe("reconcilePlan", () => {
    it("prefers a grant over a lapsed subscription", async () => {
      await saveSubscription(db, upsert({ status: "canceled" }), NOW);
      await createGrant(
        db,
        { userId: PAYER, planId: "pro", source: "comp", endsAt: days(7) },
        NOW,
      );
      expect(await reconcilePlan(db, PAYER, NOW)).toBe("pro");
      expect(await planOf(PAYER)).toBe("pro");
    });

    it("does not consult the column it is computing", async () => {
      // A wrong value must not be able to persist through reconciliation.
      await db.update(user).set({ plan: "pro" }).where(eq(user.id, FRIEND));
      expect(await reconcilePlan(db, FRIEND, NOW)).toBe("free");
      expect(await planOf(FRIEND)).toBe("free");
    });
  });

  describe("recordEvent", () => {
    const event = { id: "evt_billing_store_1", type: "invoice.paid", payload: { a: 1 } };

    it("files a new event", async () => {
      expect(await recordEvent(db, event, NOW)).toBe(true);
    });

    it("refuses a replay of an event that was handled", async () => {
      // The unique index is the idempotency mechanism: the handler claims
      // before it acts, so a replay of finished work stops here.
      expect(await recordEvent(db, event, NOW)).toBe(true);
      await closeEvent(db, event.id, null, NOW);
      expect(await recordEvent(db, event, NOW)).toBe(false);
    });

    it("lets a retry reclaim an attempt that failed", async () => {
      // The subtlety worth a test of its own. A plain do-nothing conflict would
      // make every retry a no-op — including the retry of an attempt that threw
      // halfway — so a transient failure would lose the event permanently,
      // which is the opposite of what filing it was for.
      expect(await recordEvent(db, event, NOW)).toBe(true);
      await closeEvent(db, event.id, "customer had gone away", NOW);

      expect(await recordEvent(db, event, NOW)).toBe(true);

      // Reclaiming clears the previous attempt's error.
      const [row] = await db
        .select({ error: billingEvent.error })
        .from(billingEvent)
        .where(eq(billingEvent.stripeEventId, event.id));
      expect(row!.error).toBeNull();
    });

    it("keeps the raw payload", async () => {
      await recordEvent(db, event, NOW);
      const [row] = await db
        .select({ payload: billingEvent.payload, type: billingEvent.type })
        .from(billingEvent)
        .where(eq(billingEvent.stripeEventId, event.id));
      expect(row!.payload).toEqual({ a: 1 });
      expect(row!.type).toBe("invoice.paid");
    });
  });

  describe("closeEvent", () => {
    const event = { id: "evt_billing_store_1", type: "invoice.paid", payload: {} };

    it("stamps a handled event", async () => {
      await recordEvent(db, event, NOW);
      await closeEvent(db, event.id, null, NOW);

      const [row] = await db
        .select({ processedAt: billingEvent.processedAt, error: billingEvent.error })
        .from(billingEvent)
        .where(eq(billingEvent.stripeEventId, event.id));
      expect(row!.processedAt).toEqual(NOW);
      expect(row!.error).toBeNull();
    });

    it("leaves a failed one unprocessed, with the reason", async () => {
      await recordEvent(db, event, NOW);
      await closeEvent(db, event.id, "no such customer", NOW);

      const [row] = await db
        .select({ processedAt: billingEvent.processedAt, error: billingEvent.error })
        .from(billingEvent)
        .where(eq(billingEvent.stripeEventId, event.id));
      expect(row!.processedAt).toBeNull();
      expect(row!.error).toBe("no such customer");
    });
  });

  describe("cancellation survey", () => {
    it("records a reason and counts the answers", async () => {
      await saveSubscription(db, upsert(), NOW);
      const row = await latestSubscription(db, PAYER);

      await recordCancellationSurvey(db, {
        userId: PAYER,
        subscriptionId: row!.id,
        reason: "too_expensive",
        comment: "Would pay 10",
      });
      await recordCancellationSurvey(db, {
        userId: FRIEND,
        reason: "too_expensive",
      });

      const counts = await cancellationReasons(db);
      const expensive = counts.find((c) => c.reason === "too_expensive");
      expect(expensive?.count).toBeGreaterThanOrEqual(2);
    });
  });

  describe("entitlementsForUser", () => {
    it("falls back to the column when there is nothing else", async () => {
      const resolved = await entitlementsForUser(db, FRIEND, "learner", NOW);
      expect(resolved.planId).toBe("learner");
      expect(resolved.source).toBe("plan");
    });

    it("reads the subscription when there is one", async () => {
      await saveSubscription(db, upsert({ planId: "learner" }), NOW);
      const resolved = await entitlementsForUser(db, PAYER, "free", NOW);
      expect(resolved.planId).toBe("learner");
      expect(resolved.source).toBe("subscription");
      expect(resolved.entitlements.evaluationsPerMonth).toBe(
        PLANS.learner.entitlements.evaluationsPerMonth,
      );
    });
  });
});
