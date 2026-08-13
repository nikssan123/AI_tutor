"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { DEFAULT_DESTINATION, withDestination } from "@/lib/account/next-url";
import { Button, Card } from "@/components/ui";

/**
 * Better Auth reports a malformed body as a Zod dump —
 * `[body.email] Invalid email address; [body.password] Too small: expected
 * string to have >=1 characters`. That is a debugging aid, not a sentence, and
 * it must never reach a learner. Everything else the server sends is already
 * written for a person ("Invalid email or password", "Password too short"), so
 * it is passed through rather than second-guessed here.
 */
export function humanError(error: { message?: string; code?: string }): string {
  const raw = error.message ?? "";
  if (error.code === "VALIDATION_ERROR" || raw.startsWith("[body.")) {
    return "Enter an email address and a password.";
  }
  return raw || "That didn't work.";
}

/**
 * Signing in, and only that. Creating an account is `/sign-up`.
 *
 * This form used to do both, told apart by which button submitted it. That
 * worked while both actions needed the same two fields — and stopped working
 * the moment sign-up needed a confirmation field, which sign-in must not have.
 * A shared form would have to grow a field that is wrong half the time.
 *
 * `google` is a slot rather than a button this component renders: it arrives
 * from the page as a Server Action form, so the Google path keeps working even
 * where this component's own JavaScript does not.
 */
export function SignInForm({
  google,
  /**
   * Where to land once they are in. Already sanitised by the page — this
   * component never sees a raw `?next=`.
   */
  destination = DEFAULT_DESTINATION,
}: {
  google?: React.ReactNode;
  destination?: string;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    // Read from the DOM, not from React state. Anything typed before this
    // component hydrated lives in the input and never reached a `useState`
    // setter — with controlled inputs that text is silently dropped on the
    // first render and the request goes out empty, which is precisely the
    // "[body.email] Invalid email address" the server then complains about.
    // Both inputs are rendered unconditionally and are never disabled, so
    // FormData always carries them — an empty string when untouched, never
    // null. `required` stops the empty case reaching here at all.
    const data = new FormData(form);
    const email = String(data.get("email"));
    const password = String(data.get("password"));

    setPending(true);
    setError(null);

    let result;
    try {
      result = await authClient.signIn.email({ email, password });
    } catch {
      // A rejected promise (offline, DNS failure, 500) would otherwise leave
      // `pending` true forever: the button stays disabled and the learner is
      // given no reason why.
      setPending(false);
      setError("We couldn't reach the server. Check your connection and try again.");
      return;
    }

    setPending(false);

    if (result.error) {
      setError(humanError(result.error));
      return;
    }
    router.push(destination);
    router.refresh();
  }

  return (
    <Card>
      {/*
       * A real <form>, which a stack of buttons in a <div> was not. Without it
       * pressing Enter in either field does nothing at all — the most common
       * way anyone submits a two-field login — and `required` has nothing to
       * act on, so an empty submit travels to the server to be rejected there.
       */}
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <label className="flex flex-col gap-2">
          <span className="text-[length:var(--text-label-size)] font-[550]">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="min-h-[var(--touch-min)] rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-ink"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-[length:var(--text-label-size)] font-[550]">Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="min-h-[var(--touch-min)] rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-ink"
          />
        </label>

        {error ? (
          <span role="alert" className="text-[length:var(--text-label-size)] text-problem">
            {error}
          </span>
        ) : null}

        <div>
          <Button type="submit" disabled={pending}>
            Sign in
          </Button>
        </div>
      </form>

      {/* Below the form and outside it — none of these submits it. Creating an
          account is a link now, not a second submit button: it goes to a screen
          with its own fields rather than reusing these two. */}
      <div className="mt-5 flex flex-col gap-3 border-t border-hairline pt-5">
        {google}
        {/* Carries the destination across, because the visitor who most often
            has nowhere to sign in to is the one who arrived with a subject
            they wanted built. */}
        <Link
          href={withDestination("/sign-up", destination)}
          className="text-[length:var(--text-label-size)] text-accent underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
        <Link
          href="/forgot-password"
          className="text-[length:var(--text-label-size)] text-accent underline-offset-4 hover:underline"
        >
          Forgot your password?
        </Link>
      </div>
    </Card>
  );
}
