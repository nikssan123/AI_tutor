"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, OTP_LENGTH } from "@/lib/auth";
import { explain } from "@/lib/account/errors";
import { requireUser } from "@/lib/account/session";

/**
 * Typing the code back in, and asking for another.
 *
 * Both need a session, which the sign-up flow always has: `autoSignIn` puts one
 * in place before the code is sent. That is what lets the form ask for six
 * digits and nothing else — no email field to retype, and no way to aim a code
 * at an address that is not the one being confirmed.
 */

function back(message: string): never {
  redirect(`/verify-email?error=${encodeURIComponent(message)}`);
}

export async function verifyCodeAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  // Spaces and hyphens survive a paste from a mail client; nothing else does.
  const code = String(formData.get("code") ?? "").replace(/[\s-]/g, "");

  if (code.length !== OTP_LENGTH) {
    back(`The code is ${OTP_LENGTH} digits.`);
  }

  try {
    await getAuth().api.verifyEmailOTP({
      headers: await headers(),
      body: { email: user.email, otp: code },
    });
  } catch (error) {
    back(explain(error, "We couldn't check that code."));
  }

  redirect("/verify-email?confirmed=1");
}

export async function sendCodeAction(): Promise<void> {
  const user = await requireUser();

  try {
    await getAuth().api.sendVerificationOTP({
      headers: await headers(),
      body: { email: user.email, type: "email-verification" },
    });
  } catch (error) {
    back(explain(error, "We couldn't send a new code."));
  }

  redirect("/verify-email?sent=1");
}
