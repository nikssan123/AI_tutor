import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  PriceIcon,
  QuestionIcon,
  StepsIcon,
  TickIcon,
} from "@/components/icons";
import {
  FaqList,
  JsonLdScript,
  PageFrame,
  PageIntro,
  SectionHead,
} from "@/components/marketing";
import {
  Button,
  ButtonLink,
  Card,
  cx,
  Meta,
  revealAt,
  Status,
  Title,
} from "@/components/ui";
import { LISTED_PLAN_IDS, PLANS } from "@/lib/billing/catalog";
import { PLAN_COPY, TRIAL_TERMS } from "@/lib/billing/plan-copy";
import {
  ANNUAL_PLAN_IDS,
  annualPerMonthCents,
  annualSavingPercent,
  CURRENCIES,
  CURRENCY_COOKIE,
  formatMoney,
  requirePrice,
  resolveCurrency,
  smallestAnnualSavingPercent,
} from "@/lib/billing/prices";
import { breadcrumbs, faqPage, priceOffers } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";
import { supportAddress } from "@/lib/site";
import { setCurrencyAction, startCheckoutAction } from "./actions";

/**
 * §17 of the brief and PLAN-MONETIZATION §8 — the price list.
 *
 * Four things about this page are decisions rather than layout.
 *
 * **The numbers are read, not typed.** Every price comes from `prices.ts` and
 * every quota from `PLANS`; the annual saving is computed and rounded down. A
 * pricing page is the easiest place in a product to tell a lie by accident, and
 * the way to stop that is to leave nothing for a person to keep in sync.
 *
 * **One filled button** (§8.5.5), and it is the €3 trial. The design system
 * decides the primary CTA for us, which is a better reason than a guess. That
 * is also why the currency switcher's selected state is `accent-weak` rather
 * than a fill: two filled controls on a page and neither is the primary one.
 *
 * **Currency is chosen on the server.** PLAN-LOCALIZATION §6.5 describes a
 * static page plus a client island that swaps on a mismatch; this route is
 * already rendered per request (`(marketing)/layout.tsx` — `SiteHeader` reads
 * the session), so the cookie can simply be read here. That removes the island,
 * the reserved-width slot and the CLS risk the island existed to manage, and it
 * keeps the switcher working with JavaScript off.
 *
 * **The trial is drawn as four days rather than described as terms.** §13 risk
 * 3 makes an unexpected renewal the trial's main danger, and the defence
 * against it is not a longer disclaimer — it is a reader who can see the whole
 * four days at once, including the day we email them and the day it renews.
 * `TRIAL_TERMS` is still printed underneath, word for word, because the
 * sentence the brief fixes is the one that must survive a redesign.
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

/**
 * The plan the €3 buys, and therefore the card that carries the offer.
 *
 * Not a layout preference — it is what `stripe/checkout.ts` does: the checkout
 * line item for a trial *is* the Pro price, `trial_period_days` holds the
 * charge off for four days, and the €3 rides the first invoice as a one-off
 * fee. "Try Pro" was never a plan; it is Pro, discounted at the door.
 */
const OFFER_ON = "pro";

/**
 * The plans that get a card — every listed one except the trial.
 *
 * The trial keeps its row in `LISTED_PLAN_IDS` because it is still a real
 * purchasable price and the `AggregateOffer` markup below has to include it.
 * What it loses is a column of its own, which is the thing that made this row
 * hard to read: three monthly plans and a four-day offer, side by side, asking
 * a visitor to compare a duration against a rate.
 *
 * Filtered here rather than in `catalog.ts` deliberately. `LISTED_PLAN_IDS`
 * answers "what can somebody buy", which has not changed; this answers "what
 * does this page draw a column for", which is a question about this page.
 */
const CARD_PLAN_IDS = LISTED_PLAN_IDS.filter((id) => id !== "trial");

/**
 * The one line of small print that belongs under a price rather than in a
 * feature list — what it costs you to say yes.
 *
 * It is here rather than in `PLAN_COPY` because it is not a feature: the
 * billing screen renders that array as "what your plan gives you", and "no card
 * needed" is not something a plan gives you, it is a term of buying it.
 *
 * It also does structural work. Pro carries the €3 offer in this slot, and with
 * only Pro filling it the shared header row was as tall as Pro's and left an
 * unexplained 50px hole under the price on the other two cards — the same fault
 * `/account` was fixed for, at card scale. Every card has something true to say
 * here, so the row is full rather than padded.
 */
