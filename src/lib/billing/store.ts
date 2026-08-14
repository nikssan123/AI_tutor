import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  billingEvent,
  cancellationSurvey,
  planGrant,
  subscription,
  user,
} from "@/db/schema";
import { type PlanId, resolvePlanId } from "./catalog";
import {
  entitlementsFor,
  type GrantSnapshot,
  isSubscriptionStatus,
  type ResolvedEntitlement,
  type SubscriptionSnapshot,
} from "./entitlements";

/**
 * Reading and writing what somebody is paying for.
 *
 * Every function takes its `Db` rather than reaching for `getDb()`, which is
 * what lets the webhook, the server actions and the tests run the same code
 * with different handles — and what lets a write and the bookkeeping it implies
 * share one transaction. Same rule `src/lib/mail/store.ts` states.
 */

/**
 * Narrowed handles, so the functions below can be handed a transaction.
 *
 * The same device `src/lib/admin/audit.ts` uses for `AuditWriter`: a Drizzle
 * transaction is not assignable to `Db` (it has no `$client`), and the point of
 * these functions is that a mutation passes its own transaction so the
 * reconciliation commits or rolls back with the change that caused it.
 */
export type BillingReader = Pick<Db, "select">;
export type BillingWriter = Pick<Db, "select" | "update">;

export interface SubscriptionRow {
  id: string;
  userId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  planId: string;
  interval: string;
  currency: string;
  amountCents: number;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  endedAt: Date | null;
}

/**
 * The subscription the resolver should read, which is the newest one.
 *
 * Newest rather than "the active one" on purpose: a lapsed subscription still
 * has to be visible to `entitlementsFor`, because a row that exists and has
 * ended is what stops a stale `user.plan` from handing out a paid plan
 * indefinitely (§5). Filtering to active here would reintroduce exactly the
 * fallback that ordering is designed to prevent.
 */
export async function latestSubscription(
  db: BillingReader,
  userId: string,
): Promise<SubscriptionRow | undefined> {
  const [row] = await db
    .select({
      id: subscription.id,
      userId: subscription.userId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      stripeCustomerId: subscription.stripeCustomerId,
      planId: subscription.planId,
      interval: subscription.interval,
      currency: subscription.currency,
      amountCents: subscription.amountCents,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      trialEndsAt: subscription.trialEndsAt,
      endedAt: subscription.endedAt,
    })
    .from(subscription)
    .where(eq(subscription.userId, userId))
    .orderBy(desc(subscription.createdAt))
    .limit(1);

  return row;
}

/**
 * A stored row as the pure resolver wants it.
 *
 * An unreadable `status` resolves to `incomplete`, which entitles nothing. The
 * column is plain `text` and the value came from Stripe, so "a status we have
 * never heard of" is a real possibility, and the safe direction for an unknown
 * one is to grant nothing rather than everything.
 */
export function toSnapshot(row: SubscriptionRow): SubscriptionSnapshot {
  return {
    planId: resolvePlanId(row.planId),
    status: isSubscriptionStatus(row.status) ? row.status : "incomplete",
    currentPeriodEnd: row.currentPeriodEnd,
  };
}

/** Grants that have not been revoked and have not yet ended. */
export async function liveGrants(
  db: BillingReader,
  userId: string,
  now: Date = new Date(),
): Promise<GrantSnapshot[]> {
  const rows = await db
    .select({
      planId: planGrant.planId,
      startsAt: planGrant.startsAt,
      endsAt: planGrant.endsAt,
      revokedAt: planGrant.revokedAt,
    })
    .from(planGrant)
    .where(
      and(
        eq(planGrant.userId, userId),
        isNull(planGrant.revokedAt),
        gt(planGrant.endsAt, now),
      ),
    );

  return rows.map((row) => ({ ...row, planId: resolvePlanId(row.planId) }));
}

/**
 * What this account is entitled to, right now — the one call the product makes.
 *
 * Two reads and a pure function. The `plan` argument is the `user.plan` column
 * the caller already has on the session DTO, passed in rather than re-fetched
 * so a page that has a session does not pay for a third query.
 */
export async function entitlementsForUser(
  db: BillingReader,
  userId: string,
  plan: unknown,
  now: Date = new Date(),
): Promise<ResolvedEntitlement> {
  const [row, grants] = await Promise.all([
    latestSubscription(db, userId),
    liveGrants(db, userId, now),
  ]);

  return entitlementsFor(
    { plan, subscription: row ? toSnapshot(row) : null, grants },
    now,
  );
}

export interface SubscriptionUpsert {
  userId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  planId: PlanId;
  interval: string;
  currency: string;
  amountCents: number;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  endedAt: Date | null;
}

/**
 * Write what Stripe just told us, and bring `user.plan` back in line with it.
 *
 * Both in one transaction, because the cache and the row it caches must never
 * be observed disagreeing — a page that reads `user.plan` between the two
 * writes would render the wrong plan, and it is the page a learner lands on
 * immediately after paying.
 *
 * `user.plan` follows *entitlement*, not the subscription's `planId`: a
 * cancelled Pro subscription writes `free`, which is what the resolver would
 * have concluded anyway. Keeping the cache and the resolver in agreement is the
 * whole reason the cache is allowed to exist.
 */
export async function saveSubscription(
  db: Db,
  input: SubscriptionUpsert,
  now: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(subscription)
      .values({ ...input, updatedAt: now })
      .onConflictDoUpdate({
        target: subscription.stripeSubscriptionId,
        set: {
          planId: input.planId,
          interval: input.interval,
          currency: input.currency,
          amountCents: input.amountCents,
          status: input.status,
          currentPeriodEnd: input.currentPeriodEnd,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd,
          trialEndsAt: input.trialEndsAt,
          endedAt: input.endedAt,
          updatedAt: now,
        },
      });

    await reconcilePlan(tx, input.userId, now);
  });
}

