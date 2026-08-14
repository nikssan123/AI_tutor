import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireUser } from "@/lib/account/session";
import { AppFrame, AppHeader } from "@/components/app-shell";
import { Button, ButtonLink, Card, Meta, Status, Title } from "@/components/ui";
import { CANCELLATION_REASONS } from "@/db/schema";
import { PLANS } from "@/lib/billing/catalog";
import { PLAN_COPY } from "@/lib/billing/plan-copy";
import { formatMoney, isCurrency } from "@/lib/billing/prices";
import { evaluationsRemaining, evaluationsUsed } from "@/lib/billing/quota";
import { entitlementsForUser, latestSubscription } from "@/lib/billing/store";
import {
  cancelSubscriptionAction,
  openPortalAction,
  resumeSubscriptionAction,
} from "./actions";

/**
 * What you are on, what it costs, and how to stop — PLAN-MONETIZATION §8.
 *
 * The rule this screen follows is the one in the memory note about user copy:
 * **state the consequence, not the mechanism.** "You still have Pro until
 * 20 August" is a sentence somebody can act on; "cancel_at_period_end is true"
 * is a database column wearing a coat.
 *
 * Cancelling is as easy as subscribing and asks for exactly one thing on the
 * way out — §25.1's mandatory reason, which is the only structured churn signal
 * this product will ever get.
 */
export const metadata: Metadata = {
  title: "Billing",
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ ok?: string; error?: string; cancel?: string }>;
};

const REASON_LABELS: Record<(typeof CANCELLATION_REASONS)[number], string> = {
  too_expensive: "Too expensive",
  not_enough_time: "Not enough time",
  didnt_find_what_i_wanted: "Didn't find what I wanted",
  ai_quality: "The marking or the tutor",
  learning_experience: "The learning experience",
  other: "Something else",
};

/** "20 August" — the only form of a date this screen ever shows. */
function readableDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
  }).format(date);
}

export default async function BillingPage({ searchParams }: Props) {
  const { ok, error, cancel } = await searchParams;
  const user = await requireUser();
  const db = getDb();

  const [subscription, resolved] = await Promise.all([
    latestSubscription(db, user.id),
    entitlementsForUser(db, user.id, user.plan),
  ]);

  const plan = PLANS[resolved.planId];
  const copy = PLAN_COPY[resolved.planId];
  const limit = plan.entitlements.evaluationsPerMonth;

  const [used, left] = await Promise.all([
    evaluationsUsed(db, user.id),
    evaluationsRemaining(db, user.id, limit),
  ]);

  const currency =
    subscription && isCurrency(subscription.currency)
      ? subscription.currency
      : undefined;

  const paying = subscription !== undefined && resolved.source === "subscription";
  const ending = subscription?.cancelAtPeriodEnd === true;

  return (
    <AppFrame width="narrow">
      <AppHeader
        title="Billing"
        lead="What you are on, what it costs, and how to stop."
      />

      {ok ? <Status tone="verified">{ok}</Status> : null}
      {error ? <Status tone="problem">{error}</Status> : null}

      <Card className="flex flex-col gap-3">
        <Title>{copy.name}</Title>

        {resolved.source === "grant" ? (
          <Meta>
            You are on {copy.name} from a referral. Nothing to pay, and nothing
            renews.
          </Meta>
        ) : null}

        {paying && subscription && currency ? (
          <Meta>
            {formatMoney(subscription.amountCents, currency)} a{" "}
            {subscription.interval === "year" ? "year" : "month"}
            {ending
              ? ` · you still have ${copy.name} until ${readableDate(subscription.currentPeriodEnd)}`
              : ` · renews ${readableDate(subscription.currentPeriodEnd)}`}
          </Meta>
        ) : null}

        {!paying && resolved.source !== "grant" ? (
          <Meta>Free, for as long as you like.</Meta>
        ) : null}

        <p className="text-[length:var(--text-body-size)] leading-[var(--text-body-line)]">
          {left === 0
            ? `You have used all ${limit} of this month's graded ${limit === 1 ? "project" : "projects"}.`
            : `${left} of ${limit} graded ${limit === 1 ? "project" : "projects"} left this month.`}
          {used > 0 ? ` Used ${used} so far.` : null}
        </p>

        <div className="flex flex-wrap gap-3">
          {!paying ? (
            <ButtonLink href="/pricing">See the plans</ButtonLink>
          ) : (
            <form action={openPortalAction}>
              <Button variant="text">Payment details and invoices</Button>
            </form>
          )}

          {paying && ending ? (
            <form action={resumeSubscriptionAction}>
              <Button>Keep my subscription</Button>
            </form>
          ) : null}

          {paying && !ending ? (
            <ButtonLink href="/account/billing?cancel=1" variant="text">
              Cancel
            </ButtonLink>
          ) : null}
        </div>
      </Card>

      {/*
        `subscription &&` rather than `paying &&`: both mean the same thing
        here, but only the first narrows the type, so the date below needs no
        second guard that could never be false.
      */}
      {subscription && paying && !ending && cancel ? (
        <Card className="flex flex-col gap-4">
          <Title>Before you go</Title>
          <Meta>
            {`You will keep ${copy.name} until ${readableDate(subscription.currentPeriodEnd)}. Nothing is charged after that.`}
          </Meta>

          <form action={cancelSubscriptionAction} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
              <legend className="text-[length:var(--text-label-size)] font-[550] mb-2">
                Why are you leaving?
              </legend>
              {CANCELLATION_REASONS.map((reason) => (
                <label key={reason} className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="reason"
                    value={reason}
                    required
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-[length:var(--text-body-size)]">
                    {REASON_LABELS[reason]}
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="flex flex-col gap-2">
              <span className="text-[length:var(--text-label-size)] font-[550]">
                Anything else? (optional)
              </span>
              <textarea
                name="comment"
                rows={3}
                className="bg-ground rounded-[var(--radius-control)] border border-hairline p-3 text-[length:var(--text-body-size)]"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <Button variant="text">Cancel my subscription</Button>
              <ButtonLink href="/account/billing">Never mind</ButtonLink>
            </div>
          </form>
        </Card>
      ) : null}

      {resolved.planId !== "pro" ? (
        <Card className="flex flex-col gap-3">
          <Title>More graded work</Title>
          <Meta>
            Pro marks {PLANS.pro.entitlements.evaluationsPerMonth} projects a
            month against the same public rubrics.
          </Meta>
          <ButtonLink href="/pricing" variant="text">
            Compare the plans
          </ButtonLink>
        </Card>
      ) : null}
    </AppFrame>
  );
}
