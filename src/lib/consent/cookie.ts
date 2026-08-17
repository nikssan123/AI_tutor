/**
 * The one question this site asks before it measures anything.
 *
 * Its own module, with no imports, for the reason `referral/cookie.ts` is one:
 * the banner writes this, three layouts read it, and the privacy page offers to
 * change it. None of them should have to pull in the others' dependencies to
 * agree on a name.
 *
 * ## Why there is a question at all
 *
 * Everything else this site stores on a device is doing a job the visitor asked
 * for — keeping them signed in, remembering a theme, holding a half-finished
 * skill check. None of those needs permission. Analytics is the first thing
 * here that is stored for *our* benefit rather than theirs, and that is the
 * line ePrivacy draws: not "is it personal data", but "did you put something on
 * their device for your own purposes". So it is asked, once, and the answer is
 * honoured until it is changed.
 */

/** Granted or denied. Absent means the question has not been answered yet. */
export type ConsentChoice = "granted" | "denied";

export const CONSENT_COOKIE = "mk_consent";

/**
 * Six months, for both answers.
 *
 * A "yes" that never expires is consent nobody can be said to still be giving,
 * and a "no" that expires next week is a banner that has learned nothing. Six
 * months is the interval the French and UK regulators both settle on, and it
 * has the property that matters here: the same number for both answers, so
 * nobody can accuse the shorter one of being a nudge.
 */
export const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

/**
 * `httpOnly` because nothing in the browser reads this. The banner is server
 * rendered, and the client component that loads PostHog is told the answer as a
 * prop — so the decision travels down the tree rather than being re-read from
 * `document.cookie` by whatever happens to want it.
 */
export const CONSENT_COOKIE_OPTIONS = {
  maxAge: CONSENT_COOKIE_MAX_AGE,
  httpOnly: true,
  sameSite: "lax",
  path: "/",
} as const;

/**
 * Normalises a raw cookie value to an answer.
 *
 * Anything that is not one of the two words is `undefined` — the question is
 * unanswered — and *not* "denied". The difference matters: an unanswered
 * question shows the banner again, and a hand-edited or truncated cookie should
 * put the choice back in the visitor's hands rather than quietly deciding for
 * them in either direction.
 */
export function toConsent(
  value: string | null | undefined,
): ConsentChoice | undefined {
  return value === "granted" || value === "denied" ? value : undefined;
}

/**
 * The cookie `posthog-js` keeps its anonymous id in, derived the same way the
 * library derives it (`"ph_" + token + "_posthog"`).
 *
 * We need the name because withdrawing consent has to actually remove the
 * thing consent was given for. Deleting it from the server is only possible
 * because the client is configured with `persistence: "cookie"` — see
 * `posthog-client.tsx`, where that choice is made for exactly this reason.
 */
export function posthogCookieName(key: string): string {
  return `ph_${key}_posthog`;
}
