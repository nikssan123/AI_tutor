import { describe, expect, it } from "vitest";
import { PLAN_IDS } from "@/lib/billing/catalog";
import {
  annualSavingPercent,
  CURRENCIES,
  CURRENCY_COOKIE,
  findPrice,
  formatMoney,
  isCurrency,
  LOCALE_CURRENCY,
  PRICES,
  requirePrice,
  resolveCurrency,
} from "@/lib/billing/prices";
import { LOCALES } from "@/lib/i18n/locales";

/**
 * Prices.
 *
 * The load-bearing test in this file is the completeness one: §6.3 rule 1 makes
 * a price the page can render but checkout cannot charge a P0, and the cheapest
 * possible guard against that is asserting every paid plan has a row in every
 * currency. Everything else here is arithmetic that a marketing page will
 * otherwise state wrongly.
 */

const PAID = PLAN_IDS.filter((id) => id !== "free");

describe("PRICES", () => {
  it("covers every paid plan in every currency", () => {
    for (const currency of CURRENCIES) {
      for (const planId of PAID) {
        // `trial` and `learner` are monthly only; `pro` also sells a year.
        expect(findPrice(planId, "month", currency)).toBeDefined();
      }
      expect(findPrice("pro", "year", currency)).toBeDefined();
    }
  });

  it("has no price for free", () => {
    expect(PRICES.some((p) => (p.planId as string) === "free")).toBe(false);
  });

  it("names a distinct env var for every row", () => {
    const names = PRICES.map((p) => p.envVar);
    expect(new Set(names).size).toBe(PRICES.length);
  });

  it("stores amounts in minor units", () => {
    // A price written as 24.99 rather than 2499 is the classic 100x charge.
    for (const price of PRICES) {
      expect(Number.isInteger(price.amountCents)).toBe(true);
      expect(price.amountCents).toBeGreaterThanOrEqual(100);
    }
  });

  it("keeps the trial fee trivial in both currencies", () => {
    // The €3 is a friction remover, not a revenue line, and it stops working
    // the moment it is a number somebody has to think about.
    for (const currency of CURRENCIES) {
      expect(
        requirePrice("trial", "month", currency).amountCents,
      ).toBeLessThan(500);
    }
  });

  it("prices learner below pro in both currencies", () => {
    for (const currency of CURRENCIES) {
      expect(
        requirePrice("learner", "month", currency).amountCents,
      ).toBeLessThan(requirePrice("pro", "month", currency).amountCents);
    }
  });

  it("sets every US price above its EU counterpart", () => {
    // A euro buys more than a dollar, so identical digits in the two columns
    // were two different amounts of money — which is what they used to be, and
    // it was never a decision, only a coincidence of typography.
    for (const usd of PRICES.filter((p) => p.currency === "usd")) {
      const eur = requirePrice(usd.planId, usd.interval, "eur");
      expect(usd.amountCents).toBeGreaterThan(eur.amountCents);
    }
  });

  it("still sets them by hand rather than off a rate", () => {
    // §6.1 — "round local numbers beat FX-derived ones". The gap is applied
    // once, by a person, and lands on a charm price; a table that tracked the
    // market would move a renewal amount under a live subscription and turn
    // §6.3 rule 1 into a race against the FX feed.
    for (const price of PRICES) {
      const cents = price.amountCents % 100;
      expect([0, 49, 99]).toContain(cents);
    }
  });

  it("keeps the gap within a band a person would call the same price", () => {
    // Roughly 12%. Far enough to be a real correction, near enough that a
    // reader comparing the two pages does not think they are being gouged.
    for (const usd of PRICES.filter((p) => p.currency === "usd")) {
      const eur = requirePrice(usd.planId, usd.interval, "eur");
      const ratio = usd.amountCents / eur.amountCents;
      expect(ratio).toBeGreaterThan(1.05);
      expect(ratio).toBeLessThan(1.25);
    }
  });
});

