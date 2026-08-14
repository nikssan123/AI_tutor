import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import type { ThemeChoice } from "@/lib/theme-script";
import { copyFor } from "./copy";
import { fill, renderMessage, type EmailMessage } from "./render";
import { canonical } from "@/lib/site";

/**
 * The six emails money sends — PLAN-MONETIZATION §10.
 *
 * Pure functions of their inputs, exactly like `templates.ts`: no transport, no
 * environment, no database. What makes these different from the auth four is
 * that **ignoring one of them can cost the reader money**, so every message
 * states the amount, the date and the way out, and none of them buries the
 * renewal in a footer.
 *
 * Dates are formatted here rather than passed in pre-formatted, so a German
 * reader gets a German date from the same call site that gives an English
 * reader an English one.
 */

export type { EmailMessage } from "./render";

/** Where each message sends the reader. One button, one obvious next step. */
const PATHS = {
  trialStarted: "/today",
  trialEnding: "/account/billing",
  trialConverted: "/today",
  paymentFailed: "/account/billing",
  cancelled: "/account/billing",
  referralRewarded: "/today",
} as const;

/**
 * The tag `Intl` is actually asked for, per locale.
 *
 * `en` alone resolves to `en-US`, which puts the month first — "August 20".
 * Everywhere else in this product English is British: `marketingMetadata`
 * emits `en_GB`, and `/account/billing` formats the same dates with `en-GB`.
 * A renewal notice and the screen it links to must not disagree about how a
 * date is written, so the mapping is explicit rather than left to a default.
 */
const DATE_TAGS: Record<Locale, string> = {
  en: "en-GB",
  de: "de",
  bg: "bg",
  es: "es",
};

/**
 * "20 August" in English, "20. August" in German, "20 август" in Bulgarian.
 *
 * No year: every date these emails mention is days away, and a year makes a
 * sentence about tomorrow read like a contract.
 */
export function billingDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(DATE_TAGS[locale], {
    day: "numeric",
    month: "long",
  }).format(date);
}

interface BillingInput {
  to: string;
  locale?: Locale;
  theme?: ThemeChoice;
}

type BillingKey = keyof typeof PATHS;

/**
 * The shared frame. Every one of these is heading + paragraphs + one button,
 * so the difference between them is entirely which copy and which values —
 * which is the point of a catalog rather than six near-identical functions.
 */
function billingMessage(
  key: BillingKey,
  input: BillingInput,
  values: Record<string, string>,
): EmailMessage {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const copy = copyFor(locale).billing[key];
  const all = { brand: copyFor(locale).brand, ...values };

  return renderMessage({
    to: input.to,
    theme: input.theme,
    locale,
    subject: fill(copy.subject, all),
    content: {
      heading: fill(copy.heading, all),
      body: copy.body.map((line) => fill(line, all)),
      action: { label: fill(copy.action, all), url: canonical(PATHS[key]) },
      footer: fill(copy.footer, all),
    },
  });
}

export function trialStartedMessage(
  input: BillingInput & {
    /** Already formatted for the reader's currency by the caller. */
    price: string;
    trialPrice: string;
    evaluations: number;
    renewsOn: Date;
  },
): EmailMessage {
  const locale = input.locale ?? DEFAULT_LOCALE;
  return billingMessage("trialStarted", input, {
    price: input.price,
    trialPrice: input.trialPrice,
    evaluations: String(input.evaluations),
    renewsOn: billingDate(input.renewsOn, locale),
  });
}

/**
 * Day 3 of the trial, and the most important message in this file.
 *
 * §13 risk 3: a trial that renews on somebody who did not expect it is a
 * chargeback and a refund, not revenue — and a chargeback costs the fee plus a
 * fixed penalty on top of the money returned. This email exists to make the
 * renewal impossible to be surprised by, which is why it leads with the price.
 */
export function trialEndingMessage(
  input: BillingInput & { price: string; renewsOn: Date },
): EmailMessage {
  const locale = input.locale ?? DEFAULT_LOCALE;
  return billingMessage("trialEnding", input, {
    price: input.price,
    renewsOn: billingDate(input.renewsOn, locale),
  });
}

export function trialConvertedMessage(
  input: BillingInput & {
    price: string;
    evaluations: number;
    renewsOn: Date;
  },
): EmailMessage {
  const locale = input.locale ?? DEFAULT_LOCALE;
  return billingMessage("trialConverted", input, {
    price: input.price,
    evaluations: String(input.evaluations),
    renewsOn: billingDate(input.renewsOn, locale),
  });
}

export function paymentFailedMessage(input: BillingInput): EmailMessage {
  return billingMessage("paymentFailed", input, {});
}

export function cancelledMessage(
  input: BillingInput & { endsOn: Date },
): EmailMessage {
  const locale = input.locale ?? DEFAULT_LOCALE;
  return billingMessage("cancelled", input, {
    endsOn: billingDate(input.endsOn, locale),
  });
}

export function referralRewardedMessage(
  input: BillingInput & { friend: string; days: number; endsOn: Date },
): EmailMessage {
  const locale = input.locale ?? DEFAULT_LOCALE;
  return billingMessage("referralRewarded", input, {
    friend: input.friend,
    days: String(input.days),
    endsOn: billingDate(input.endsOn, locale),
  });
}
