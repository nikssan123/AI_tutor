/**
 * The referral cookie — PLAN-MONETIZATION §9.1.
 *
 * Its own module, with no imports, for one reason: `src/lib/auth.ts` reads it
 * inside a database hook and `/r/[code]` writes it, and neither should have to
 * pull in the other's dependencies to agree on a name.
 */

export const REFERRAL_COOKIE = "mk_ref";

/**
 * Ninety days.
 *
 * Long enough that somebody who is told about the product on a Friday and signs
 * up after their next pay day is still attributed, short enough that a shared
 * laptop does not carry one person's code into a stranger's signup a year
 * later. `httpOnly` because nothing in the browser needs to read it — it is
 * consumed on the server at the moment an account is created.
 */
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

export const REFERRAL_COOKIE_OPTIONS = {
  maxAge: REFERRAL_COOKIE_MAX_AGE,
  httpOnly: true,
  sameSite: "lax",
  path: "/",
} as const;