describe("requirePrice", () => {
  it("returns the row when there is one", () => {
    expect(requirePrice("pro", "year", "eur").amountCents).toBe(19_900);
  });

  it("throws rather than guessing an amount", () => {
    // There is no safe number to charge when the table does not know what the
    // customer is buying.
    expect(() => requirePrice("learner", "year", "usd")).toThrow(
      /No price for learner\/year\/usd/,
    );
  });
});

describe("isCurrency", () => {
  it.each(CURRENCIES)("accepts %s", (currency) => {
    expect(isCurrency(currency)).toBe(true);
  });

  it.each([["gbp"], ["USD"], [""], [null], [undefined], [3]])(
    "rejects %s",
    (value) => {
      expect(isCurrency(value)).toBe(false);
    },
  );
});

describe("LOCALE_CURRENCY", () => {
  it("assigns a currency to every locale the product speaks", () => {
    for (const locale of LOCALES) expect(LOCALE_CURRENCY[locale]).toBeDefined();
  });

  it("puts the three European locales on the euro", () => {
    expect(LOCALE_CURRENCY.en).toBe("usd");
    expect(LOCALE_CURRENCY.de).toBe("eur");
    expect(LOCALE_CURRENCY.bg).toBe("eur");
    expect(LOCALE_CURRENCY.es).toBe("eur");
  });
});

describe("resolveCurrency", () => {
  it("follows the locale when there is no cookie", () => {
    expect(resolveCurrency("de")).toBe("eur");
    expect(resolveCurrency("en")).toBe("usd");
  });

  it("lets the cookie win, because the visitor set it deliberately", () => {
    expect(resolveCurrency("de", "usd")).toBe("usd");
    expect(resolveCurrency("en", "eur")).toBe("eur");
  });

  it("ignores a cookie holding anything else", () => {
    expect(resolveCurrency("de", "gbp")).toBe("eur");
    expect(resolveCurrency("de", null)).toBe("eur");
  });

  it("defaults to English, and so to USD, with no arguments", () => {
    expect(resolveCurrency()).toBe("usd");
  });

  it("names the cookie checkout also reads", () => {
    expect(CURRENCY_COOKIE).toBe("mk_currency");
  });
});

describe("annualSavingPercent", () => {
  it("is 33% in euros and 34% in dollars, not §20.1's 37%", () => {
    // The plan document's 37% belonged to $190 against $25. The two currencies
    // no longer agree either, which is the reason this function takes one:
    // €199 against €24.99 x 12 is 33%, $219 against $27.99 x 12 is 34%, and a
    // single hard-coded figure would now be wrong on one of the two pages it
    // appeared on.
    expect(annualSavingPercent("eur")).toBe(33);
    expect(annualSavingPercent("usd")).toBe(34);
  });

  it("never rounds up", () => {
    for (const currency of CURRENCIES) {
      const monthly = requirePrice("pro", "month", currency).amountCents * 12;
      const yearly = requirePrice("pro", "year", currency).amountCents;
      const exact = ((monthly - yearly) / monthly) * 100;
      expect(annualSavingPercent(currency)).toBeLessThanOrEqual(exact);
    }
  });
});

describe("formatMoney", () => {
  it("leads with the symbol in English and trails it in German", () => {
    // §9.3 — one of the small things that is always got wrong.
    expect(formatMoney(2_499, "usd", "en")).toBe("$24.99");
    expect(formatMoney(2_499, "eur", "de")).toMatch(/^24,99\s ?€$|24,99.*€/);
  });

  it("drops empty cents on a whole amount", () => {
    expect(formatMoney(19_900, "usd", "en")).toBe("$199");
    expect(formatMoney(300, "usd", "en")).toBe("$3");
  });

  it("keeps the cents on a charm price", () => {
    expect(formatMoney(1_299, "usd", "en")).toBe("$12.99");
  });

  it("defaults to English", () => {
    expect(formatMoney(2_499, "usd")).toBe("$24.99");
  });
});
