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

  it("prices the trial at €3/$3", () => {
    for (const currency of CURRENCIES) {
      expect(requirePrice("trial", "month", currency).amountCents).toBe(300);
    }
  });

  it("prices learner below pro in both currencies", () => {
    for (const currency of CURRENCIES) {
      expect(
        requirePrice("learner", "month", currency).amountCents,
      ).toBeLessThan(requirePrice("pro", "month", currency).amountCents);
    }
  });

  it("mirrors USD and EUR rather than converting them", () => {
    // §6.1 — "round local numbers beat FX-derived ones". Mirrored amounts are
    // the observable consequence of that decision.
    for (const usd of PRICES.filter((p) => p.currency === "usd")) {
      const eur = requirePrice(usd.planId, usd.interval, "eur");
      expect(eur.amountCents).toBe(usd.amountCents);
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
  it("is 33%, not §20.1's 37%", () => {
    // $199 against $24.99 x 12. The plan document's 37% belonged to $190
    // against $25, and a pricing page that overstates its own discount is the
    // kind of error that gets quoted back at you.
    for (const currency of CURRENCIES) {
      expect(annualSavingPercent(currency)).toBe(33);
    }
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
