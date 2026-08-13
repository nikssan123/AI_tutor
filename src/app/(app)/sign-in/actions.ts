"use server";

import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { safeDestination } from "@/lib/account/next-url";

/**
 * Handing off to Google.
 *
 * A Server Action rather than the client SDK's `signIn.social`, so the button
 * works before — or without — hydration. The endpoint returns the URL to send
 * the browser to; we redirect rather than fetch it, because the whole point is
 * that the person, not the server, arrives at Google's consent screen.
 */
export async function signInWithGoogleAction(
  formData?: FormData,
): Promise<void> {
  // Sanitised again rather than trusted: this is a Server Action, so the body
  // is whatever was posted, not whatever the page rendered.
  const next = safeDestination(String(formData?.get("next") ?? ""));

  const { url } = await getAuth().api.signInSocial({
    body: { provider: "google", callbackURL: next },
  });

  // `signInSocial` types `url` as optional because a provider can be configured
  // to return an id token instead; Google's redirect flow always has one, and
  // there is nothing sensible to do without it.
  if (!url) redirect("/sign-in?error=google");

  redirect(url);
}
