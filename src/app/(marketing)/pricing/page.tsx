import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ChecklistIcon, GridIcon, StepsIcon } from "@/components/icons";
import {
  JsonLdScript,
  PageFrame,
  PageIntro,
  SectionHead,
} from "@/components/marketing";
import {
  Button,
  ButtonLink,
  Card,
  Meta,
  revealAt,
  Title,
} from "@/components/ui";
import { LISTED_PLAN_IDS, PLANS } from "@/lib/billing/catalog";
import { PLAN_COPY, TRIAL_TERMS } from "@/lib/billing/plan-copy";
import {
  annualSavingPercent,
  CURRENCIES,
  CURRENCY_COOKIE,
  formatMoney,
  requirePrice,
  resolveCurrency,
} from "@/lib/billing/prices";
import { breadcrumbs, faqPage, priceOffers } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";
import { setCurrencyAction, startCheckoutAction } from "./actions";

/**
 * §17 of the brief and PLAN-MONETIZATION §8 — the price list.
 *
 * Three things about this page are decisions rather than layout.
 *
 * **The numbers are read, not typed.** Every price comes from `prices.ts` and
 * every quota from `PLANS`; the annual saving is computed and rounded down. A
 * pricing page is the easiest place in a product to tell a lie by accident, and
 * the way to stop that is to leave nothing for a person to keep in sync.
 *
 * **One filled button** (§8.5.5), and it is the €3 trial. The design system
 * decides the primary CTA for us, which is a better reason than a guess.
 *
 * **Currency is chosen on the server.** PLAN-LOCALIZATION §6.5 describes a
 * static page plus a client island that swaps on a mismatch; this route is
 * already rendered per request (`(marketing)/layout.tsx` — `SiteHeader` reads
 * the session), so the cookie can simply be read here. That removes the island,
 * the reserved-width slot and the CLS risk the island existed to manage, and it
 * keeps the switcher working with JavaScript off.
 */

export const revalidate = 86_400;

const TITLE = "Pricing: free to start, €3 to try everything";
const DESCRIPTION =
  "A free plan that grades your work, a €3 four-day trial of everything, and two subscriptions. No contracts, no per-message counting, cancel in one click.";

export async function generateMetadata(): Promise<Metadata> {
  return marketingMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: "/pricing",
  });
}

const FAQS = [
  {
    question: "What happens when the €3 trial ends?",
    answer:
      "After four days it renews as Pro at the monthly price shown above, and we email you the day before so it is never a surprise. Cancel before then from your account and you pay nothing more.",
  },
  {
    question: "What counts as a graded project?",
    answer:
      "One piece of real work handed in and marked against a public rubric, with every judgement quoted back from what you wrote. Lessons, practice questions and tutor conversation are not metered.",
  },
  {
    question: "Can I change plan or cancel?",
    answer:
      "Any time, from your account. A cancellation keeps everything running until the end of the period you have already paid for.",
  },
  {
    question: "Can I switch currency?",
    answer:
      "Before you subscribe, yes. Afterwards the currency is fixed for that subscription — cancel and resubscribe to change it.",
  },
];

