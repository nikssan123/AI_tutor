import type { Metadata } from "next";
import Link from "next/link";
import {
  Button,
  Card,
  DisplayTitle,
  Lead,
  Meta,
  stagger,
  Status,
} from "@/components/ui";
import { requestResetAction } from "./actions";

export const metadata: Metadata = {
  title: "Forgot your password",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ sent?: string; error?: string }> };

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const { sent, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
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
            <label className="flex flex-col gap-2">
              <span className="text-[length:var(--text-label-size)] font-[650]">
                Email
              </span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                className="min-h-[var(--touch-min)] rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-ink focus:border-accent transition-colors duration-[var(--dur-fast)]"
              />
            </label>

            <div>
              <Button type="submit">Send the link</Button>
            </div>
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
    </main>
  );
}
