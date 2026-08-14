import type { Metadata } from "next";
import Link from "next/link";
import { googleEnabled, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { requireGuest } from "@/lib/account/session";
import { safeDestination, withDestination } from "@/lib/account/next-url";
import { signInWithGoogleAction } from "../sign-in/actions";
import {
  Button,
  Card,
  Divider,
  DisplayTitle,
  Field,
  Lead,
  stagger,
} from "@/components/ui";
import { GoogleIcon } from "@/components/icons";
import { AuthFrame } from "@/components/app-shell";
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

type Props = {
  searchParams: Promise<{ error?: string; email?: string; next?: string }>;
};

export default async function SignUpPage({ searchParams }: Props) {
  const { error, email, next } = await searchParams;
  const destination = safeDestination(next);

  // Same guard as /sign-in: a second account is not what someone already in one
  // is asking for, and the sign-up form cannot tell them so — it does not know
  // who they are.
  await requireGuest(destination);

  return (
    <AuthFrame
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={withDestination("/sign-in", destination)}
            className="text-accent underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <div className="rise flex flex-col gap-2 text-center">
        <DisplayTitle>Create an account</DisplayTitle>
        {/* Keeps saying a code is coming. Tightened, not dropped: someone who
            is not told to expect one reads the next screen as a dead end. */}
        <Lead>
          We&rsquo;ll confirm your email with a code, so we can get you back in
          if you forget your password.
        </Lead>
      </div>

      <Card className="rise flex flex-col gap-5" style={stagger(1)}>
        {/* Same order as /sign-in, and here it saves more: the Google path
            skips the confirmation code and both password fields entirely. */}
        {googleEnabled() ? (
          <>
            <form action={signInWithGoogleAction}>
              <input type="hidden" name="next" value={destination} />
              {/* Google verifies the address itself, so this path skips the
                  code entirely — there is nothing left for us to confirm. */}
              <Button variant="social" type="submit" className="sm:w-full">
                <GoogleIcon />
                Continue with Google
              </Button>
            </form>
            <Divider label="or" />
          </>
        ) : null}

        <form action={signUpAction} className="flex flex-col gap-5">
          {/* Rides along to the confirmation screen, which is where this path
              actually ends — a new account that lands on /today has still lost
              the subject the person came here to have built. */}
          <input type="hidden" name="next" value={destination} />

          {error ? (
            <span
              role="alert"
              className="text-[length:var(--text-label-size)] text-problem"
            >
              {error}
            </span>
          ) : null}

          <Field
            label="Email"
            name="email"
            type="email"
            // Kept across a failed submit — otherwise a mistyped second
            // password empties the form the person just filled in.
            defaultValue={email ?? ""}
            required
            autoComplete="email"
            placeholder="you@example.com"
          />

          <Field
            label="Password"
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            // A hint rather than a loose `Meta`: it is now announced with the
            // field instead of floating between the label and the box, where a
            // screen reader met it as an unrelated sentence.
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          />

          <Field
            label="Type it again"
            name="confirmation"
            type="password"
            required
            autoComplete="new-password"
          />

          <Button type="submit" className="sm:w-full">
            Create the account
          </Button>
        </form>
      </Card>
    </AuthFrame>
  );
}