export default async function PricingPage() {
  const jar = await cookies();
  const currency = resolveCurrency(
    undefined,
    jar.get(CURRENCY_COOKIE)?.value,
  );

  const price = (planId: "trial" | "learner" | "pro", interval: "month" | "year" = "month") =>
    requirePrice(planId, interval, currency);

  const proMonthly = price("pro");
  const proAnnual = price("pro", "year");
  const saving = annualSavingPercent(currency);

  const amount = (planId: (typeof LISTED_PLAN_IDS)[number]) =>
    planId === "free" ? 0 : price(planId as "trial" | "learner" | "pro").amountCents;

  return (
    <PageFrame crumbs={[{ name: "Pricing", path: "/pricing" }]}>
      <JsonLdScript
        blocks={[
          breadcrumbs([{ name: "Pricing", path: "/pricing" }]),
          priceOffers({
            name: "MeritKeep",
            description: DESCRIPTION,
            path: "/pricing",
            currency,
            // Every purchasable price the page renders, the annual one
            // included — it is the dearest thing here, so leaving it out would
            // make `highPrice` describe a page nobody sees.
            amountsCents: [
              ...LISTED_PLAN_IDS.filter((id) => id !== "free").map((id) =>
                amount(id),
              ),
              proAnnual.amountCents,
            ],
          }),
          faqPage(FAQS),
        ]}
      />

      <PageIntro
        icon={<ChecklistIcon />}
        title="Start learning today"
        lead="Everything here is priced on the one thing that costs us anything and is worth something to you: your work, marked."
        facts={
          <form action={setCurrencyAction} className="flex items-center gap-3">
            <Meta>Prices in</Meta>
            {CURRENCIES.map((option) => (
              <button
                key={option}
                name="currency"
                value={option}
                type="submit"
                aria-current={option === currency}
                className={
                  option === currency
                    ? "text-ink underline underline-offset-4"
                    : "text-ink-faint hover:text-ink"
                }
              >
                {option.toUpperCase()}
              </button>
            ))}
          </form>
        }
      />

      <section
        aria-label="Plans"
        className="grid gap-5 md:grid-cols-2 lg:grid-cols-4"
      >
        {LISTED_PLAN_IDS.map((planId, i) => {
          const copy = PLAN_COPY[planId];
          const cents = amount(planId);

          return (
            <Card
              key={planId}
              className={`flex flex-col gap-5 reveal ${revealAt(i)}`}
            >
              <div className="flex flex-col gap-2">
                <Title>{copy.name}</Title>
                <span className="text-[length:var(--text-lead-size)]">
                  {planId === "free"
                    ? formatMoney(0, currency)
                    : formatMoney(cents, currency)}
                  {planId === "learner" || planId === "pro" ? (
                    <Meta> a month</Meta>
                  ) : null}
                  {planId === "trial" ? <Meta> for 4 days</Meta> : null}
                </span>
                <Meta>{copy.pitch}</Meta>
              </div>

              <ul className="flex flex-col gap-2 list-none m-0 p-0">
                {copy.features.map((feature) => (
                  <li
                    key={feature}
                    className="text-[length:var(--text-body-size)] leading-[var(--text-body-line)]"
                  >
                    {feature}
                  </li>
                ))}
              </ul>

              {/*
                Free goes to sign-up rather than to Stripe: there is nothing to
                charge, and sending somebody to a checkout that immediately
                bounces them back is the sort of dead end §8 screen 6a exists to
                remove.
              */}
              {planId === "free" ? (
                <ButtonLink href="/sign-up" variant="text" className="mt-auto">
                  {copy.cta}
                </ButtonLink>
              ) : (
                <form action={startCheckoutAction} className="mt-auto">
                  <input type="hidden" name="plan" value={planId} />
                  <input type="hidden" name="interval" value="month" />
                  <Button variant={copy.emphasis ? "primary" : "text"}>
                    {copy.cta}
                  </Button>
                </form>
              )}
            </Card>
          );
        })}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHead
          step="01"
          label="The trial"
          title="What €3 buys, exactly"
          icon={<ChecklistIcon />}
        />
        <Card className="flex flex-col gap-3">
          <p className="text-[length:var(--text-body-size)] leading-[var(--text-body-line)] max-w-[var(--measure)]">
            {TRIAL_TERMS.replace(
              "{price}",
              formatMoney(proMonthly.amountCents, currency),
            )}
          </p>
          <Meta>
            {PLANS.trial.entitlements.evaluationsPerMonth} graded projects is
            more than anyone finishes in four days. We would rather you ran out
            of time than out of allowance.
          </Meta>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHead
          step="02"
          label="Annual"
          title={`Pay for a year, save ${saving}%`}
          icon={<StepsIcon />}
        />
        <Card className="flex flex-col gap-3">
          <span className="text-[length:var(--text-lead-size)]">
            {formatMoney(proAnnual.amountCents, currency)}
            <Meta> a year</Meta>
          </span>
          <Meta>
            Against {formatMoney(proMonthly.amountCents, currency)} a month, that
            is {saving}% off. Worth it once you know you are staying — there is
            no rush.
          </Meta>
          <form action={startCheckoutAction}>
            <input type="hidden" name="plan" value="pro" />
            <input type="hidden" name="interval" value="year" />
            <Button variant="text">Choose annual</Button>
          </form>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHead
          step="03"
          label="Questions"
          title="The things people ask"
          icon={<GridIcon />}
        />
        <div className="flex flex-col gap-4">
          {FAQS.map((faq) => (
            <Card key={faq.question} className="flex flex-col gap-2">
              <Title>{faq.question}</Title>
              <p className="text-[length:var(--text-body-size)] leading-[var(--text-body-line)] max-w-[var(--measure)]">
                {faq.answer}
              </p>
            </Card>
          ))}
        </div>
      </section>
    </PageFrame>
  );
}
