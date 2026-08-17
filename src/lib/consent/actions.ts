"use server";

import { cookies } from "next/headers";
import { posthogKey } from "@/lib/observability/posthog";
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
   *
   * Read through `posthogKey()` rather than as `process.env.NEXT_PUBLIC_…`
   * here, and the difference is not stylistic. Next inlines the literal form at
   * build time — "your app will no longer respond to changes to these
   * environment variables" (`next/dist/docs/01-app/02-guides/
   * environment-variables.md`) — and it inlines it on the server too, not just
   * in the browser bundle. An image built without the key would freeze this
   * line to `undefined` while the banner, which reads the same variable through
   * a parameter, kept working from the runtime environment. The result would be
   * a "No thanks" that stops collection and silently leaves the cookie on the
   * device, in production only, with `/privacy` promising otherwise.
   *
   * `posthogKey(env = process.env)` reads it off a *variable*, which the same
   * document lists as the form Next does not inline. That is what keeps this a
   * runtime value.
   */
  if (choice === "denied") {
    const key = posthogKey();
    if (key) jar.delete(posthogCookieName(key));
  }
}
