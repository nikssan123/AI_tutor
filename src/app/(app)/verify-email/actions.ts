"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, OTP_LENGTH } from "@/lib/auth";
import { explain } from "@/lib/account/errors";
import { safeDestination, withDestination } from "@/lib/account/next-url";
import { requireUser } from "@/lib/account/session";

/**
 * Typing the code back in, and asking for another.
 *
 * Both need a session, which the sign-up flow always has: `autoSignIn` puts one
 * in place before the code is sent. That is what lets the form ask for six
 * digits and nothing else — no email field to retype, and no way to aim a code
 * at an address that is not the one being confirmed.
 */

function back(message: string, destination: string): never {
  redirect(
    withDestination(
      `/verify-email?error=${encodeURIComponent(message)}`,
      destination,
    ),
  );
}

/**
 * Where they were headed before sign-up interrupted, carried on every hop of
 * this screen — a wrong code and a resend both come back here, and dropping it
 * on either one loses the subject just as thoroughly as never carrying it.
 */
function destinationOf(formData?: FormData): string {
  return safeDestination(String(formData?.get("next") ?? ""));
}

export async function verifyCodeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const destination = destinationOf(formData);

  // Spaces and hyphens survive a paste from a mail client; nothing else does.
  const code = String(formData.get("code") ?? "").replace(/[\s-]/g, "");

  if (code.length !== OTP_LENGTH) {
    back(`The code is ${OTP_LENGTH} digits.`, destination);
  }

  try {
    await getAuth().api.verifyEmailOTP({
      headers: await headers(),
      body: { email: user.email, otp: code },
    });
  } catch (error) {
    back(explain(error, "We couldn't check that code."), destination);
  }

  redirect(withDestination("/verify-email?confirmed=1", destination));
}

export async function sendCodeAction(formData?: FormData): Promise<void> {
  const user = await requireUser();
  const destination = destinationOf(formData);

  try {
    await getAuth().api.sendVerificationOTP({
      headers: await headers(),
      body: { email: user.email, type: "email-verification" },
    });
  } catch (error) {
    back(explain(error, "We couldn't send a new code."), destination);
  }

  redirect(withDestination("/verify-email?sent=1", destination));
}
