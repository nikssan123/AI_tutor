import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import type { Interval, PlanId } from "./catalog";

/**
 * Prices — PLAN-MONETIZATION §3.
 *
 * Two currencies, no third, no runtime FX conversion. PLAN-LOCALIZATION §6.1
 * set the shape of this table and §1 decision 5 changed the numbers from round
 * ($25/$190) to charm ($24.99/$199) on 2026-08-15.
 *
 * **EUR amounts are VAT-inclusive**, as EU consumer law requires (§6.2). USD
 * amounts are net; Stripe Tax adds US sales tax on top where nexus exists. That
 * asymmetry is not a bug — it is what each market's law requires a consumer to
 * be shown.
 *
 * **The two columns are no longer the same number.** They were, and that was
 * never a price — it was a coincidence of typography. A euro buys more than a
 * dollar, so €24.99 and $24.99 are two different amounts of money wearing the
 * same digits, and the US column is now set roughly 12% above the EU one, charm-
 * rounded to a step somebody would recognise rather than to whatever an exchange
 * rate produced that morning.
 *
 * The rate is an *assumption*, deliberately: ~1.10 USD to the euro, applied once,
 * by hand, on 2026-08-15. Nothing here converts at runtime and nothing should.
 * A price that moves with the market is a price nobody can quote, a renewal
 * amount that drifts under a live subscription, and §6.3 rule 1 — the displayed
 * price must equal the charged price — turned into a race against the FX feed.
 * When the rate moves far enough to matter, somebody edits this table.
 *
 * **Read the two columns net before concluding the US pays more.** EU gross is
 * VAT-inclusive, so €24.99 at a 21% rate is €20.65 to us, while $27.99 is $27.99
 * to us with sales tax added on top. Net of tax and at 1.10, the US subscriber
 * is worth about 23% more than the EU one — and was already worth about 10% more
 * back when both columns read 24.99. The gap is a willingness-to-pay decision,
 * which is a fine thing to make; it is just not the FX correction it looks like.
 *
 * **Both subscriptions are sold by the year** since 2026-08-17. Learner was
 * monthly-only, which made the yearly view of `/pricing` a switch that changed
 * one card of three and had to explain itself on the other two. §20.1's "annual
 * is pushed hard: it fixes the AI-app churn problem by construction" is an
 * argument about *subscribers*, not about the expensive tier — the plan chosen
 * by somebody who describes their own pace as steady rather than intense is if
 * anything the one where a year up front is the easier yes.
 *
 * €109 and $119 are charm steps at the same ~1.10 the monthly columns were set
 * at, and they are **not** the same discount as Pro's: 30% and 33% against
 * Pro's 33% and 34%. Nothing here forces the four to agree, and contorting a
 * price so that one label can quote a single figure would be §6.1's "round
 * local numbers beat FX-derived ones" abandoned to make a pill shorter.
 * `annualSavingPercent` takes a plan for exactly that reason.
 */

export const CURRENCIES = ["usd", "eur"] as const;

export type Currency = (typeof CURRENCIES)[number];

/** A plan you can actually buy. `free` has no price and no Stripe product. */
export type PaidPlanId = Exclude<PlanId, "free">;

export interface Price {
  readonly planId: PaidPlanId;
  readonly interval: Interval;
  readonly currency: Currency;
  /** Minor units — cents for both currencies. */
  readonly amountCents: number;
}

/**
 * Whether the amount above already contains the tax, in Stripe's vocabulary.
 *
 * The currency decides it because the law does: EUR is `inclusive` (§6.2 — EU
 * consumer law requires the displayed price to be the paid price), USD is
 * `exclusive` (net, with sales tax added at checkout where nexus exists).
 *
 * It is a function of the row rather than a column on it so that adding a
 * currency forces the question to be answered here, in the one place that
 * explains why, instead of being copied from the row above.
 */
export function taxBehavior(currency: Currency): "inclusive" | "exclusive" {
  return currency === "eur" ? "inclusive" : "exclusive";
}

/**
 * The trial is billed as a one-off fee on the first invoice of a Pro
 * subscription (§7), so it is a `month` row that nothing renews — the renewal
 * belongs to the Pro price sitting behind it.
 */
export const PRICES: readonly Price[] = [
  {
    planId: "trial",
    interval: "month",
    currency: "usd",
    amountCents: 349,
  },
  {
    planId: "trial",
    interval: "month",
    currency: "eur",
    amountCents: 300,
  },
  {
    planId: "learner",
    interval: "month",
    currency: "usd",
    amountCents: 1_499,
  },
  {
    planId: "learner",
    interval: "month",
    currency: "eur",
    amountCents: 1_299,
  },
  {
    planId: "learner",
    interval: "year",
    currency: "usd",
    amountCents: 11_900,
  },
  {
    planId: "learner",
    interval: "year",
    currency: "eur",
    amountCents: 10_900,
  },
  {
    planId: "pro",
    interval: "month",
    currency: "usd",
    amountCents: 2_799,
  },
  {
    planId: "pro",
    interval: "month",
    currency: "eur",
    amountCents: 2_499,
  },
  {
    planId: "pro",
    interval: "year",
    currency: "usd",
    amountCents: 21_900,
  },
  {
    planId: "pro",
    interval: "year",
    currency: "eur",
    amountCents: 19_900,
  },
];

export function findPrice(
  planId: PaidPlanId,
  interval: Interval,
  currency: Currency,
): Price | undefined {
  return PRICES.find(
    (p) =>
      p.planId === planId && p.interval === interval && p.currency === currency,
  );
}

