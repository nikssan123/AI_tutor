import type { Metadata } from "next";
import Link from "next/link";
import { OTP_LENGTH } from "@/lib/auth";
import { messageForCode } from "@/lib/account/errors";
import { currentUser } from "@/lib/account/session";
import {
  DEFAULT_DESTINATION,
  safeDestination,
  withDestination,
} from "@/lib/account/next-url";
import {
  Button,
  Card,
  DisplayTitle,
  Lead,
  Meta,
  stagger,
  Status,
} from "@/components/ui";
import { AuthFrame } from "@/components/app-shell";
import { sendCodeAction, verifyCodeAction } from "./actions";

/**
 * Confirming an email address — and the one screen that has to serve two
 * different arrivals.
 *
 * **From sign-up**, with a session and an unconfirmed address: the code form.
 * That is the ordinary path, and the reason a code beats a link — the person is
 * already here, on the device they signed up on, so there is nothing to hand
 * between browsers.
 *
 * **From a link**, which `changeEmail` still uses to confirm a new address:
 * Better Auth's `/api/auth/verify-email` does the work and redirects here with
 * `?error=CODE` on failure and nothing at all on success. "No query string" is
 * therefore a success case, which is worth saying because it reads like an
 * oversight and is not.
 */
export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{
    error?: string;
    sent?: string;
    confirmed?: string;
    next?: string;
  }>;
};

export default async function VerifyEmailPage({ searchParams }: Props) {
  const { error, sent, confirmed, next } = await searchParams;
  const user = await currentUser();

  // The end of the sign-up chain, and so the last place the subject someone
  // came here to have built can still be lost.
  const destination = safeDestination(next);

  /* ── The address is confirmed ──────────────────────────────────────────── */
  if (user?.emailVerified || (!user && !error)) {
    return (
      <AuthFrame>
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
          <Link
            href={
              user ? destination : withDestination("/sign-in", destination)
            }
          >
            <Button>
              {user
                ? destination === DEFAULT_DESTINATION
                  ? "Back to today"
                  : "Carry on"
                : "Sign in"}
            </Button>
          </Link>
        </div>
      </AuthFrame>
    );
  }

  /* ── Signed out, and a link brought them here ──────────────────────────── */
  if (!user) {
    return (
      <AuthFrame>
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
          <Meta>Sign in and we&rsquo;ll send you a fresh code.</Meta>
          <div>
            <Link href={withDestination("/sign-in", destination)}>
              <Button>Sign in</Button>
            </Link>
          </div>
        </Card>
      </AuthFrame>
    );
  }

  /* ── Signed in, not confirmed: the code form ───────────────────────────── */
  return (
    <AuthFrame>
      <div className="rise flex flex-col gap-3">
        <DisplayTitle>Check your email</DisplayTitle>
        <Lead>
          We sent a {OTP_LENGTH}-digit code to {user.email}. Type it in below.
        </Lead>
      </div>

      <Card className="rise" style={stagger(1)}>
        <form action={verifyCodeAction} className="flex flex-col gap-5">
          <input type="hidden" name="next" value={destination} />

          {error ? (
            <span
              role="alert"
              className="text-[length:var(--text-label-size)] text-problem"
            >
              {messageForCode(error, error)}
            </span>
          ) : null}

          {sent && !error ? <Status tone="verified">New code sent.</Status> : null}
          {confirmed && !error ? (
            /* Only reachable if the address went back to unconfirmed between
               the redirect and this render — worth handling rather than
               showing a bare form with no explanation. */
            <Status tone="attention">
              That code was used. Ask for another one.
            </Status>
          ) : null}

          <label className="flex flex-col gap-2">
            <span className="text-[length:var(--text-label-size)] font-[550]">
              Confirmation code
            </span>
            <input
              name="code"
              /*
               * `inputMode` and `autocomplete` do the real work here: on a phone
               * they raise the number pad and let the OS offer the code straight
               * from the message, which is the difference between typing six
               * digits and tapping once. `type="text"` rather than `number`,
               * because a number input strips leading zeros — and a code
               * beginning 0 is one in ten.
               */
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={OTP_LENGTH}
              placeholder="000000"
              required
              autoFocus
              className="min-h-[var(--touch-min)] w-full rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-center text-[length:var(--text-title-size)] tracking-[0.4em] text-ink focus:border-accent transition-colors duration-[var(--dur-fast)]"
            />
          </label>

          <div>
            <Button type="submit">Confirm</Button>
          </div>
        </form>

        <div className="mt-5 flex flex-col gap-3 border-t border-hairline pt-5">
          <Meta>
            Nothing arrived? Check spam — or ask for another one, which replaces
            the first.
          </Meta>
          <form action={sendCodeAction}>
            <input type="hidden" name="next" value={destination} />
            <Button variant="text" type="submit" className="px-0">
              Send a new code
            </Button>
          </form>
        </div>
      </Card>

      <div className="rise" style={stagger(2)}>
        <Link
          href="/today"
          className="text-[length:var(--text-label-size)] text-accent underline-offset-4 hover:underline"
        >
          Skip for now
        </Link>
      </div>
    </AuthFrame>
  );
}
