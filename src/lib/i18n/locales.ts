/**
 * The four languages the product speaks (PLAN-LOCALIZATION §3).
 *
 * This is the file that plan names, arriving early because email needed it
 * first: a transactional message is the one surface where the reader has no
 * language switcher, no URL to edit and no second chance — it is written once,
 * sent, and read in whatever language we chose for them. So the locale model
 * lands here rather than waiting for the routing work.
 *
 * Region-less codes on purpose. `de` not `de-DE`, because Austria and
 * Switzerland get the same German; `es` not `es-ES`, because the copy avoids
 * *vosotros* and reads in both Spain and Latin America.
 */

export const LOCALES = ["en", "de", "bg", "es"] as const;

export const DEFAULT_LOCALE = "en";

export type Locale = (typeof LOCALES)[number];

/**
 * What each language calls itself.
 *
 * Endonyms, not "German"/"Bulgarian". The only place a person picks from this
 * list is a language selector, and someone who needs the selector is by
 * definition someone who may not read the language the list is written in.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  bg: "Български",
  es: "Español",
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Whatever we were given → a locale we can actually render.
 *
 * Lenient by design, because the inputs are not ours: `user.locale` is a plain
 * text column an older row may have filled with anything, an `Accept-Language`
 * header arrives as `de-AT,de;q=0.9`, and a form posts a string. All of them
 * resolve to a language we have copy for, or to English.
 *
 * The region is dropped rather than rejected — `de-AT` is German, and a reader
 * in Vienna getting an English password reset because of a suffix would be an
 * absurd way to fail.
 */
export function resolveLocale(value: unknown): Locale {
  if (typeof value !== "string") return DEFAULT_LOCALE;

  // `split` always yields at least one element, so there is nothing to guard.
  const base = value.trim().toLowerCase().split(/[-_;,]/)[0]!;
  return isLocale(base) ? base : DEFAULT_LOCALE;
}

/**
 * The locale of a Better Auth user object.
 *
 * Typed as `unknown` because that is honestly what we have: `locale` is an
 * `additionalFields` column, so it is present at runtime on every user Better
 * Auth hands to an email callback but is not on the narrowed type those
 * callbacks declare. Reading it defensively is cheaper than casting, and it
 * degrades to English rather than throwing inside a send.
 */
export function localeOf(subject: unknown): Locale {
  if (typeof subject !== "object" || subject === null) return DEFAULT_LOCALE;
  return resolveLocale((subject as { locale?: unknown }).locale);
}
