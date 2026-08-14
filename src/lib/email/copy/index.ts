import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { en, type EmailStrings } from "./en";
import { de } from "./de";
import { bg } from "./bg";
import { es } from "./es";

export type { EmailStrings };

/**
 * Every locale's copy, in one map keyed by locale.
 *
 * `Record<Locale, …>` rather than a lookup with a fallback: a language added to
 * `LOCALES` with no copy file is a compile error here, which is the only place
 * that mistake can still be caught for free. After this point the copy is just
 * data, and a missing language would degrade to silence.
 */
export const COPY: Record<Locale, EmailStrings> = { en, de, bg, es };

export function copyFor(locale: Locale): EmailStrings {
  return COPY[locale];
}

/** The English copy, which is also the shape every other locale is checked against. */
export const DEFAULT_COPY = COPY[DEFAULT_LOCALE];
