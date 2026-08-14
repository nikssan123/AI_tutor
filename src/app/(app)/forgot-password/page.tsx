import type { Metadata } from "next";
import Link from "next/link";
import {
  Button,
  Card,
  DisplayTitle,
  Field,
  Lead,
  Meta,
  stagger,
  Status,
} from "@/components/ui";
import { AuthFrame } from "@/components/app-shell";
import { currentSession } from "@/lib/account/session";
import { requestResetAction } from "./actions";

export const metadata: Metadata = {
  title: "Forgot your password",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ sent?: string; error?: string }> };

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const { sent, error } = await searchParams;

  // No guest guard on this screen, so the nav may already be showing the
  // wordmark. Memoised — the layout above has made this same call already.
  const signedIn = (await currentSession()) !== null;

  return (
    <AuthFrame brand={!signedIn}>
      <div className="rise flex flex-col gap-3">
        <DisplayTitle>Forgot your password</DisplayTitle>
        <Lead>
          Tell us the address you signed up with and we&rsquo;ll send a link to
          set a new one.
        </Lead>
      </div>

      {sent ? (
        /*
         * Deliberately the same message whether or not that address has an
         * account. Confirming which addresses are registered would make this
         * form a lookup service for anyone who wanted one.
         */
        <Card className="rise flex flex-col gap-3" style={stagger(1)}>
          <Status tone="verified">Check your email</Status>
          <Meta>
            If that address has an account, a reset link is on its way. It works
            for one hour, and only once.
          </Meta>
          <Meta>
            Nothing arrived? Check your spam folder, then try again. We show
            this same message even when an address has no account.
          </Meta>
        </Card>
      ) : (
        <Card className="rise flex flex-col gap-5" style={stagger(1)}>
          {error ? (
            <Status tone="problem">That doesn&rsquo;t look like an email address.</Status>
          ) : null}

          <form action={requestResetAction} className="flex flex-col gap-5">
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
            />

            <Button type="submit" className="sm:w-full">
              Send the link
            </Button>
          </form>
        </Card>
      )}

      <div className="rise" style={stagger(2)}>
        <Link
          href="/sign-in"
          className="text-[length:var(--text-label-size)] text-accent underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </AuthFrame>
  );
}
