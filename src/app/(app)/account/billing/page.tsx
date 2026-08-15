import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireUser } from "@/lib/account/session";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import { TickIcon } from "@/components/icons";
import {
  Button,
  ButtonLink,
  Card,
  cx,
  Figure,
  HeroBand,
  Meta,
  stagger,
  Status,
  type StatusTone,
  Title,
} from "@/components/ui";
import { CANCELLATION_REASONS } from "@/db/schema";
import { PLANS } from "@/lib/billing/catalog";
import { PLAN_COPY, sessionCount } from "@/lib/billing/plan-copy";
import { formatMoney, isCurrency } from "@/lib/billing/prices";
import { evaluationsRemaining } from "@/lib/billing/quota";
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
 *
 * ## Why this is `wide`, and why that is now the default answer
 *
 * It shipped `narrow`, which is §8.5.9's exception for a screen that is *one*
 * task — a goal form, a sign-in — and this is not that screen. Four unrelated
 * cards stacked one per row in a 624px column left ~350px of dead gutter either
 * side of a page three viewports tall, which is the same fault `/account` was
 * fixed for. `narrow` is for a form you fill in; anything made of several
 * cards goes `wide` and pairs them.
 *
 * ## What the screen is arranged around
 *
 * One number: how much graded work is left this month. That is the thing a
 * learner opens this page to check, so it is the loudest thing on it (§8.5.9 —
 * a screen with no size above `title` has no shape), and the plan, the price
 * and the renewal date are the facts sitting around it on the band's field.
 * Everything below the band is context you read *after* that answer.
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

/**
 * When the meter starts again.
 *
 * The quota is counted per calendar month in UTC — `periodOf` in
 * `lib/ai/runlog.ts` is `toISOString().slice(0, 7)` — so the reset is the first
 * of the next month, and saying so beats "monthly", which leaves someone who
 * has run out to work out for themselves whether that means days or weeks.
 * `Date.UTC` rolls December over on its own; there is no December branch here
 * because there does not need to be one.
 */
