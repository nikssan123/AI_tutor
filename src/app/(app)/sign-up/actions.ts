"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, MIN_PASSWORD_LENGTH, VERIFY_CALLBACK } from "@/lib/auth";
import { explain } from "@/lib/account/errors";
import { safeDestination, withDestination } from "@/lib/account/next-url";

/**
 * Creating the account, as a Server Action.
 *
 * Sign-in is a client form because it has to stay responsive to a wrong
 * password; sign-up has no such loop — it is one submit, and then a code to
 * type — so it is a plain POST that works with no JavaScript at all.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Back to the form, carrying the address forward.
 *
 * Without the `email` round trip, mistyping the second password empties the
 * whole form — which is how a two-password form becomes worse than a one-
 * password form rather than safer than one.
 */
function back(message: string, email: string, destination: string): never {
  redirect(
    withDestination(
      `/sign-up?error=${encodeURIComponent(message)}&email=${encodeURIComponent(email)}`,
      destination,
    ),
  );
}

export async function signUpAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  const destination = safeDestination(String(formData.get("next") ?? ""));

  if (!EMAIL.test(email)) {
    back("That doesn't look like an email address.", email, destination);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    back(
      `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
      email,
      destination,
    );
  }

  // Checked before the request, so a typo costs nothing and reveals nothing.
  if (password !== confirmation) {
    back("Those two passwords don't match.", email, destination);
  }

  try {
    await getAuth().api.signUpEmail({
      headers: await headers(),
      body: {
        email,
        password,
        // §15's `name` is required by Better Auth and we have not asked for one
        // yet: sign-up is not the place to collect a display name nobody has
        // been shown a reason to choose. `/account` is where it gets set.
        name: email,
        callbackURL: VERIFY_CALLBACK,
      },
    });
  } catch (error) {
    back(explain(error, "We couldn't create that account."), email, destination);
  }

  /*
   * Straight to the code, not to /today.
   *
   * `autoSignIn` has already put a session in place, so the product is
   * reachable — but the confirmation code was sent by the plugin's post-sign-up
   * hook a moment ago, and the only screen where it is useful is this one.
   * Someone who skips it is not blocked; the header keeps asking.
   */
  redirect(withDestination(VERIFY_CALLBACK, destination));
}
