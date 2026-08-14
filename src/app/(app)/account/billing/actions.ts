"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/account/session";
import { CANCELLATION_REASONS } from "@/db/schema";
import { latestSubscription, recordCancellationSurvey } from "@/lib/billing/store";
import { createPortalSession } from "@/lib/billing/stripe/checkout";
import { getStripe } from "@/lib/billing/stripe/client";
import { capture } from "@/lib/observability";

/**
 * Managing a subscription — PLAN-MONETIZATION §8.
 *
 * Cancelling is deliberately as easy as subscribing, and the only thing asked
 * for on the way out is the one question §25.1 marks **mandatory**: why. That
 * answer is the sole structured signal this product will ever get about churn,
 * and §14's decide-or-drop table reads it.
 */

const BILLING = "/account/billing";

function done(message: string): never {
  redirect(`${BILLING}?ok=${encodeURIComponent(message)}`);
}

function failed(message: string): never {
  redirect(`${BILLING}?error=${encodeURIComponent(message)}`);
}

/** Hand off to Stripe for card details and invoices — see §6 on PCI scope. */
export async function openPortalAction(): Promise<void> {
  const user = await requireUser();
  const subscription = await latestSubscription(getDb(), user.id);

  if (!subscription) failed("There is no subscription to manage yet.");

  const portal = await createPortalSession(
    getStripe(),
    subscription.stripeCustomerId,
  );
  redirect(portal.url);
}

/**
 * Cancel at the end of the paid period, never immediately.
 *
 * Somebody who cancels on day 2 has paid for the rest of the month and keeps
 * it — which is both fair and what `entitlementsFor` already concludes from a
 * subscription that is `active` with `cancelAtPeriodEnd` set.
 */
export async function cancelSubscriptionAction(
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const db = getDb();

  const reason = String(formData.get("reason") ?? "");
  if (!(CANCELLATION_REASONS as readonly string[]).includes(reason)) {
    // The reason is required, so a missing one is a refusal rather than a
    // silently blank row. §25.1 puts "mandatory" in bold.
    failed("Please tell us why you are leaving — it is the one thing we ask.");
  }

  const subscription = await latestSubscription(db, user.id);
  if (!subscription) failed("There is no subscription to cancel.");

  await recordCancellationSurvey(db, {
    userId: user.id,
    subscriptionId: subscription.id,
    reason,
    comment: String(formData.get("comment") ?? "").trim() || null,
  });

  // Stripe is the source of truth: it sends `customer.subscription.updated`,
  // and the webhook writes our row. Setting it here as well would be a second
  // writer for one fact.
  await getStripe().post(
    `/subscriptions/${subscription.stripeSubscriptionId}`,
    { cancel_at_period_end: true },
    `cancel:${subscription.stripeSubscriptionId}`,
  );

  capture("subscription_cancelled", { at_period_end: true, reason });
  revalidatePath(BILLING);
  done("Cancelled. You keep everything until the end of this period.");
}

/** Undo a cancellation that has not taken effect yet. */
export async function resumeSubscriptionAction(): Promise<void> {
  const user = await requireUser();
  const subscription = await latestSubscription(getDb(), user.id);

  if (!subscription) failed("There is no subscription to resume.");

  await getStripe().post(
    `/subscriptions/${subscription.stripeSubscriptionId}`,
    { cancel_at_period_end: false },
    `resume:${subscription.stripeSubscriptionId}`,
  );

  capture("subscription_reactivated", { plan: subscription.planId });
  revalidatePath(BILLING);
  done("Welcome back. Your subscription will renew as normal.");
}
