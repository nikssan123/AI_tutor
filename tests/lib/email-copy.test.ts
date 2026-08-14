import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { COPY, copyFor, DEFAULT_COPY } from "@/lib/email/copy";
import { TEMPLATE_IDS } from "@/lib/email/catalog";

/**
 * The copy files, as data.
 *
 * TypeScript already guarantees that every locale has every key — `de` is
 * declared as `EmailStrings`, so a missing one does not compile. What it cannot
 * check is the thing that actually goes wrong with translated copy: a
 * placeholder dropped in translation, a paragraph left in English, a sentence
 * that lost the `{duration}` and now promises nothing.
 */

/** Every `{token}` a string interpolates. */
function tokens(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

function entriesOf(locale: Locale) {
  const copy = copyFor(locale);
  return [
    ...Object.entries(copy.system).map(
      ([name, entry]) => [`system.${name}`, entry] as const,
    ),
    ...Object.entries(copy.operator).map(
      ([name, entry]) => [`operator.${name}`, entry] as const,
    ),
  ];
}

/** Every translatable string in an entry, flattened. */
function strings(entry: Record<string, unknown>): string[] {
  return Object.values(entry).flatMap((value) =>
    typeof value === "string" ? [value] : (value as string[]),
  );
}

describe("every locale", () => {
  it.each(LOCALES)("%s has copy", (locale) => {
    expect(COPY[locale]).toBeDefined();
    expect(copyFor(locale)).toBe(COPY[locale]);
  });

  it("defaults to English", () => {
    expect(DEFAULT_COPY).toBe(COPY.en);
  });

  it.each(LOCALES)("%s uses the same placeholders as English does", (locale) => {
    // The failure this catches is the expensive one: a translator drops
    // `{duration}` and every German reader is told the link expires, without
    // being told when.
    for (const [name, entry] of entriesOf(locale)) {
      const english = entriesOf("en").find(([key]) => key === name)![1];

      expect({ [name]: tokens(strings(entry).join(" ")) }).toEqual({
        [name]: tokens(strings(english as Record<string, unknown>).join(" ")),
      });
    }
  });

  it.each(LOCALES)("%s leaves no string empty except a heading", (locale) => {
    // The two support templates have no heading on purpose — a reply that
    // opens with a banner is a newsletter. Everything else must say something.
    for (const [name, entry] of entriesOf(locale)) {
      for (const [key, value] of Object.entries(entry)) {
        if (key === "heading") continue;
        expect({ [`${name}.${key}`]: value }).not.toEqual({
          [`${name}.${key}`]: "",
        });
      }
    }
  });
});

describe("the translations are actually translations", () => {
  it.each(["de", "bg", "es"] as const)(
    "%s does not repeat the English body verbatim",
    (locale) => {
      const english = entriesOf("en");

      for (const [name, entry] of entriesOf(locale)) {
        const mine = strings(entry).join(" ");
        const theirs = strings(
          english.find(([key]) => key === name)![1] as Record<string, unknown>,
        ).join(" ");

        expect({ [name]: mine === theirs }).toEqual({ [name]: false });
      }
    },
  );

  it("keeps the brand untranslated", () => {
    for (const locale of LOCALES) expect(copyFor(locale).brand).toBe("MeritKeep");
  });
});

describe("the operator catalog and the copy agree", () => {
  it.each(LOCALES)("%s has an entry for every template id", (locale) => {
    const operator = copyFor(locale).operator as Record<string, unknown>;
    for (const id of TEMPLATE_IDS) expect(operator[id]).toBeDefined();
  });

  it.each(LOCALES)("%s signs every operator message", (locale) => {
    // A support reply with no signature is a form letter, which is the one
    // thing a support reply must not be.
    for (const entry of Object.values(copyFor(locale).operator)) {
      expect(entry.signature).toContain("{sender}");
    }
  });
});