/**
 * Recompute `user.plan` from the rows that own it.
 *
 * The one place that writes the column. Everything else — the webhook, a
 * reward, a revocation — calls this rather than setting it, which is what makes
 * "two places holding one fact" survivable.
 */
export async function reconcilePlan(
  db: BillingWriter,
  userId: string,
  now: Date = new Date(),
): Promise<PlanId> {
  const [row, grants] = await Promise.all([
    latestSubscription(db, userId),
    liveGrants(db, userId, now),
  ]);

  const resolved = entitlementsFor(
    // `plan` is deliberately not read back: this function computes the column
    // rather than consulting it, and feeding it its own previous value would
    // let a wrong one persist through every future reconciliation.
    { subscription: row ? toSnapshot(row) : null, grants },
    now,
  );

  await db
    .update(user)
    .set({ plan: resolved.planId, updatedAt: now })
    .where(eq(user.id, userId));

  return resolved.planId;
}

export interface GrantInput {
  userId: string;
  planId: PlanId;
  source: "referral" | "comp";
  endsAt: Date;
  reason?: string | null;
  referralId?: string | null;
  startsAt?: Date;
}

/** Give somebody time they did not buy, and update their cached plan. */
export async function createGrant(
  db: Db,
  input: GrantInput,
  now: Date = new Date(),
): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(planGrant)
      .values({
        userId: input.userId,
        planId: input.planId,
        source: input.source,
        reason: input.reason ?? null,
        referralId: input.referralId ?? null,
        startsAt: input.startsAt ?? now,
        endsAt: input.endsAt,
      })
      .returning({ id: planGrant.id });

    await reconcilePlan(tx, input.userId, now);
    // An insert with `returning` always yields the row it just wrote.
    return row!.id;
  });
}

/**
 * Withdraw every grant that a referral paid for.
 *
 * Revocation rather than deletion, so the record of what was given and taken
 * back survives — a referral that was rewarded and then reversed is exactly the
 * history an abuse investigation needs, and a deleted row tells it nothing.
 */
export async function revokeGrantsForReferral(
  db: Db,
  referralId: string,
  now: Date = new Date(),
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(planGrant)
      .set({ revokedAt: now })
      .where(
        and(eq(planGrant.referralId, referralId), isNull(planGrant.revokedAt)),
      )
      .returning({ userId: planGrant.userId });

    const affected = [...new Set(rows.map((r) => r.userId))];
    for (const userId of affected) await reconcilePlan(tx, userId, now);
    return affected;
  });
}

/**
 * Claim a webhook for processing, and say whether the caller owns it.
 *
 * `false` means this event has **already been handled successfully** and the
 * caller must do nothing. `true` means either it is new, or a previous attempt
 * filed it and failed before finishing.
 *
 * That second case is the whole subtlety. A plain `onConflictDoNothing` would
 * make every retry a no-op — including the retry of an attempt that threw
 * halfway — so a transient failure would lose the event permanently, which is
 * the opposite of what filing it was for. The `where` narrows the conflict to
 * rows nothing has finished, so:
 *
 * - **new** → inserted, claimed;
 * - **filed but unprocessed** → reclaimed, and Stripe's retry re-runs it;
 * - **processed** → no row, and the replay does nothing.
 *
 * Retrying is safe because every handler is individually idempotent: the
 * subscription write is an upsert, the referral transitions are writes to a
 * fixed state, and revocation only touches grants that are not already revoked.
 */
export async function recordEvent(
  db: Db,
  event: { id: string; type: string; payload: unknown },
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .insert(billingEvent)
    .values({
      stripeEventId: event.id,
      type: event.type,
      payload: event.payload as Record<string, unknown>,
      receivedAt: now,
    })
    .onConflictDoUpdate({
      target: billingEvent.stripeEventId,
      set: { receivedAt: now, error: null },
      setWhere: isNull(billingEvent.processedAt),
    })
    .returning({ id: billingEvent.id });

  return rows.length > 0;
}

/** Mark a filed event handled, or record why it was not. */
export async function closeEvent(
  db: Db,
  stripeEventId: string,
  error: string | null = null,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(billingEvent)
    .set({ processedAt: error === null ? now : null, error })
    .where(eq(billingEvent.stripeEventId, stripeEventId));
}

export interface SurveyInput {
  userId: string;
  subscriptionId?: string | null;
  reason: string;
  comment?: string | null;
}

/** §25.1's mandatory exit reason. */
export async function recordCancellationSurvey(
  db: Db,
  input: SurveyInput,
  now: Date = new Date(),
): Promise<void> {
  await db.insert(cancellationSurvey).values({
    userId: input.userId,
    subscriptionId: input.subscriptionId ?? null,
    reason: input.reason,
    comment: input.comment ?? null,
    createdAt: now,
  });
}

/**
 * How many people gave each reason, most common first.
 *
 * The whole point of making the reason mandatory is that this query is worth
 * running; §25.1 asks for it and the Learner tier's fate (§14) depends on it.
 */
export async function cancellationReasons(
  db: Db,
): Promise<Array<{ reason: string; count: number }>> {
  return db
    .select({
      reason: cancellationSurvey.reason,
      count: sql<number>`count(*)::int`,
    })
    .from(cancellationSurvey)
    .groupBy(cancellationSurvey.reason)
    .orderBy(sql`count(*) desc`);
}
