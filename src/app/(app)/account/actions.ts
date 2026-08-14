"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getAuth, MIN_PASSWORD_LENGTH, VERIFY_CALLBACK } from "@/lib/auth";
import { accountError, accountOk, explain } from "@/lib/account/errors";
import { parseProfileForm } from "@/lib/account/profile";
import { requireUser } from "@/lib/account/session";
import { toThemeChoice } from "@/lib/theme-script";

/**
 * Everything `/account` can do, as Server Actions.
 *
 * Deliberately not the client SDK, which is what `/sign-in` uses. Three reasons,
 * in order of weight:
 *
 * 1. These run on the server, so `auth.api.setPassword` — a `serverOnly`
 *    endpoint, unreachable over HTTP — is available. It is the only way to give
 *    a Google-only account a password, and a client-side account page simply
 *    cannot offer it.
 * 2. The page ships no JavaScript. An account screen that cannot be used until
 *    a bundle downloads is the same mistake §24 E3 avoided on the goal form.
 * 3. The session is read server-side on every action anyway (Next's own
 *    guidance: treat a Server Action like a public endpoint and verify inside
 *    it), so doing the work there too removes a whole round trip.
 *
 * `nextCookies()` in `src/lib/auth.ts` is what lets these set cookies.
 */

/** A plain-enough address check, so the API's schema error never reaches a UI. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where the link in the password email drops the reader. */
const RESET_PAGE = "/reset-password";

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  // Home rather than /sign-in: someone who just signed out has said they are
  // done, and landing them on a login form reads as a failed sign-out.
  redirect("/");
}

/**
 * The one to reach for after "I think someone else has my password" — it drops
 * every session this account has anywhere, this one included.
 */
export async function signOutEverywhereAction(): Promise<void> {
  const requestHeaders = await headers();
  await getAuth().api.revokeSessions({ headers: requestHeaders });
  // The rows are already gone, so this only clears the cookie in this browser;
  // sign-out deletes the cookie whether or not the session still exists.
  await getAuth().api.signOut({ headers: requestHeaders });
  redirect("/");
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  await requireUser();

  const parsed = parseProfileForm(formData);
  if (!parsed.ok) accountError(parsed.error);

  try {
    await getAuth().api.updateUser({
      headers: await headers(),
      body: parsed.update,
    });
  } catch (error) {
    accountError(explain(error, "We couldn't save that."));
  }

  accountOk("Saved.");
}

export async function changeEmailAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const newEmail = String(formData.get("newEmail") ?? "")
    .trim()
    .toLowerCase();

  if (!EMAIL.test(newEmail)) accountError("That doesn't look like an email address.");
  if (newEmail === user.email) accountError("That's already your address.");

  try {
    await getAuth().api.changeEmail({
      headers: await headers(),
      body: { newEmail, callbackURL: VERIFY_CALLBACK },
    });
  } catch (error) {
    accountError(explain(error, "We couldn't start that change."));
  }

  /*
   * Which inbox to check depends on which flow Better Auth took, and the
   * difference matters enough to say out loud: a verified account approves the
   * move from the address it is *leaving*, which is the property that stops a
   * stolen session relocating an account quietly. An unverified one has no
   * such address to ask, so the new one is confirmed directly.
   */
  accountOk(
    user.emailVerified
      ? `Check ${user.email} — your current address — and open the link to approve the change. Nothing changes until you do.`
      : `Check ${newEmail} for a link to confirm the new address.`,
  );
}

/**
 * Changing a password, through the inbox rather than in the page.
 *
 * This replaced a `changePassword` form that took the current password and the
 * new one inline. The emailed link is the stronger of the two: the old form
 * could be driven start to finish from a session someone else had got hold of,
 * as long as they also had the current password — and a session worth stealing
 * is usually one taken from an unlocked machine, where the browser knows the
 * current password too. A link goes to the inbox, so a stolen session can start
 * this and cannot finish it.
 *
 * It is the same endpoint `/forgot-password` calls, and deliberately so: one
 * way to end up holding a new password rather than two that behave differently.
 * What it does *not* do is copy that action's silence about failures — the
 * anonymity rule there exists so a stranger cannot use the form to discover who
 * has an account here, and this caller is already signed in as the only address
 * it will ever send to. There is nobody to keep the secret from.
 */
