"use server";

import { redirect } from "next/navigation";
import { getAuth, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { explain } from "@/lib/account/errors";

/**
 * Setting the new password, with the token from the emailed link.
 *
 * The token stays in the query string on failure so a mistyped confirmation
 * does not cost someone their link — the alternative is sending them back to
 * `/forgot-password` to request a second email because they typed the same
 * password two different ways.
 */
function back(token: string, message: string): never {
  redirect(
    `/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`,
  );
}

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  if (!token) {
    redirect("/forgot-password?error=1");
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    back(token, `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  if (newPassword !== confirmation) {
    back(token, "Those two passwords don't match.");
  }

  try {
    await getAuth().api.resetPassword({ body: { newPassword, token } });
  } catch (error) {
    back(token, explain(error, "We couldn't set that password."));
  }

  /*
   * To sign-in rather than into the product. `revokeSessionsOnPasswordReset`
   * has just dropped every session this account had — which is the entire
   * point of a reset — so there is nothing to sign in *with* until they use the
   * new password, and that is the right way to prove it took.
   */
  redirect("/sign-in?reset=1");
}
