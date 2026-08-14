"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { withDestination } from "@/lib/account/next-url";
import { isPlanId } from "@/lib/billing/catalog";
import {
  CURRENCY_COOKIE,
  isCurrency,
  resolveCurrency,
} from "@/lib/billing/prices";
import { latestSubscription } from "@/lib/billing/store";
import { createCheckoutSession } from "@/lib/billing/stripe/checkout";
import { getStripe } from "@/lib/billing/stripe/client";
import { capture } from "@/lib/observability";
import { localeOf } from "@/lib/i18n/locales";

/**
 * Starting a checkout, and choosing a currency.
 *
 * Both are form POSTs, like everything else here, and for the same reason: this
 * is the moment somebody decides to pay, and it must not depend on a bundle
 * downloading first.
 *
 * Nothing but `async` functions may be exported from this file —
 * `pnpm actions:audit` fails the build otherwise, and it fails it for a real
 * reason: a constant exported from a `"use server"` module type-checks, lints,
 * passes every test and then takes the route down in the bundler.
 */

export async function setCurrencyAction(formData: FormData): Promise<void> {
  const wanted = String(formData.get("currency") ?? "");
  if (!isCurrency(wanted)) redirect("/pricing");

  const jar = await cookies();
  jar.set(CURRENCY_COOKIE, wanted, {
    // A year, and readable by the server that renders the price. Not
    // `httpOnly: false` for any client to read — the page is server-rendered,
    // so nothing in the browser needs it.
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    path: "/",
  });

  redirect("/pricing");
}

/**
 * Send somebody to Stripe.
 *
 * Signed-out visitors are sent to sign up first, carrying their choice through
 * the redirect so they land back here rather than on `/today` having forgotten
 * why they came. `withDestination` is the mechanism sign-up already uses.
 */
export async function startCheckoutAction(formData: FormData): Promise<void> {
  const planId = String(formData.get("plan") ?? "");
  const interval = String(formData.get("interval") ?? "month");

  if (!isPlanId(planId) || planId === "free") redirect("/pricing");

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) {
    redirect(withDestination("/sign-up", `/pricing?plan=${planId}`));
  }

  const jar = await cookies();
  const currency = resolveCurrency(
    localeOf(session.user),
    jar.get(CURRENCY_COOKIE)?.value,
  );

  const db = getDb();
  const existing = await latestSubscription(db, session.user.id);

  capture("checkout_started", { plan: planId, interval, currency });

  const checkout = await createCheckoutSession(getStripe(), {
    userId: session.user.id,
    planId,
    interval: interval === "year" ? "year" : "month",
    currency,
    // Reuse the Stripe customer so a resubscribe does not create a second one.
    customerId: existing?.stripeCustomerId ?? null,
    email: session.user.email,
  });

  // `url` is null only when Stripe was asked for a session it could not host,
  // which is a configuration error rather than something a learner can fix.
  if (!checkout.url) redirect("/pricing?error=checkout");
  redirect(checkout.url);
}