function nextReset(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * What is left, as marks rather than as a bar.
 *
 * §8.5.5 bans percentage progress bars, and rightly: a percentage of an
 * allowance is a number nobody can act on. This is a *count* — one segment per
 * graded project the plan includes, lit while it is still yours — which is the
 * same instrument `Confidence` uses for the same reason, and it is legible at a
 * glance in a way "70%" is not.
 *
 * The segments flex rather than take a fixed width, so a plan with one
 * evaluation draws one full mark instead of a lonely dash, and a plan with ten
 * draws ten without running off the card.
 *
 * `aria-hidden`, because the `Figure` directly above it already says "7 of 10"
 * in words. A second announcement of the same fact is noise in the a11y tree.
 */
function QuotaMeter({ left, limit }: { left: number; limit: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-1.5 w-full max-w-[20rem] gap-1.5"
    >
      {Array.from({ length: limit }, (_, i) => (
        <span
          key={i}
          className={cx(
            "flex-1 rounded-[var(--radius-pill)]",
            i < left ? "bg-accent" : "bg-hairline",
          )}
        />
      ))}
    </span>
  );
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
  const left = await evaluationsRemaining(db, user.id, limit);

  const currency =
    subscription && isCurrency(subscription.currency)
      ? subscription.currency
      : undefined;

  const paying = subscription !== undefined && resolved.source === "subscription";
  const ending = subscription?.cancelAtPeriodEnd === true;
  // Inside §5's fourteen-day grace: the card failed, the account still works,
  // and the one useful thing this screen can do is say so before it stops.
  const failing = paying && subscription?.status === "past_due";

  /*
   * The line under the plan name — price, interval and what happens next, in
   * one sentence rather than three stacked facts.
   *
   * `price` is separable because `currency` can be missing: the column is plain
   * text written from Stripe, and a currency we do not sell in must not stop
   * the renewal date being shown. Dropping the money is the right failure —
   * "renews 20 August" is still true and still useful.
   */
  const price =
    subscription && currency
      ? `${formatMoney(subscription.amountCents, currency)} a ${
          subscription.interval === "year" ? "year" : "month"
        }`
      : null;

  const renewal = subscription
    ? ending
      ? `you still have ${copy.name} until ${readableDate(subscription.currentPeriodEnd)}`
      : `renews ${readableDate(subscription.currentPeriodEnd)}`
    : null;

  const summary =
    resolved.source === "grant"
      ? "Free from a referral · nothing to pay, and nothing renews"
      : paying
        ? [price, renewal].filter(Boolean).join(" · ")
        : "Free, for as long as you like.";

  const state: { tone: StatusTone; label: string } = failing
    ? { tone: "problem", label: "Payment failed" }
    : ending
      ? { tone: "attention", label: "Ending" }
      : paying
        ? { tone: "verified", label: "Active" }
        : resolved.source === "grant"
          ? { tone: "verified", label: "On us" }
          : { tone: "neutral", label: "Free plan" };

  const projects = limit === 1 ? "project" : "projects";

  /**
   * Sessions a month, or `null` for as many as the spend cap allows.
   *
   * Read from the catalog rather than assumed, because the answer stopped
   * being the same for every plan: Free is capped and the paid plans are not.
   */
  const metered = plan.entitlements.sessionsPerMonth;

  return (
    <AppFrame>
      {/* No facts row: the band below carries the plan, the price and the
          renewal date, and a header repeating them would say each twice. */}
      <AppHeader
        title="Billing"
        lead="What you are on, what it costs, and how to stop."
      />

      {ok ? <Status tone="verified">{ok}</Status> : null}
      {error ? <Status tone="problem">{error}</Status> : null}

      <HeroBand
        className="rise"
        style={stagger(1)}
        field={
          <>
            <div className="flex flex-col gap-1">
              <Title>{copy.name}</Title>
              {/* `muted` rather than the default `faint`: this sits on the
                  accent field, where `--ink-faint` misses the 4.5:1 bar 13px
                  text is held to (§8.5.4). */}
              <Meta tone="muted">{summary}</Meta>
            </div>
            <Status tone={state.tone}>{state.label}</Status>
          </>
        }
        footer={
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
              {paying ? (
                <form action={openPortalAction}>
                  <Button variant={failing ? "primary" : "text"}>
                    {failing ? "Update your card" : "Payment details and invoices"}
                  </Button>
                </form>
              ) : (
                <ButtonLink href="/pricing">See the plans</ButtonLink>
              )}

              {paying && ending ? (
                <form action={resumeSubscriptionAction}>
                  <Button>Keep my subscription</Button>
                </form>
              ) : null}

              {paying && !ending ? (
                <ButtonLink href="/account/billing?cancel=1#cancel" variant="text">
                  Cancel
                </ButtonLink>
              ) : null}
            </div>

            {paying ? (
              <Meta>Cancel whenever you like — you keep the period you paid for.</Meta>
            ) : null}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Figure
            value={left}
            unit={`of ${limit}`}
            caption={`graded ${projects} left this month`}
          />
          <QuotaMeter left={left} limit={limit} />
          {/*
            The middle clause used to be a flat "Lessons, practice and the
            tutor are not metered", which was true of every plan when it was
            written and stopped being true of Free the day Free became three
            learning sessions a month. A billing screen telling somebody their
            sessions are unmetered while the meter turns them away on the
            fourth is the worst version of getting this wrong, so the sentence
            reads the plan rather than asserting over all of them.
          */}
          <p className="max-w-[var(--measure)] text-[length:var(--text-body-size)] leading-[var(--text-body-line)] text-ink-muted">
            {left === 0
              ? `You have used all ${limit} of this month's graded ${projects}. `
              : metered === null
                ? `Lessons, practice and the tutor are not metered — only work you hand in to be marked. `
                : `${copy.name} also covers ${sessionCount(metered)} a month; only work you hand in to be marked counts against the ${limit} above. `}
            {`The count starts again on ${readableDate(nextReset(new Date()))}.`}
          </p>
        </div>
      </HeroBand>

      {failing ? (
        <Card className="rise flex flex-col gap-3" style={stagger(2)}>
          <Title>Your last payment did not go through</Title>
          <Meta>
            Nothing has stopped yet. Update the card and it picks up where it
            left off; leave it and {copy.name} ends when the retries do.
          </Meta>
        </Card>
      ) : null}

      {/*
        `subscription &&` rather than `paying &&`: both mean the same thing
        here, but only the first narrows the type, so the date below needs no
        second guard that could never be false.

        `spotlight` for the same reason `/account`'s Email card wears it — a
        link sent you here, and on a page of bands the one you were sent to
        should be the one wearing a border.
      */}
      {subscription && paying && !ending && cancel ? (
        <Card
          id="cancel"
          className="rise spotlight flex flex-col gap-6"
          style={stagger(2)}
        >
          <div className="flex flex-col gap-2">
            <Title>Before you go</Title>
            <Meta>
              {`You will keep ${copy.name} until ${readableDate(subscription.currentPeriodEnd)}. Nothing is charged after that.`}
            </Meta>
          </div>

          <form
            action={cancelSubscriptionAction}
            className="grid items-start gap-6 sm:grid-cols-2"
          >
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-[length:var(--text-label-size)] font-[550]">
                Why are you leaving?
              </legend>
              {CANCELLATION_REASONS.map((reason) => (
                /*
                 * A whole selectable row rather than a dot with a word beside
                 * it. `:has()` is what makes the chosen one visible without a
                 * line of JavaScript — this segment ships none, and a radio
                 * group whose selection is a 13px dot is the sort of control
                 * people click twice because they cannot tell if it took.
                 */
                <label
                  key={reason}
                  className={cx(
                    "flex min-h-[var(--touch-min)] cursor-pointer items-center gap-3 px-4",
                    "rounded-[var(--radius-control)] border border-hairline",
                    "transition-[background-color,border-color] duration-[var(--dur-fast)]",
                    "hover:border-accent has-[:checked]:border-accent has-[:checked]:bg-accent-weak",
                  )}
                >
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

            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-[length:var(--text-label-size)] font-[550]">
                  Anything else? (optional)
                </span>
                <textarea
                  name="comment"
                  rows={6}
                  className="rounded-[var(--radius-control)] border border-hairline bg-ground p-3 text-[length:var(--text-body-size)] outline-none transition-[border-color,box-shadow] duration-[var(--dur-fast)] focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-weak)]"
                />
              </label>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-3 border-t border-hairline pt-4">
                <Button variant="text">Cancel my subscription</Button>
                <ButtonLink href="/account/billing">Never mind</ButtonLink>
              </div>
            </div>
          </form>
        </Card>
      ) : null}

      <section className="rise flex flex-col gap-6" style={stagger(3)}>
        <SectionHead label="Included" title={`What ${copy.name} gives you`} />
        <Card>
          <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
            {copy.features.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <TickIcon className="mt-0.5 size-5 text-accent" />
                <span className="text-[length:var(--text-body-size)] leading-[var(--text-body-line)]">
                  {feature}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {resolved.planId !== "pro" ? (
        <section className="rise flex flex-col gap-6" style={stagger(4)}>
          <SectionHead label="Upgrade" title="More graded work" />
          <Card className="grid items-center gap-6 sm:grid-cols-2">
            <Figure
              value={PLANS.pro.entitlements.evaluationsPerMonth}
              unit="a month"
              caption="graded projects on Pro"
            />
            <div className="flex flex-col items-start gap-4">
              <Meta>
                The same public rubrics and the same evidence quoted back — more
                of it, and on our most capable models.
              </Meta>
              <ButtonLink href="/pricing" variant="text">
                Compare the plans
              </ButtonLink>
            </div>
          </Card>
        </section>
      ) : null}
    </AppFrame>
  );
}
