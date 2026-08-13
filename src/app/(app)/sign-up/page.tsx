import type { Metadata } from "next";
import Link from "next/link";
import { googleEnabled, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { signInWithGoogleAction } from "../sign-in/actions";
import {
  Button,
  Card,
  DisplayTitle,
  Lead,
  Meta,
  stagger,
} from "@/components/ui";
import { signUpAction } from "./actions";

/**
 * §8 screen 3 — creating the account, on its own screen.
 *
 * It used to be a second button on the sign-in form. One form doing two things
 * is fine while both things need the same two fields; the moment sign-up needs
 * a confirmation field and sign-in does not, the shared form has to either grow
 * a field that is wrong half the time or hide one conditionally. Two screens is
 * the cheaper answer, and it gives each one an address people can be sent to.
 */
export const metadata: Metadata = {
  title: "Create an account",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string; email?: string }> };

const input =
  "min-h-[var(--touch-min)] w-full rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-ink focus:border-accent transition-colors duration-[var(--dur-fast)]";

const label = "text-[length:var(--text-label-size)] font-[550]";

export default async function SignUpPage({ searchParams }: Props) {
  const { error, email } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <div className="rise flex flex-col gap-3">
        <DisplayTitle>Create an account</DisplayTitle>
        <Lead>
          Then confirm your email with a code, so we can get you back in if you
          forget your password.
        </Lead>
      </div>

      <Card className="rise" style={stagger(1)}>
        <form action={signUpAction} className="flex flex-col gap-5">
          {error ? (
            <span
              role="alert"
              className="text-[length:var(--text-label-size)] text-problem"
            >
              {error}
            </span>
          ) : null}

          <label className="flex flex-col gap-2">
            <span className={label}>Email</span>
            <input
              name="email"
              type="email"
              // Kept across a failed submit — otherwise a mistyped second
              // password empties the form the person just filled in.
              defaultValue={email ?? ""}
              required
              autoComplete="email"
              className={input}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className={label}>Password</span>
            <Meta>At least {MIN_PASSWORD_LENGTH} characters.</Meta>
            <input
              name="password"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className={input}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className={label}>Type it again</span>
            <input
              name="confirmation"
              type="password"
              required
              autoComplete="new-password"
              className={input}
            />
          </label>

          <div>
            <Button type="submit">Create the account</Button>
          </div>
        </form>

        <div className="mt-5 flex flex-col gap-3 border-t border-hairline pt-5">
          {googleEnabled() ? (
            <form action={signInWithGoogleAction}>
              {/* Google verifies the address itself, so this path skips the
                  code entirely — there is nothing left for us to confirm. */}
              <Button variant="text" type="submit" className="px-0">
                Continue with Google
              </Button>
            </form>
          ) : null}

          <Link
            href="/sign-in"
            className="text-[length:var(--text-label-size)] text-accent underline-offset-4 hover:underline"
          >
            Already have an account? Sign in
          </Link>
        </div>
      </Card>
    </main>
  );
}
