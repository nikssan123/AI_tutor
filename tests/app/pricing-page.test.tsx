// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PLANS } from "@/lib/billing/catalog";
import {
  annualSavingPercent,
  formatMoney,
  requirePrice,
} from "@/lib/billing/prices";

/**
 * `/pricing`.
 *
 * The assertions worth having are the ones that catch a lie rather than a
 * layout change: that the quota on the card is the quota the meter enforces,
 * that the price rendered is the price in the table, and that nothing claims a
 * capability the engine does not have.
 */

let cookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "mk_currency" && cookieValue
        ? { name, value: cookieValue }
        : undefined,
    set: () => undefined,
  }),
}));
vi.mock("@/app/(marketing)/pricing/actions", () => ({
  setCurrencyAction: async () => undefined,
  startCheckoutAction: async () => undefined,
}));

const { default: PricingPage, generateMetadata } = await import(
  "@/app/(marketing)/pricing/page"
);

beforeEach(() => {
  cookieValue = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage(search: Record<string, string> = {}) {
  render(await PricingPage({ searchParams: Promise.resolve(search) }));
}

describe("the price list", () => {
  it("draws a card for every plan somebody can be on", async () => {
    await renderPage();

    for (const name of ["Free", "Learner", "Pro"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
  });

  it("does not draw the trial as a plan of its own", async () => {
    // `checkoutBody` puts the **Pro** price on the line item and rides the €3
    // in on the first invoice: the trial is Pro at a discount, not a fourth
    // thing to choose between. A column of its own asked a visitor to compare
    // four days against a monthly rate.
    await renderPage();

    expect(screen.queryByRole("heading", { name: "Try Pro" })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
  });

  it("sells the trial from the card it actually buys", async () => {
    await renderPage();

    const start = screen.getByRole("button", { name: /^Start for/ });
    // The offer's form buys `trial`; the card it sits on is Pro's.
    const form = start.closest("form")!;
    expect(form.querySelector('input[name="plan"]')!.getAttribute("value")).toBe(
      "trial",
    );

    const card = form.closest("div[class*=rounded]")!;
    expect(card.querySelector("h2")!.textContent).toBe("Pro");
  });

  it("leaves a way to Pro for somebody who has used their four days", async () => {
    // `hasUsedTrial` allows one per account ever. Without this the only route
    // to Pro was a button that bounced them back with `?error=trial-used`.
    await renderPage();

    const straight = screen.getByRole("button", { name: "Or go straight to Pro" });
    expect(
      straight.closest("form")!.querySelector('input[name="plan"]')!.getAttribute("value"),
    ).toBe("pro");
  });

  it("says why a checkout bounced instead of redrawing the same page", async () => {
    await renderPage({ error: "trial-used" });
    expect(screen.getByText(/already had your four days/)).toBeTruthy();
  });

  it("says nothing was charged when the checkout could not open", async () => {
    await renderPage({ error: "checkout" });
    expect(screen.getByText(/Nothing has been charged/)).toBeTruthy();
  });

  it("ignores an error code it does not recognise", async () => {
    await renderPage({ error: "not-a-real-code" });
    expect(document.body.textContent).not.toMatch(/could not open the checkout/);
  });

  it("prints the price that is in the table, not one typed into the page", async () => {
    await renderPage();

    // Read, not typed — including here. This test used to assert the literal
    // "$12.99" and "$3", which held only while the two currency columns
    // happened to carry the same digits, and quietly asserted the wrong thing
    // the moment the US column moved above the EU one.
    //
    // USD by default: no locale routing exists yet, so `en` implies USD. The
    // headline numbers, each the loudest thing on its own card. Pro's is the
    // trial fee, because that is what it costs to start.
    for (const [plan, interval] of [
      ["learner", "month"],
      ["trial", "month"],
    ] as const) {
      const price = requirePrice(plan, interval, "usd");
      expect(screen.getByText(formatMoney(price.amountCents, "usd"))).toBeTruthy();
    }
  });

  it("says what it costs to stay in the same breath as what it costs to start", async () => {
    // §13 risk 3 — the danger of leading with €3 is a renewal nobody expected,
    // and the defence is that the monthly price is the line directly under it,
    // not a paragraph further down.
    await renderPage();
    const pro = formatMoney(requirePrice("pro", "month", "usd").amountCents, "usd");
    expect(screen.getByText(`then ${pro} a month`, { exact: false })).toBeTruthy();
  });

  it("follows the currency cookie", async () => {
    cookieValue = "eur";
    await renderPage();

    expect(screen.getByText(/then €24\.99 a month/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\$24\.99/);
  });

  it("ignores a cookie holding a currency we do not sell in", async () => {
    cookieValue = "gbp";
    await renderPage();
    const pro = formatMoney(requirePrice("pro", "month", "usd").amountCents, "usd");
    expect(screen.getByText(`then ${pro} a month`, { exact: false })).toBeTruthy();
  });

  it("quotes the quota the meter actually enforces", async () => {
    // The one that stops the page becoming a refund: "10 graded projects" on a
    // plan the meter caps at 5 is not a copy bug.
    await renderPage();

    expect(
      screen.getByText(
        new RegExp(`${PLANS.pro.entitlements.evaluationsPerMonth} graded projects a month`),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        new RegExp(`${PLANS.learner.entitlements.evaluationsPerMonth} graded projects a month`),
      ),
    ).toBeTruthy();
    // Free's single evaluation is singular, not "1 graded projects".
    expect(screen.getByText(/1 graded project a month/)).toBeTruthy();
  });

  it("states the annual saving it can actually prove, on the switch", async () => {
    await renderPage();
    const saving = annualSavingPercent("usd");

    // 34 in dollars, 33 in euros — the two columns no longer round to the same
    // discount, which is why the page reads it per currency instead of
    // printing a constant.
    expect(saving).toBe(34);
    expect(annualSavingPercent("eur")).toBe(33);
    expect(
      screen.getByRole("link", { name: `Yearly · save ${saving}%` }),
    ).toBeTruthy();
  });

  it("switches the prices rather than describing the switch", async () => {
    const annual = requirePrice("pro", "year", "usd");
    await renderPage({ interval: "year" });

    // Pro now leads with the year, and says what that works out to a month —
    // the number the reader was just comparing on the monthly view.
    expect(screen.getByText(formatMoney(annual.amountCents, "usd"))).toBeTruthy();
    expect(screen.getByText(/a month, paid once a year/)).toBeTruthy();

    const choose = screen.getByRole("button", { name: "Choose annual" });
    const form = choose.closest("form")!;
    expect(form.querySelector('input[name="plan"]')!.getAttribute("value")).toBe("pro");
    expect(form.querySelector('input[name="interval"]')!.getAttribute("value")).toBe(
      "year",
    );
  });

  it("does not offer four days of a yearly subscription", async () => {
    // `checkoutBody` holds off the Pro *monthly* price for four days. A trial
    // of a year is a period that does not exist, so the offer belongs to the
    // monthly view and the yearly view sells the year directly.
    await renderPage({ interval: "year" });

    expect(screen.queryByRole("button", { name: /^Start for/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/for your first 4 days/);
  });

  it("keeps the trial's terms on the view that sells the trial", async () => {
    // §13 risk 3's disclosure does its work attached to the offer. On the
    // yearly view there is no offer to disclose, and a band of terms nobody
    // can accept from there is noise.
    await renderPage({ interval: "year" });
    expect(document.body.textContent).not.toMatch(/renews automatically at/);
    expect(screen.queryByRole("heading", { name: /buys, exactly/ })).toBeNull();

    cleanup();
    await renderPage();
    expect(screen.getByText(/renews automatically at/)).toBeTruthy();
  });

  it("does not quote Learner a billing period it cannot be sold on", async () => {
    // Only Pro has an annual row in `prices.ts`. Redrawing all three as
    // "yearly" would price Learner on a period that does not exist.
    const monthly = requirePrice("learner", "month", "usd");
    await renderPage({ interval: "year" });

    expect(screen.getByText(formatMoney(monthly.amountCents, "usd"))).toBeTruthy();
    expect(screen.getByText("Billed monthly. Cancel any time.")).toBeTruthy();
  });

  it("keeps recommending the same plan in both views", async () => {
    // The recommendation is the plan, not the offer. Losing it on the yearly
    // view read as the page withdrawing its advice for being asked a question.
    await renderPage();
    expect(screen.getByText("Start here")).toBeTruthy();

    cleanup();
    await renderPage({ interval: "year" });
    expect(screen.getByText("Start here")).toBeTruthy();
  });

  it("still offers exactly one filled button on the yearly view", async () => {
    await renderPage({ interval: "year" });

    const primary = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("text-on-accent"));
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe("Choose annual");
  });

  it("offers both views as links, so the choice can be sent to somebody", async () => {
    await renderPage();

    expect(
      screen.getByRole("link", { name: "Monthly" }).getAttribute("href"),
    ).toBe("/pricing");
    expect(
      screen
        .getByRole("link", { name: /^Yearly/ })
        .getAttribute("href"),
    ).toBe("/pricing?interval=year");
  });

  it("marks the view you are in", async () => {
    await renderPage({ interval: "year" });
    expect(
      screen.getByRole("link", { name: /^Yearly/ }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Monthly" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("carries the view through a currency change", async () => {
    // Currency is a cookie and the interval is in the URL, so without this the
    // POST answered "I want euros" by also undoing "I want to see the year".
    await renderPage({ interval: "year" });

    // Scoped to the currency form itself rather than the first match in the
    // document — the plan cards carry an `interval` field too.
    const currencyForm = screen
      .getByRole("button", { name: "USD" })
      .closest("form")!;
    expect(
      currencyForm.querySelector('input[name="interval"]')!.getAttribute("value"),
    ).toBe("year");
  });

  it("states the renewal terms in full", async () => {
    // §13 risk 3 — a trial that renews on somebody who did not expect it is a
    // chargeback, not revenue. The wording the brief fixes has to survive a
    // redesign, and has to stay in one element so it cannot be read in halves.
    await renderPage();

    const pro = formatMoney(requirePrice("pro", "month", "usd").amountCents, "usd");
    const fee = formatMoney(requirePrice("trial", "month", "usd").amountCents, "usd");

    // Both amounts, in one element, in one currency. The opening figure used to
    // be typed into `TRIAL_TERMS` as "€3 today" while the renewal was
    // interpolated, so this paragraph told a dollar reader a euro sum and a
    // dollar sum in the same breath.
    const terms = screen.getByText(/Cancel anytime from your account/);
    expect(terms.textContent).toBe(
      `${fee} today. Full Pro access for 4 days. After 4 days your subscription ` +
        `renews automatically at ${pro}/month until cancelled. Cancel anytime ` +
        `from your account.`,
    );
  });

  it("draws the four days, renewal included", async () => {
    // The defence against a surprise renewal is not a longer disclaimer — it is
    // a reader who can see the day we email them and the day it renews.
    await renderPage();

    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("For four days")).toBeTruthy();
    expect(screen.getByText("The day before it renews")).toBeTruthy();
    expect(screen.getByText("After that")).toBeTruthy();
    const pro = formatMoney(requirePrice("pro", "month", "usd").amountCents, "usd");
    expect(
      screen.getByText(`becomes Pro at ${pro} a month, until you stop it`, {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it("marks the plan the page is recommending", async () => {
    // §8.5.5's one filled button decides which plan is primary; the card has to
    // say the same thing, or the page recommends two different things at once.
    await renderPage();

    expect(screen.getByText("Start here")).toBeTruthy();
  });

  it("names what holds whatever you pay", async () => {
    // Claims, not sections — they are set as type rather than as headings,
    // because nothing in this band is a thing to choose or an action to take.
    await renderPage();

    for (const claim of [
      "The checklist comes first",
      "Evidence, not vibes",
      "Leave whenever",
    ]) {
      expect(screen.getByText(claim)).toBeTruthy();
    }
  });

  it("does not promise unmetered sessions on a band that covers every plan", async () => {
    // This band said "lessons, practice and the tutor are not counted" — the
    // same sentence corrected on the billing screen and in the FAQ, and the
    // last place it could stand, since a band headed "whatever you pay" is the
    // one part of the page claiming to be true of Free as well.
    await renderPage();

    expect(document.body.textContent).not.toMatch(/the tutor are not counted/);
    expect(document.body.textContent).not.toMatch(/Only marking is metered/);
  });

  it("claims nothing about multiple goals", async () => {
    // The engine is single-goal by construction (`pauseOthers`), so no plan may
    // sell "3 goals" or "unlimited goals". §4.2 law 3, applied to the price list.
    await renderPage();

    expect(document.body.textContent).not.toMatch(/active goals?/i);
    expect(document.body.textContent).not.toMatch(/unlimited goals/i);
  });

  it("offers exactly one filled button, and it is the offer", async () => {
    // §8.5.5 — one filled button per screen, and the design system rather than a
    // guess decides which CTA is primary.
    await renderPage();

    // `text-on-accent` is unique to the filled variant; matching on
    // "bg-accent" would also catch the text variant's `hover:bg-accent-weak`.
    const primary = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("text-on-accent"));
    expect(primary).toHaveLength(1);
    // In the page's own currency, not the one somebody typed into the label.
    // `PLAN_COPY.trial.cta` used to be the literal "Start for €3", which asked
    // a dollar visitor for euros beside a card priced in dollars; it is now
    // currency-neutral and the amount is built here.
    const fee = formatMoney(requirePrice("trial", "month", "usd").amountCents, "usd");
    expect(primary[0]!.textContent).toContain(`Start for ${fee}`);
  });

  it("asks for the trial fee in the currency the page is showing", async () => {
    cookieValue = "eur";
    await renderPage();

    const primary = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("text-on-accent"));
    expect(primary[0]!.textContent).toContain("Start for €3");
  });

  it("sends the free plan to sign-up rather than to a checkout", async () => {
    await renderPage();
    const link = screen.getByRole("link", { name: "Start learning" });
    expect(link.getAttribute("href")).toBe("/sign-up");
  });

  it("lets a visitor switch currency without JavaScript", async () => {
    await renderPage();

    for (const code of ["USD", "EUR"]) {
      const button = screen.getByRole("button", { name: code });
      expect(button.getAttribute("type")).toBe("submit");
      expect(button.getAttribute("name")).toBe("currency");
    }
  });
});

describe("the questions", () => {
  it("keeps every answer in the page, folded or not", async () => {
    // The `FAQPage` markup promises Google the answers are on the page. A
    // disclosure widget keeps them in the DOM; a scripted accordion that
    // mounted them on click would make that claim false.
    await renderPage();

    for (const faq of [
      "renews as Pro at the monthly price shown above",
      "marked against a public rubric",
      "keeps everything running until the end of the period",
      "the currency is fixed for that subscription",
    ]) {
      expect(screen.getByText(new RegExp(faq))).toBeTruthy();
    }
  });

  it("opens the first one, so the pattern needs no click to read", async () => {
    await renderPage();

    const items = [...document.querySelectorAll("details")];
    expect(items).toHaveLength(4);
    expect(items[0]!.hasAttribute("open")).toBe(true);
    expect(items.slice(1).every((d) => !d.hasAttribute("open"))).toBe(true);
  });

  it("asks about the fee in the currency the page is showing", async () => {
    // The question named "€3" while the card beside it offered $3. Same drift
    // the section heading had, same rule: the number is read, never typed.
    await renderPage();
    const fee = formatMoney(requirePrice("trial", "month", "usd").amountCents, "usd");
    expect(
      screen.getByRole("heading", {
        name: `What happens when the ${fee} trial ends?`,
      }),
    ).toBeTruthy();

    cleanup();
    cookieValue = "eur";
    await renderPage();
    expect(
      screen.getByRole("heading", { name: "What happens when the €3 trial ends?" }),
    ).toBeTruthy();
  });

  it("keeps each question a heading, inside the summary", async () => {
    // The outline has to survive the change of register: a question is still a
    // section of this page, and the markup above addresses it as one.
    await renderPage();

    const heading = screen.getByRole("heading", {
      name: "Can I change plan or cancel?",
    });
    expect(heading.closest("summary")).toBeTruthy();
  });

  it("gives a reader whose question is not here somewhere to go", async () => {
    await renderPage();

    const mail = document.querySelector('a[href^="mailto:"]')!;
    expect(mail).toBeTruthy();
    expect(mail.getAttribute("href")).toContain("@");
  });
});

describe("metadata", () => {
  it("is indexable, canonical and says the price in the title", async () => {
    // §13.3 — what a thing costs is a query people type, and the SERP snippet
    // is where the answer has to appear.
    const meta = await generateMetadata();

    expect(meta.title).toContain("€3");
    expect(meta.alternates?.canonical).toContain("/pricing");
    expect(meta.robots).toBeUndefined();
  });
});

describe("the markup", () => {
  it("marks up the prices it shows, and the questions it answers", async () => {
    await renderPage();

    // `serialise` puts every block in one script, as an array when there is
    // more than one.
    const parsed = [
      ...document.querySelectorAll('script[type="application/ld+json"]'),
    ].flatMap((el) => {
      const value = JSON.parse(el.textContent!);
      return Array.isArray(value) ? value : [value];
    });
    const blocks = parsed;

    const offer = blocks.find((b) => b.offers)!;
    expect(offer.offers["@type"]).toBe("AggregateOffer");
    expect(offer.offers.priceCurrency).toBe("USD");
    // The dearest thing on the page is the annual plan.
    expect(offer.offers.highPrice).toBe(
      (requirePrice("pro", "year", "usd").amountCents / 100).toFixed(2),
    );
    expect(offer.offers.lowPrice).toBe("0.00");

    const faq = blocks.find((b) => b["@type"] === "FAQPage")!;
    // Every marked-up question is visible on the page (§13.3's rule).
    for (const entry of faq.mainEntity) {
      expect(screen.getByRole("heading", { name: entry.name })).toBeTruthy();
    }
  });
});
