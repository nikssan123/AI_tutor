import type { Metadata } from "next";
import Link from "next/link";
import { messageForCode } from "@/lib/account/errors";
import { currentUser } from "@/lib/account/session";
import {
  Button,
  Card,
  DisplayTitle,
  Lead,
  Meta,
  stagger,
  Status,
} from "@/components/ui";

/**
 * Where a confirmation link lands.
 *
 * Better Auth's `/api/auth/verify-email` does the work and then redirects here:
 * with `?error=CODE` if the token was bad, and with nothing at all if it
 * worked. So "no query string" is the success case, which is worth stating
 * because it looks like an oversight and is not.
 *
 * Deliberately readable signed out. The link is usually opened in whichever
 * browser the mail client hands it to, which is often not the one holding the
 * session — `autoSignInAfterVerification` means it will be by the time this
 * renders, but the page must still make sense if a cookie failed to stick.
 */
export const metadata: Metadata = {
  title: "Email confirmed",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

export default async function VerifyEmailPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const user = await currentUser();

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
        <div className="rise flex flex-col gap-3">
          <DisplayTitle>That link didn&rsquo;t work</DisplayTitle>
          <Lead>
            {messageForCode(
              error,
              "We couldn't confirm that address with this link.",
            )}
          </Lead>
        </div>

        <Card className="rise flex flex-col gap-4" style={stagger(1)}>
          <Meta>
            Confirmation links last 24 hours. You can send yourself a fresh one
            from your account.
          </Meta>
          <div>
            <Link href={user ? "/account" : "/sign-in"}>
              <Button>{user ? "Go to your account" : "Sign in"}</Button>
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <div className="rise flex flex-col gap-3">
        <Status tone="verified">Confirmed</Status>
        <DisplayTitle>Email confirmed</DisplayTitle>
        <Lead>
          {user
            ? `${user.email} is confirmed, so we can help you back in if you ever lose your password.`
            : "Your address is confirmed, so we can help you back in if you ever lose your password."}
        </Lead>
      </div>

      <div className="rise" style={stagger(1)}>
        <Link href={user ? "/today" : "/sign-in"}>
          <Button>{user ? "Back to today" : "Sign in"}</Button>
        </Link>
      </div>
    </main>
  );
}
