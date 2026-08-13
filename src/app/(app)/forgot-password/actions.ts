"use server";

import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

/**
 * §18.1 — asking for a password reset.
 *
 * The one rule this action exists to keep: **it must behave identically whether
 * or not the address has an account.** Anything else turns the form into an
 * oracle that tells a stranger who is registered here. Better Auth already
 * returns the same body either way; this adds the other half — the same
 * redirect, and no error surfaced to the caller no matter what went wrong.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where the link in the email drops the reader. */
const RESET_PAGE = "/reset-password";

export async function requestResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  // A malformed address is not a lookup, so saying so leaks nothing.
  if (!EMAIL.test(email)) {
    redirect("/forgot-password?error=1");
  }

  try {
    await getAuth().api.requestPasswordReset({
      body: { email, redirectTo: RESET_PAGE },
    });
  } catch (error) {
    // Logged, not shown. A failure here is our problem — a dead mail provider,
    // a misconfigured key — and reporting it differently from success would
    // reveal that the address exists.
    console.error("[auth] password reset request failed:", error);
  }

  redirect("/forgot-password?sent=1");
}
