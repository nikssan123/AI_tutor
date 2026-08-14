// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LISTED_PLAN_IDS, PLANS } from "@/lib/billing/catalog";
import { annualSavingPercent, requirePrice } from "@/lib/billing/prices";

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

async function renderPage() {
  render(await PricingPage());
}

describe("the price list", () => {
  it("shows every listed plan", async () => {
    await renderPage();

    const names = { free: "Free", trial: "Try Pro", learner: "Learner", pro: "Pro" };
    for (const id of LISTED_PLAN_IDS) {
      expect(screen.getByRole("heading", { name: names[id] })).toBeTruthy();
    }
  });

  it("prints the price that is in the table, not one typed into the page", async () => {
    await renderPage();

    // USD by default: no locale routing exists yet, so `en` implies USD.
    expect(screen.getByText("$24.99")).toBeTruthy();
    expect(screen.getByText("$12.99")).toBeTruthy();
    expect(screen.getByText("$3")).toBeTruthy();
    expect(
      screen.getByText(`$${requirePrice("pro", "year", "usd").amountCents / 100}`),
    ).toBeTruthy();
  });

  it("follows the currency cookie", async () => {
    cookieValue = "eur";
    await renderPage();

    expect(screen.getByText("€24.99")).toBeTruthy();
    expect(screen.queryByText("$24.99")).toBeNull();
  });

  it("ignores a cookie holding a currency we do not sell in", async () => {
    cookieValue = "gbp";
    await renderPage();
    expect(screen.getByText("$24.99")).toBeTruthy();
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

  it("states the annual saving it can actually prove", async () => {
    await renderPage();
    const saving = annualSavingPercent("usd");

    expect(saving).toBe(33);
    expect(
      screen.getByRole("heading", { name: `Pay for a year, save ${saving}%` }),
    ).toBeTruthy();
  });

  it("states the renewal terms in full", async () => {
    // §13 risk 3 — a trial that renews on somebody who did not expect it is a
    // chargeback, not revenue.
    await renderPage();

    expect(screen.getByText(/renews automatically at \$24\.99\/month/)).toBeTruthy();
    expect(screen.getByText(/Cancel anytime from your account/)).toBeTruthy();
  });

  it("claims nothing about multiple goals", async () => {
    // The engine is single-goal by construction (`pauseOthers`), so no plan may
    // sell "3 goals" or "unlimited goals". §4.2 law 3, applied to the price list.
    await renderPage();

    expect(document.body.textContent).not.toMatch(/active goals?/i);
    expect(document.body.textContent).not.toMatch(/unlimited goals/i);
  });

  it("offers exactly one filled button, on the trial", async () => {
    // §8.5.5 — one filled button per screen, and the design system rather than a
    // guess decides which CTA is primary.
    await renderPage();

    // `text-on-accent` is unique to the filled variant; matching on
    // "bg-accent" would also catch the text variant's `hover:bg-accent-weak`.
    const primary = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("text-on-accent"));
    expect(primary).toHaveLength(1);
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
    expect(offer.offers.highPrice).toBe("199.00");
    expect(offer.offers.lowPrice).toBe("0.00");

    const faq = blocks.find((b) => b["@type"] === "FAQPage")!;
    // Every marked-up question is visible on the page (§13.3's rule).
    for (const entry of faq.mainEntity) {
      expect(screen.getByRole("heading", { name: entry.name })).toBeTruthy();
    }
  });
});
