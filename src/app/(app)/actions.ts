"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/account/session";
import {
  VERIFY_SNOOZE_COOKIE,
  VERIFY_SNOOZE_SECONDS,
} from "@/lib/account/verify-banner";

/**
 * What the `(app)` chrome itself can do — as opposed to the screens inside it.
 *
 * One action so far: closing the unconfirmed-address banner.
 */

/**
 * Puts the banner away for a week.
 *
 * `requireUser` first, even though the only consequence of this action is a
 * cookie in the caller's own browser: Next's guidance is to treat every Server
 * Action as a public endpoint, and an action that skips the check because "it
 * cannot do any harm" is the one that gets extended later by someone reading
 * only the body.
 *
 * `refresh()` is what makes the banner disappear on the click rather than on
 * the next navigation. With no JavaScript the browser's own POST already
 * re-renders the page; with it, the router needs telling
 * (`next/dist/docs/01-app/03-api-reference/04-functions/refresh.md`).
 */
export async function snoozeVerifyBannerAction(): Promise<void> {
  await requireUser();

  const jar = await cookies();
  jar.set(VERIFY_SNOOZE_COOKIE, "1", {
    // Site-wide: the banner is drawn on every authenticated screen, so a
    // path-scoped cookie would close it on one of them.
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: VERIFY_SNOOZE_SECONDS,
  });

  refresh();
}
