import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_NAMES,
  LOCALES,
  localeOf,
  resolveLocale,
} from "@/lib/i18n/locales";

/**
 * The locale model, which email is the first consumer of.
 *
 * The tests worth having here are all about leniency: every input is something
 * we did not write — a text column, a header, a form field — and the cost of
 * being strict is an English password reset for someone who chose German.
 */

describe("LOCALES", () => {
  it("has English first and as the default", () => {
    expect(LOCALES[0]).toBe(DEFAULT_LOCALE);
  });

  it("names every language in that language", () => {
    // An endonym, because the only person reading a language list is someone
    // who may not read the language the list is written in.
    for (const locale of LOCALES) expect(LOCALE_NAMES[locale]).toBeTruthy();
    expect(LOCALE_NAMES.de).toBe("Deutsch");
    expect(LOCALE_NAMES.bg).toBe("Български");
  });

  it("carries no region codes", () => {
    // `de` serves Austria and Switzerland; `es` serves both hemispheres.
    for (const locale of LOCALES) expect(locale).not.toContain("-");
  });
});

describe("isLocale", () => {
  it.each(LOCALES)("accepts %s", (locale) => {
    expect(isLocale(locale)).toBe(true);
  });

  it.each([["de-DE"], ["EN"], [""], ["fr"], [null], [undefined], [7]])(
    "rejects %o",
    (value) => {
      expect(isLocale(value)).toBe(false);
    },
  );
});

describe("resolveLocale", () => {
  it.each([
    ["de", "de"],
    ["de-DE", "de"],
    ["de_AT", "de"],
    ["  BG  ", "bg"],
    ["es-419", "es"],
    // An Accept-Language header, which is the shape nobody remembers until it
    // is in production.
    ["bg-BG,bg;q=0.9,en;q=0.8", "bg"],
  ])("reads %o as %s", (value, expected) => {
    expect(resolveLocale(value)).toBe(expected);
  });

  it.each([["fr"], [""], [null], [undefined], [42], [{}]])(
    "falls back to English for %o",
    (value) => {
      expect(resolveLocale(value)).toBe("en");
    },
  );
});

describe("localeOf", () => {
  it("reads the locale off a user object", () => {
    expect(localeOf({ id: "u1", locale: "bg" })).toBe("bg");
  });

  it("falls back when the field is missing, unknown, or the subject is not an object", () => {
    // Better Auth's callbacks declare a narrower user type than they pass, so
    // this has to survive a shape we cannot see from here.
    expect(localeOf({ id: "u1" })).toBe("en");
    expect(localeOf({ locale: "klingon" })).toBe("en");
    expect(localeOf(null)).toBe("en");
    expect(localeOf("bg")).toBe("en");
  });
});
