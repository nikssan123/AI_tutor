/**
 * The unconfirmed-address banner's "not now", in one place.
 *
 * A cookie rather than a column, because the thing being remembered is a
 * dismissal made in a browser, not a fact about the account — and because a
 * banner that cannot be closed is a banner people learn to read past, which
 * costs us the one nudge we get.
 *
 * It comes back. Confirming the address is what makes a password reset
 * possible at all, so this is a snooze rather than a switch: a week is long
 * enough that it stops feeling like the product nagging, short enough that an
 * account which never confirms is asked again before it needs the reset it
 * cannot have.
 *
 * A plain module rather than a constant in `actions.ts`: a `"use server"` file
 * may export nothing but async functions, and `pnpm actions:audit` fails on a
 * constant exported from one.
 */

export const VERIFY_SNOOZE_COOKIE = "verify_snooze";

/** Seven days, in seconds. */
export const VERIFY_SNOOZE_SECONDS = 60 * 60 * 24 * 7;