const UNDER_PRICE: Record<string, string> = {
  free: "No card. It does not expire.",
  learner: "Cancel any time. You keep the month.",
};

/** What a bounced checkout says, in the words of the thing that bounced it. */
const CHECKOUT_ERRORS: Record<string, string> = {
  "trial-used": "You have already had your four days. Pro is below at its usual price.",
  checkout: "We could not open the checkout. Nothing has been charged — please try again.",
};

/**
 * The questions, given the price the page is actually showing.
 *
 * A function rather than a constant because the first question named the fee,
 * and named it "€3" — so a dollar reader got a heading asking about €3 directly
 * under a card offering $3. Same drift as the section heading below, same fix:
 * the number is read, never typed. The array is built per request either way —
 * `cookies()` already makes this route dynamic — so nothing is lost by it.
 */
const faqs = (trialPrice: string) => [
  {
    question: `What happens when the ${trialPrice} trial ends?`,
    answer:
      "After four days it renews as Pro at the monthly price shown above, and we email you the day before so it is never a surprise. Cancel before then from your account and you pay nothing more.",
  },
  {
    question: "What counts as a graded project?",
    answer:
    /*
     * The last sentence used to read "Lessons, practice questions and tutor
     * conversation are not metered." That was true of every plan when it was
     * written and stopped being true of Free the day Free became three
     * learning sessions a month — a flat "not metered" on the page selling the
     * plan it is not true of is the exact failure this file's opening note is
     * about.
     *
     * It says what is still true instead: nothing inside a session is counted
     * against your graded work. How many sessions a plan includes is a number,
     * so it is left to the cards, which read it from `PLANS` — restating it
     * here would be the same figure typed in a second place, which is how the
     * sentence went stale in the first place.
     */
      "One piece of real work handed in and marked against a public rubric, with every judgement quoted back from what you wrote. Nothing you do inside a learning session — practice questions, tutor conversation — counts against it. How many sessions each plan includes is on the cards above.",
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

/**
 * What holds whatever you pay us.
 *
 * Every line here is something the product enforces rather than something a
 * price list would like to be true — the rule `plan-copy.ts` is built on,
 * applied to the claims that sit outside any one plan. The rubric is published
 * before the work (§4.2 law 2), the verdict quotes the learner's own words
 * (§4.2 law 1), and a cancellation runs to the end of the paid period because
 * `cancelSubscriptionAction` cancels at period end and nowhere else.
 */
const ALWAYS = [
  {
    title: "The checklist comes first",
    body: "Every graded project publishes the rubric before you start. Read it here, without an account.",
  },
  {
    title: "Evidence, not vibes",
    body: "Every judgement quotes the line of your own work it came from.",
  },
  {
    /*
     * This said "Only marking is metered — lessons, practice and the tutor are
     * not counted", which is the same sentence that had to be corrected on the
     * billing screen and in the FAQ, missed here on the third pass. Free is
     * capped at sessions *and* tutor questions, so a band headed "whatever you
     * pay" is the last place that claim can stand: it is the one part of the
     * page that promises to be true of every plan.
     *
     * What is left is the thing `cancelSubscriptionAction` actually enforces —
     * it cancels at period end and nowhere else — and it is a better claim
     * anyway, because it is the one a reader about to pay is weighing.
     */
    title: "Leave whenever",
    body: "Cancel in one click. You keep the period you have already paid for.",
  },
];

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; interval?: string }>;
}) {
  /*
   * `startCheckoutAction` bounces back here with `?error=` on the two things
   * that can stop a checkout, and until now this page rendered neither of
   * them. Somebody who had already used their four days pressed the button and
   * arrived back on an identical page with no explanation — a dead end at the
   * exact moment they were trying to pay us.
   */
  const { error, interval } = await searchParams;
  const refusal = error ? CHECKOUT_ERRORS[error] : undefined;

  /*
   * Monthly or yearly, in the URL rather than in a cookie or in state.
   *
   * A query parameter because this is a *view* of the price list, not a
   * preference about the reader: it should survive a refresh, be linkable —
   * "here, look at the annual price" — and cost no client JavaScript, which
   * §8.5.8 does not allow this surface to spend anyway. The switch below is
   * two links, so it works with scripting off like everything else here.
   */
  const yearly = interval === "year";

  const jar = await cookies();
  const currency = resolveCurrency(
    undefined,
    jar.get(CURRENCY_COOKIE)?.value,
  );

  const price = (planId: "trial" | "learner" | "pro", interval: "month" | "year" = "month") =>
    requirePrice(planId, interval, currency);

  const proMonthly = price("pro");

  /*
   * The floor of the savings on offer, not Pro's.
   *
   * This label sits above every card, so the one figure it may carry is the
   * smallest one any of them can prove — and since Learner started selling a
   * year at a shallower discount than Pro's, that is no longer the same number.
   * Each card states its own saving underneath its own price.
   */
  const saving = smallestAnnualSavingPercent(currency);

  const amount = (planId: (typeof LISTED_PLAN_IDS)[number]) =>
    planId === "free" ? 0 : price(planId as "trial" | "learner" | "pro").amountCents;

  /** Built here so the marked-up questions and the rendered ones are one list. */
  const questions = faqs(formatMoney(amount("trial"), currency));

  /** The four days, as days rather than as a paragraph of terms. */
  const trialDays = [
    {
      when: "Today",
      what: `${formatMoney(amount("trial"), currency)}, once. That is the only charge to start.`,
    },
    {
      when: "For four days",
      what: `Everything Pro has, including ${PLANS.trial.entitlements.evaluationsPerMonth} graded projects.`,
    },
    {
      when: "The day before it renews",
      what: "We email you. Nobody should discover a renewal from their bank.",
    },
    {
      when: "After that",
      what: `It becomes Pro at ${formatMoney(proMonthly.amountCents, currency)} a month, until you stop it.`,
    },
  ];

  /**
   * The section numbers, counted rather than typed.
   *
   * The trial band is section one and belongs to the monthly view — there is no
   * four-day version of a year, so the yearly view does not draw it — and the
   * numbers below it were written as literals. That left the yearly view running
   * "02 · Whatever you pay", "03 · Questions" with no 01, which reads as a
   * section that failed to render rather than one that was never offered.
   *
   * An offset rather than a running counter: a counter would have to be mutated
   * from inside the JSX to be read in document order, and the numbers here are a
   * property of *which bands exist*, which is one boolean.
   */
  const step = (n: number) => String(yearly ? n - 1 : n).padStart(2, "0");

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
            // Every purchasable price the page renders, the annual ones
            // included — the dearest thing here is a year, so leaving them out
            // would make `highPrice` describe a page nobody sees. Read off
            // `ANNUAL_PLAN_IDS` rather than named, so a plan that starts
            // selling a year is marked up by having a row in the table.
            amountsCents: [
              ...LISTED_PLAN_IDS.filter((id) => id !== "free").map((id) =>
                amount(id),
              ),
              ...ANNUAL_PLAN_IDS.map((id) => price(id, "year").amountCents),
            ],
          }),
          faqPage(questions),
        ]}
      />

      <PageIntro
        icon={<PriceIcon />}
        title="Start learning today"
        lead="Everything here is priced on the one thing that costs us anything and is worth something to you: your work, marked."
        facts={
          <>
            {/*
             * A pill track, like every other two-to-four-way switch in the
             * product (§8.5.5) — but built out of submit buttons rather than
             * links, because the choice is written to a cookie the checkout
             * also reads. The selected one is `accent-weak`, not a fill: the
             * page's single filled button belongs to the trial.
             */}
            {/*
             * How often you are billed. Two links in the same pill track as the
             * currency switch beside it, because they are the same kind of
             * control and looking different would imply they behave
             * differently.
             *
             * Links rather than the currency switch's submit buttons, and that
             * difference *is* meaningful: currency is a preference we store
             * about the reader and the checkout reads back, so it writes a
             * cookie; the interval is a view of this page, so it lives in the
             * URL and can be sent to somebody.
             *
             * The saving rides on the label, which is where every price list
             * that has this control puts it — and it is the *smallest* saving,
             * read per currency, because neither the two columns nor the two
             * plans round to the same discount. "30%+" over a card that saves
             * 33% understates the offer; "33%" over one that saves 30% is a
             * claim the page cannot prove.
             */}
            <span className="flex items-center gap-3">
              <Meta>Billed</Meta>
              <span className="inline-flex gap-1 rounded-[var(--radius-pill)] bg-surface p-1 shadow-[var(--shadow-raised)]">
                {[
                  { label: "Monthly", href: "/pricing", on: !yearly },
                  {
                    label: `Yearly · save ${saving}%+`,
                    href: "/pricing?interval=year",
                    on: yearly,
                  },
                ].map((option) => (
                  <Link
                    key={option.href}
                    href={option.href}
                    aria-current={option.on ? "page" : undefined}
                    className={cx(
                      "inline-flex min-h-9 items-center rounded-[var(--radius-pill)] px-4",
                      "text-[length:var(--text-label-size)] font-[550]",
                      "transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                      option.on
                        ? "bg-accent-weak text-accent"
                        : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {option.label}
                  </Link>
                ))}
              </span>
            </span>

            {/*
             * The currency switch keeps its form: the choice is written to a
             * cookie the checkout also reads. The selected one is
             * `accent-weak`, not a fill — the page's single filled button
             * belongs to the offer.
             */}
            <form action={setCurrencyAction} className="flex items-center gap-3">
              <Meta>Prices in</Meta>
              {/* So switching currency does not silently drop you back to the
                  monthly view you had just switched away from. */}
              <input type="hidden" name="interval" value={yearly ? "year" : "month"} />
              <span className="inline-flex gap-1 rounded-[var(--radius-pill)] bg-surface p-1 shadow-[var(--shadow-raised)]">
                {CURRENCIES.map((option) => (
                  <button
                    key={option}
                    name="currency"
                    value={option}
                    type="submit"
                    aria-current={option === currency}
                    className={cx(
                      "inline-flex min-h-9 items-center rounded-[var(--radius-pill)] px-4",
                      "text-[length:var(--text-label-size)] font-[550]",
                      "transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                      option === currency
                        ? "bg-accent-weak text-accent"
                        : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {option.toUpperCase()}
                  </button>
                ))}
              </span>
            </form>
          </>
        }
      />

      {refusal ? <Status tone="attention">{refusal}</Status> : null}

      {/*
       * Three named rows at `lg`, so the cards can share them.
       *
       * Each card is a `subgrid` spanning all three: header, features, button.
       * That is what puts the rule above the feature list at the same height on
       * every card — the row is as tall as the tallest header, and the others
       * are laid into the same row rather than each starting wherever its own
       * pitch happened to stop wrapping.
       *
       * This replaces reserving a fixed number of lines for the pitch, which
       * was tried twice and is not fixable: how many lines a sentence takes
       * depends on where its words break, not on how many characters it has.
       * Pro's 54-character pitch took four lines at 181px and five at 177px —
       * the 4px the emphasis border costs — so every reserve is one wording
       * away from being wrong again.
       *
       * Below `lg` the cards are one or two per row and each is an ordinary
       * flex column; there is nothing to align against. A browser without
       * `subgrid` drops that one declaration and gets the ragged rule back,
       * which is the same degradation the scroll-driven bands take.
       */}
      <section
        aria-label="Plans"
        className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 lg:grid-rows-[auto_1fr_auto]"
      >
        {CARD_PLAN_IDS.map((planId, i) => {
          const copy = PLAN_COPY[planId];
          const cents = amount(planId);
          /*
           * The year on this card, when the reader asked for one and there is
           * one to show.
           *
           * Free is the only card without a year, because it is the only card
           * without a price. Both subscriptions have an annual row, so this
           * switch no longer changes one card of three and explains itself on
           * the other two — and the amounts, the monthly equivalent and the
           * discount all come out of `prices.ts` rather than being reasoned
           * about here.
           *
           * There is no guard for a paid plan that has no annual row: it is an
           * unreachable branch on this page (`tests/billing/prices.test.ts`
           * asserts both cards can be sold by the year) and `requirePrice`
           * throwing is the right failure anyway. A page that quietly showed a
           * monthly amount on the yearly view would be §6.3 rule 1 broken by a
           * fallback.
           */
          const year =
            yearly && planId !== "free"
              ? {
                  cents: price(planId, "year").amountCents,
                  perMonth: annualPerMonthCents(planId, currency),
                  saving: annualSavingPercent(planId, currency),
                }
              : undefined;
          const annual = year !== undefined;

          /*
           * The €3 belongs to the monthly view, because that is what it buys:
           * `checkoutBody` puts the Pro **monthly** price on the line item and
           * holds it off for four days. Offering a four-day trial of a yearly
           * subscription would be selling a period that does not exist.
           */
          const offered = planId === OFFER_ON && !yearly;

          /*
           * The recommendation is the *plan*, so it survives the switch. Keying
           * the border and the eyebrow off `offered` stripped Pro of both the
           * moment somebody looked at yearly prices, which read as the page
           * withdrawing its recommendation for asking.
           */
          const recommended = planId === OFFER_ON;

          /*
           * What the card leads with, and what it says immediately under it.
           *
           * On the offered plan those are two different prices — €3 to start,
           * €27.99 to stay — and they must arrive together. Everywhere else the
           * headline is the plan's own price and the line under it is the term
           * that matters when you press the button.
           */
          const headline = offered
            ? amount("trial")
            : year
              ? year.cents
              : cents;

          const suffix = offered
            ? "for your first 4 days"
            : year
              ? "a year"
              : planId === "free"
                ? "forever"
                : "a month";

          /*
           * The discount is stated on the card rather than left to the switch
           * above, because the two cards no longer save the same percentage.
           * The switch can only honestly carry the smaller of them, so a reader
           * looking at the better one has to be able to read it here.
           */
          const note = offered
            ? `then ${formatMoney(cents, currency)} a month. Cancel before day 4 and pay nothing more.`
            : year
              ? `That is ${formatMoney(year.perMonth, currency)} a month, paid once a year — ${year.saving}% off.`
              : UNDER_PRICE[planId];

          return (
            <Card
              key={planId}
              style={revealAt(i)}
              /*
               * A border rather than a ring or a lifted shadow. Both of those
               * would be a second `shadow-*` utility fighting `Card`'s own, and
               * two utilities on one property resolve by the order Tailwind
               * emitted them rather than the order they are written — a coin
               * flip dressed as a decision. `Card` sets no border, so this one
               * cannot lose.
               */
              className={cx(
                // The border is on every card, and only its colour changes.
                // Put it on the emphasised one alone and that card's content
                // sits 2px lower than the other three — `border-box` takes the
                // 2px out of the padding — which is exactly the misalignment
                // the reserve above exists to prevent, reintroduced at a
                // smaller size.
                "reveal flex flex-col gap-6 border-2",
                // The card's three blocks laid into the section's three shared
                // rows. `gap-6` carries over as the row gap, so the subgrid
                // keeps the card's own 24px rather than inheriting the
                // section's 20px gutter between cards.
                "lg:row-span-3 lg:grid lg:grid-rows-subgrid",
                recommended ? "border-accent" : "border-transparent",
              )}
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <Title>{copy.name}</Title>
                  {recommended ? (
                    <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
                      Start here
                    </span>
                  ) : null}
                </div>

                {/*
                 * The pitch, promoted out of `Meta`.
                 *
                 * It is the only line on a card written in a voice rather than
                 * in numbers — "See whether this works on you, without paying
                 * to find out" — and it was set at 13px grey, the same as the
                 * feature list, which is how three cards of real writing came
                 * out reading like a specification. It is the second thing you
                 * see now, and the numbers report to it.
                 */}
                <p className="m-0 text-[length:var(--text-body-size)] leading-[var(--text-body-line)] text-ink-muted">
                  {copy.pitch}
                </p>

                {/*
                 * The number is the loudest thing on the card, and on Pro that
                 * number is the €3.
                 *
                 * The trial is not a plan and the billing code has never
                 * treated it as one — `checkoutBody` puts the **Pro** price on
                 * the line item, `trial_period_days` holds the charge off, and
                 * the €3 rides the first invoice as a one-off fee. It is the
                 * price of getting in. On the page it used to be a fourth card
                 * between Free and Learner, which asked a visitor to compare a
                 * four-day offer against three monthly rates.
                 *
                 * So Pro leads with what it costs to say yes today, and what it
                 * costs to stay is the line directly under it — never further
                 * away than that. §13 risk 3 is emphatic that a renewal nobody
                 * expected is a chargeback rather than revenue, and the defence
                 * is not burying the €3: it is keeping the €24.99 in the same
                 * breath.
                 *
                 * `formatMoney` drops a trailing `.00`, so free reads "$0"
                 * rather than "$0.00".
                 */}
                <span className="flex flex-wrap items-baseline gap-x-2 pt-2">
                  <span className="text-[length:var(--text-display-size)] font-[650] leading-[var(--text-display-line)] tracking-[var(--text-display-tracking)] text-ink">
                    {formatMoney(headline, currency)}
                  </span>
                  <Meta>{suffix}</Meta>
                </span>

                <span
                  className={cx(
                    "flex items-center rounded-[var(--radius-control)] px-4 py-2.5",
                    offered || annual ? "bg-accent-weak" : "border border-hairline",
                  )}
                >
                  <Meta tone={offered || annual ? "muted" : "faint"}>{note}</Meta>
                </span>
              </div>

              {/* Tighter than the body rhythm on purpose. Six of these is a
                  list to scan, not prose to read, and at `--text-body-line`
                  they ran together into a paragraph with ticks in it. */}
              <ul className="m-0 flex list-none flex-col gap-2.5 border-t border-hairline p-0 pt-5">
                {copy.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <TickIcon className="mt-px size-4 text-accent" />
                    <span className="text-[length:var(--text-label-size)] leading-[var(--text-lead-line)] text-ink-muted">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto flex flex-col items-start gap-3">
                {/*
                  Free goes to sign-up rather than to Stripe: there is nothing to
                  charge, and sending somebody to a checkout that immediately
                  bounces them back is the sort of dead end §8 screen 6a exists to
                  remove.
                */}
                {planId === "free" ? (
                  <ButtonLink href="/sign-up" variant="text">
                    {copy.cta}
                  </ButtonLink>
                ) : offered ? (
                  <>
                    {/*
                      The trial's own checkout, started from Pro's card. The
                      label is built here rather than taken from
                      `PLAN_COPY.trial.cta`, which is the literal string
                      "Start for €3" — hard-coded euro, so in dollars the
                      button asked for €3 beside a price reading $24.99.
                    */}
                    <form action={startCheckoutAction}>
                      <input type="hidden" name="plan" value="trial" />
                      <input type="hidden" name="interval" value="month" />
                      <Button>
                        Start for {formatMoney(amount("trial"), currency)}
                      </Button>
                    </form>

                    {/*
                      The way past the offer, for the one person who cannot take
                      it: `hasUsedTrial` allows one per account ever, and
                      without this that account's only route to Pro was a button
                      that bounced them back with `?error=trial-used`.
                    */}
                    <form action={startCheckoutAction}>
                      <input type="hidden" name="plan" value={planId} />
                      <input type="hidden" name="interval" value="month" />
                      <Button variant="text">Or go straight to Pro</Button>
                    </form>
                  </>
                ) : (
                  <form action={startCheckoutAction}>
                    <input type="hidden" name="plan" value={planId} />
                    <input
                      type="hidden"
                      name="interval"
                      value={annual ? "year" : "month"}
                    />
                    {/*
                      The filled button follows whichever view the reader is in
                      — the four days on monthly, the year on yearly — and there
                      is still only ever one of them on the page (§8.5.5). Which
                      is why it is `recommended` rather than `annual`: both
                      subscriptions sell a year now, and keying the fill off the
                      view alone put two filled buttons side by side and made
                      the page recommend two things at once.

                      The label stays the plan's own. "Choose annual" was
                      unambiguous while one card could say it; on two it is the
                      same words on both buttons, naming the billing period the
                      switch above already set and not the thing being bought.
                      The year is in the price directly above it.
                    */}
                    <Button variant={annual && recommended ? "primary" : "text"}>
                      {copy.cta}
                    </Button>
                  </form>
                )}
              </div>
            </Card>
          );
        })}
      </section>

      {/*
        The trial band belongs to the view that sells the trial.

        On the yearly view the €3 is not on offer — `checkoutBody` holds off the
        Pro *monthly* price for four days, so there is no four-day version of a
        year — and a band explaining terms nobody can accept from here is noise.
        It also keeps §13 risk 3's disclosure where it does its work: attached to
        the offer, on the screen the offer is made.
      */}
      {yearly ? null : (
      <section className="flex flex-col gap-6">
        {/* The price in the heading is read like every other number on the
            page. It was typed as "€3" and stayed euro while the cards beside it
            switched to dollars — the exact drift this page's whole rule about
            reading numbers exists to prevent. The SEO title above keeps its €3:
            it is one fixed string in a search result, not a claim rendered next
            to a different currency. */}
        <SectionHead
          step={step(1)}
          label="The way into Pro"
          title={`What ${formatMoney(amount("trial"), currency)} buys, exactly`}
          icon={<StepsIcon />}
        />

        {/*
         * Four milestones on a rail, not four cards.
         *
         * These are not four things to compare — they are one thing in
         * sequence, and four raised surfaces of equal weight said the opposite.
         * What a reader needs here is the *order*: money now, four days of
         * everything, a warning, then the renewal. A ruled segment with a
         * marker on it carries that. A card does not, and spends a fill and a
         * shadow saying less.
         *
         * `<ol>`, because the order is the content.
         *
         * The marker is 8px sitting on a 2px rule. `top` on an absolutely
         * positioned child is measured from the *padding* box, which starts
         * below the border — so centring it on the rule is -(2 + 8/2 - 1) =
         * -5px, not the -3px that measuring from the border box would suggest.
         * Measured rather than eyeballed: -3px left the dots 2px low, which
         * reads as a rail the markers are not quite on.
         */}
        <ol className="m-0 grid list-none gap-x-5 gap-y-8 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {trialDays.map((day, i) => (
            <li
              key={day.when}
              style={revealAt(i)}
              className="reveal relative flex flex-col gap-2 border-t-2 border-hairline pt-6"
            >
              <span
                aria-hidden="true"
                className="absolute -top-[5px] left-0 size-2 rounded-full bg-accent"
              />
              <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                {day.when}
              </span>
              <Meta>{day.what}</Meta>
            </li>
          ))}
        </ol>

        {/*
          The terms, in a bordered panel rather than on a raised card.
          Elevation is for things you act on; this is the thing you are entitled
          to read before you do.

          The wording is fixed by the brief and must not be softened or split
          across elements — it is the sentence a chargeback gets argued against.
          The rail above is how it is *read*; this is how it is *stated*.
        */}
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-hairline p-6">
          <p className="m-0 max-w-[var(--measure)] text-[length:var(--text-body-size)] leading-[var(--text-body-line)]">
            {TRIAL_TERMS.replace(
              "{trial}",
              formatMoney(amount("trial"), currency),
            ).replace("{price}", formatMoney(proMonthly.amountCents, currency))}
          </p>
          <Meta>
            {PLANS.trial.entitlements.evaluationsPerMonth} graded projects is
            more than anyone finishes in four days. We would rather you ran out
            of time than out of allowance.
          </Meta>
        </div>
      </section>
      )}

      <section className="flex flex-col gap-6">
        <SectionHead
          step={step(2)}
          label="Whatever you pay"
          title="The parts that are not a plan"
          icon={<TickIcon />}
        />
        {/*
          Three claims, set as type on the page rather than as three more
          surfaces. Nothing here is a thing to choose or an action to take —
          they are the terms that hold whichever card you pressed — so a raised
          card gave them a weight they do not want and a shape that made the
          band read as a fourth set of options.
        */}
        <div className="grid gap-x-10 gap-y-8 md:grid-cols-3">
          {ALWAYS.map((item, i) => (
            <div
              key={item.title}
              style={revealAt(i)}
              className="reveal flex flex-col gap-2"
            >
              <span className="flex items-center gap-2.5">
                <TickIcon className="size-4 text-accent" />
                <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                  {item.title}
                </span>
              </span>
              <Meta>{item.body}</Meta>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHead
          step={step(3)}
          label="Questions"
          title="The things people ask"
          icon={<QuestionIcon />}
        />
        {/*
          The shared disclosure list, not a copy of one.

          `/` grew the same band minutes after this page did, and two copies of
          a `<details>` list is precisely how the eight hand-rolled card
          variants `LinkCard` was extracted to end happened. The reasoning for
          the register, the chevron's quarter turn and the first-open rule all
          live in one docblock now, on the component.

          The support line stays out here: the answers feed the `faqPage`
          markup as plain strings, so anything a reader can click has to go
          under the list rather than inside an answer.
        */}
        <FaqList faqs={questions} />

        {/*
          The page used to stop dead on its last answer. This is the one thing
          an FAQ owes a reader whose question was not on it, and the address is
          read from `site.ts` rather than typed, like every other fact here.
        */}
        <p className="m-0 text-[length:var(--text-label-size)] text-ink-muted">
          Not answered here?{" "}
          <a
            href={`mailto:${supportAddress()}`}
            className="font-[550] text-accent underline-offset-4 hover:underline"
          >
            {supportAddress()}
          </a>
        </p>
      </section>
    </PageFrame>
  );
}