/**
 * The same lookup, for the call sites that have already established the row
 * exists — a checkout for a plan the pricing page just rendered.
 *
 * Throws rather than returning a fallback price. There is no safe amount to
 * charge someone when the table does not know what they are buying, and §6.3
 * rule 1 makes a wrong amount a P0 rather than a degraded experience.
 */
export function requirePrice(
  planId: PaidPlanId,
  interval: Interval,
  currency: Currency,
): Price {
  const price = findPrice(planId, interval, currency);
  if (!price) {
    throw new Error(
      `No price for ${planId}/${interval}/${currency}. The catalog and the price table disagree.`,
    );
  }
  return price;
}

/**
 * Locale → the currency its static HTML carries (§6.5).
 *
 * English is the American price because `en` is the root locale and the US is
 * the larger English-speaking market for this product; the other three locales
 * are euro-area or euro-adjacent. A reader in the wrong place is corrected by
 * the client island, not by this function — which has no request context and
 * must return the same answer at build time as it does at render time, or the
 * marketing routes stop being static.
 */
export const LOCALE_CURRENCY: Record<Locale, Currency> = {
  en: "usd",
  de: "eur",
  bg: "eur",
  es: "eur",
};

export function isCurrency(value: unknown): value is Currency {
  return (
    typeof value === "string" &&
    (CURRENCIES as readonly string[]).includes(value)
  );
}

/**
 * What currency to show, given the page's locale and whatever the visitor's
 * cookie says.
 *
 * Precedence is cookie → locale → USD, and the cookie wins because it is the
 * only one of the three that the visitor set deliberately. §6.5's island writes
 * it; checkout reads the same value, so the price shown and the price charged
 * come from one source.
 *
 * A subscription's own currency is **not** consulted here: it is immutable once
 * set (§6.3 rule 2) and belongs to the subscription row, not to a page.
 */
export function resolveCurrency(
  locale: Locale = DEFAULT_LOCALE,
  cookie?: unknown,
): Currency {
  if (isCurrency(cookie)) return cookie;
  return LOCALE_CURRENCY[locale];
}

/** The cookie §6.5's island writes and checkout reads. */
export const CURRENCY_COOKIE = "mk_currency";

/**
 * The plans sold by the year, read off the table rather than listed again.
 *
 * Derived so that a `year` row is the *only* edit a new annual plan needs. A
 * second, hand-kept list is how a page ends up offering a billing period
 * checkout cannot charge, or — the direction that actually happened — how a row
 * added to the table goes unsold because nobody remembered the list.
 */
export const ANNUAL_PLAN_IDS: readonly PaidPlanId[] = [
  ...new Set(PRICES.filter((p) => p.interval === "year").map((p) => p.planId)),
];

/**
 * How much cheaper a year is than twelve months, as a whole percent.
 *
 * Computed rather than written down, and computed **per plan and per currency**,
 * which is the whole reason it takes both. §20.1 claimed 37% for $190 against
 * $25/mo; there are now four true answers — Pro is 33% in euros and 34% in
 * dollars, Learner 30% and 33% — and any hard-coded figure would be wrong
 * somewhere. A pricing page that overstates its own discount is the kind of
 * error that gets quoted back at you. Rounding is *down* so the number on the
 * page is never larger than the saving.
 */
export function annualSavingPercent(
  planId: PaidPlanId,
  currency: Currency,
): number {
  const monthly = requirePrice(planId, "month", currency).amountCents * 12;
  const yearly = requirePrice(planId, "year", currency).amountCents;
  return Math.floor(((monthly - yearly) / monthly) * 100);
}

/**
 * The smallest annual saving on offer, which is the only figure a control
 * sitting above *every* card may claim.
 *
 * The switch on `/pricing` quoted Pro's saving while Pro was the only plan sold
 * by the year. With two, "save 33%" over a column that saves 30% is the same
 * overstatement `annualSavingPercent`'s rounding exists to prevent, one level
 * up — so the switch quotes the floor and each card proves its own number.
 */
export function smallestAnnualSavingPercent(currency: Currency): number {
  return Math.min(
    ...ANNUAL_PLAN_IDS.map((id) => annualSavingPercent(id, currency)),
  );
}

/**
 * What a year works out to a month — the number a reader is actually comparing,
 * because it is the one they just read on the monthly view.
 *
 * Rounded **up**, for the same reason `annualSavingPercent` rounds down: the
 * safe direction is the one that never advertises a better deal than the one on
 * offer. €199/12 is €16.583…, so €16.59 × 12 comes to €199.08 — a whisker more
 * than the year costs, where €16.58 would have quoted a year at €198.96 and
 * undercut our own price.
 */
export function annualPerMonthCents(
  planId: PaidPlanId,
  currency: Currency,
): number {
  return Math.ceil(requirePrice(planId, "year", currency).amountCents / 12);
}

/**
 * A price as a person reads it.
 *
 * `Intl` rather than a hand-rolled symbol, because the symbol's *position* is
 * locale-dependent — "$24.99" leads in English and "24,99 €" trails in German —
 * and getting that wrong is one of the small things §9.3 says is always got
 * wrong. Trailing `.00` is dropped so an annual price reads "€199" rather than
 * "€199.00", but a charm price keeps its cents.
 */
export function formatMoney(
  amountCents: number,
  currency: Currency,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const whole = amountCents % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amountCents / 100);
}
