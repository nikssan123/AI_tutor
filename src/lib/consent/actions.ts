"use server";

import { cookies } from "next/headers";
import {
  CONSENT_COOKIE,
  CONSENT_COOKIE_OPTIONS,
  posthogCookieName,
  toConsent,
} from "./cookie";

/**
 * Answering the cookie question.
 *
 * A form POST rather than a click handler, like the currency switch and the
 * banner snooze before it. That is not a stylistic preference here: the banner
 * appears on the marketing pages, which ship no framework JavaScript at all
 * (§8.5.8), so a control that needed a bundle to work would be a consent
 * prompt that some visitors could not answer.
 *
 * Nothing but `async` functions may be exported from this file — see
 * `pnpm actions:audit`, and `cookie.ts` next door for where the constants live.
 */

export async function setConsentAction(formData: FormData): Promise<void> {
  const choice = toConsent(String(formData.get("consent") ?? ""));

  // Neither word, so nothing was decided. Silently doing nothing is right:
  // the banner is still on the page and still asking.
  if (!choice) return;

  const jar = await cookies();
  jar.set(CONSENT_COOKIE, choice, CONSENT_COOKIE_OPTIONS);

  /*
   * Withdrawing has to actually withdraw.
   *
   * A "no" that only stops *future* measurement while the id from last month
   * sits on the device is not a withdrawal, it is a pause — and the visitor has
   * no way to tell the difference. So the analytics cookie goes with the
   * answer, in the same response.
   *
   * The key comes from the environment rather than from the client, because a
   * cookie name posted by a form is a cookie name anyone can post.
   */
  if (choice === "denied") {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (key) jar.delete(posthogCookieName(key));
  }
}
