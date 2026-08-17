import { describe, expect, it } from "vitest";
import { PLAN_IDS } from "@/lib/billing/catalog";
import {
  ANNUAL_PLAN_IDS,
  annualPerMonthCents,
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
  smallestAnnualSavingPercent,
  taxBehavior,
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
        expect(findPrice(planId, "month", currency)).toBeDefined();
      }
    }
  });

  it("sells every subscription by the year, in every currency", () => {
    /*
     * The invariant `/pricing` renders against rather than guards. Its yearly
     * view redraws every card it charges for, so a subscription with no annual
     * row would throw through `requirePrice` — which is the correct failure and
     * a bad way to find out. Learner was monthly-only until 2026-08-17 and the
     * page carried a "billed monthly" exception for it; this test is what
     * replaced that exception.
     */
    for (const currency of CURRENCIES) {
      for (const planId of ["learner", "pro"] as const) {
        expect(findPrice(planId, "year", currency)).toBeDefined();
      }
    }
  });

  it("does not sell the trial by the year", () => {
    // `checkoutBody` holds off a *monthly* price for four days. A four-day
    // trial of a year is a period that does not exist, and a row here would be
    // an amount some future call site could charge for it.
    for (const currency of CURRENCIES) {
      expect(findPrice("trial", "year", currency)).toBeUndefined();
    }
  });

  it("has no price for free", () => {
    expect(PRICES.some((p) => (p.planId as string) === "free")).toBe(false);
  });

  it("has one row per plan, interval and currency", () => {
    // Two rows for the same three keys means `findPrice` picks by array order,
    // which is a coin toss over what somebody is charged.
    const keys = PRICES.map((p) => `${p.planId}:${p.interval}:${p.currency}`);
    expect(new Set(keys).size).toBe(PRICES.length);
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

  it("prices learner below pro in both currencies, by the month and by the year", () => {
    for (const currency of CURRENCIES) {
      for (const interval of ["month", "year"] as const) {
        expect(
          requirePrice("learner", interval, currency).amountCents,
        ).toBeLessThan(requirePrice("pro", interval, currency).amountCents);
      }
    }
  });

  it("prices a year below twelve months of the same plan", () => {
    // Otherwise the switch on `/pricing` is a control that offers a reader a
    // worse deal and calls it a saving.
    for (const currency of CURRENCIES) {
      for (const planId of ANNUAL_PLAN_IDS) {
        expect(
          requirePrice(planId, "year", currency).amountCents,
        ).toBeLessThan(requirePrice(planId, "month", currency).amountCents * 12);
      }
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

describe("taxBehavior", () => {
  it("marks euro amounts as containing the tax and dollar amounts as net", () => {
    // Swap these two and every EU checkout adds VAT on top of a price that
    // already contained it — the page says €24.99 and the card is charged
    // €30.24, which is §6.3 rule 1 broken by a one-word setting.
    expect(taxBehavior("eur")).toBe("inclusive");
    expect(taxBehavior("usd")).toBe("exclusive");
  });
});

describe("requirePrice", () => {
  it("returns the row when there is one", () => {
    expect(requirePrice("pro", "year", "eur").amountCents).toBe(19_900);
  });

  it("throws rather than guessing an amount", () => {
    // There is no safe number to charge when the table does not know what the
    // customer is buying. This read `learner/year` until Learner started
    // selling one; the trial is the row that must never exist.
    expect(() => requirePrice("trial", "year", "usd")).toThrow(
      /No price for trial\/year\/usd/,
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

describe("ANNUAL_PLAN_IDS", () => {
  it("is read off the table rather than listed again", () => {
    // The point of deriving it: a plan that gains a `year` row is offered one,
    // without anybody remembering a second list. Learner arrived that way.
    expect([...ANNUAL_PLAN_IDS].sort()).toEqual(["learner", "pro"]);
  });

  it("names each plan once, however many currencies it is priced in", () => {
    // Two rows per plan in the table; one entry per plan here, or every caller
    // that maps over it does its arithmetic twice.
    expect(new Set(ANNUAL_PLAN_IDS).size).toBe(ANNUAL_PLAN_IDS.length);
  });
});

describe("annualSavingPercent", () => {
  it("gives four true answers where §20.1 wrote one", () => {
    // The plan document's 37% belonged to $190 against $25. Neither the two
    // currencies nor the two plans agree, which is why this takes both: €199
    // against €24.99 x 12 is 33%, $219 against $27.99 x 12 is 34%, €109
    // against €12.99 x 12 is 30% and $119 against $14.99 x 12 is 33%.
    expect(annualSavingPercent("pro", "eur")).toBe(33);
    expect(annualSavingPercent("pro", "usd")).toBe(34);
    expect(annualSavingPercent("learner", "eur")).toBe(30);
    expect(annualSavingPercent("learner", "usd")).toBe(33);
  });

  it("never rounds up", () => {
    for (const currency of CURRENCIES) {
      for (const planId of ANNUAL_PLAN_IDS) {
        const monthly = requirePrice(planId, "month", currency).amountCents * 12;
        const yearly = requirePrice(planId, "year", currency).amountCents;
        const exact = ((monthly - yearly) / monthly) * 100;
        expect(annualSavingPercent(planId, currency)).toBeLessThanOrEqual(exact);
      }
    }
  });
});

describe("smallestAnnualSavingPercent", () => {
  it("is the floor of the savings on offer, per currency", () => {
    // Learner discounts less steeply than Pro in both columns, so the figure a
    // control sitting above both cards may carry is Learner's.
    expect(smallestAnnualSavingPercent("eur")).toBe(30);
    expect(smallestAnnualSavingPercent("usd")).toBe(33);
  });

  it("understates no plan's saving in either currency", () => {
    // The assertion that matters: a switch labelled with this number can never
    // promise more than a card underneath it delivers.
    for (const currency of CURRENCIES) {
      for (const planId of ANNUAL_PLAN_IDS) {
        expect(smallestAnnualSavingPercent(currency)).toBeLessThanOrEqual(
          annualSavingPercent(planId, currency),
        );
      }
    }
  });
});

describe("annualPerMonthCents", () => {
  it("is the year divided by twelve", () => {
    // €199/12 is €16.583…; $219/12 is $18.25 exactly.
    expect(annualPerMonthCents("pro", "eur")).toBe(1_659);
    expect(annualPerMonthCents("pro", "usd")).toBe(1_825);
    expect(annualPerMonthCents("learner", "eur")).toBe(909);
    expect(annualPerMonthCents("learner", "usd")).toBe(992);
  });

  it("never quotes a year cheaper than the year costs", () => {
    // Rounded up, the opposite direction to the saving and for the same reason:
    // €16.58 x 12 is €198.96, which undercuts our own €199 on our own page.
    for (const currency of CURRENCIES) {
      for (const planId of ANNUAL_PLAN_IDS) {
        expect(annualPerMonthCents(planId, currency) * 12).toBeGreaterThanOrEqual(
          requirePrice(planId, "year", currency).amountCents,
        );
      }
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