export async function emailPasswordLinkAction(): Promise<void> {
  const user = await requireUser();

  try {
    await getAuth().api.requestPasswordReset({
      body: { email: user.email, redirectTo: RESET_PAGE },
    });
  } catch (error) {
    accountError(explain(error, "We couldn't send that email."));
  }

  accountOk(`Check ${user.email} for a link to choose a new password.`);
}

/**
 * For an account that arrived through Google and has no password at all.
 *
 * Without this, disconnecting Google is refused forever (there would be no way
 * left to sign in), so the account is permanently tied to one provider.
 */
export async function setPasswordAction(formData: FormData): Promise<void> {
  await requireUser();

  const newPassword = String(formData.get("newPassword") ?? "");
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    accountError(`A password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  try {
    await getAuth().api.setPassword({
      headers: await headers(),
      body: { newPassword },
    });
  } catch (error) {
    accountError(explain(error, "We couldn't set that password."));
  }

  accountOk("Password set. You can now sign in with your email address too.");
}

/**
 * Sends a fresh confirmation **code** and goes to the screen that takes it.
 *
 * A code rather than the link this used to send, so there is one way to confirm
 * an address rather than two that behave differently. The redirect matters as
 * much as the send: someone who asks for a code should land where they can type
 * it, not back on a settings page with a green line at the top.
 */
export async function resendVerificationAction(): Promise<void> {
  const user = await requireUser();
  if (user.emailVerified) accountError("That address is already confirmed.");

  try {
    await getAuth().api.sendVerificationOTP({
      headers: await headers(),
      body: { email: user.email, type: "email-verification" },
    });
  } catch (error) {
    accountError(explain(error, "We couldn't send that email."));
  }

  redirect(`${VERIFY_CALLBACK}?sent=1`);
}

/**
 * Copies the appearance choice onto the account, so the mail we send matches
 * the product the person set it in.
 *
 * The toggle has already applied the theme, written `localStorage` and written
 * the cookie by the time this runs — none of which is undone if this fails.
 * That ordering is the whole design: the visible half is synchronous and
 * local, and this is a note to the server about a message it will compose
 * hours later, in a job with no browser attached. So it never reports an
 * error, never redirects, and never revalidates: there is nothing on screen
 * for it to correct.
 *
 * Written with Drizzle rather than `updateUser`, because `theme` is marked
 * `input: false` in `src/lib/auth.ts` — the column is not something a request
 * body gets to set, and `toThemeChoice` is the gate that keeps a value the
 * renderer has no palette for out of the row.
 */
export async function rememberThemeAction(choice: string): Promise<void> {
  const user = await requireUser();

  await getDb()
    .update(schema.user)
    .set({ theme: toThemeChoice(choice), updatedAt: new Date() })
    .where(eq(schema.user.id, user.id));
}

export async function linkGoogleAction(): Promise<void> {
  await requireUser();

  let url: string;
  try {
    const result = await getAuth().api.linkSocialAccount({
      headers: await headers(),
      body: { provider: "google", callbackURL: "/account" },
    });
    url = result.url;
  } catch (error) {
    accountError(explain(error, "We couldn't reach Google."));
  }

  // Outside the try: `redirect` works by throwing, and catching it here would
  // turn a successful hand-off to Google into "we couldn't reach Google".
  redirect(url);
}

export async function unlinkGoogleAction(): Promise<void> {
  await requireUser();

  try {
    await getAuth().api.unlinkAccount({
      headers: await headers(),
      body: { providerId: "google" },
    });
  } catch (error) {
    accountError(explain(error, "We couldn't disconnect Google."));
  }

  accountOk("Google disconnected.");
}
