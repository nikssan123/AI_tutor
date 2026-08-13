"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { VERIFY_CALLBACK } from "@/lib/auth-shared";
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
 * Deliberately one form for both sign-in and sign-up. §8 screen 3 defers signup
 * until *after* the diagnostic result — "show value first" — so this screen is
 * a utility, not a conversion surface, and does not deserve two of anything.
 *
 * `google` is a slot rather than a button this component renders: it arrives
 * from the page as a Server Action form, so the Google path keeps working even
 * where this component's own JavaScript does not.
 */
export function SignInForm({ google }: { google?: React.ReactNode }) {
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

    // Which button was pressed. Enter in a text field submits with no submitter
    // at all, and the sensible default for that is signing in.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const mode: "in" | "up" =
      submitter instanceof HTMLButtonElement && submitter.value === "up"
        ? "up"
        : "in";

    setPending(true);
    setError(null);

    let result;
    try {
      result =
        mode === "in"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({
              email,
              password,
              name: email,
              // Where the confirmation link lands. Without it Better Auth sends
              // people to "/", which is the marketing page — a strange place to
              // arrive from an email that said "confirm your address".
              callbackURL: VERIFY_CALLBACK,
            });
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
    router.push("/today");
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* `value` is how the handler tells the two apart; Enter with no
              submitter falls through to signing in. */}
          <Button type="submit" name="mode" value="in" disabled={pending}>
            Sign in
          </Button>
          <Button
            type="submit"
            name="mode"
            value="up"
            variant="text"
            disabled={pending}
          >
            Create an account
          </Button>
        </div>
      </form>

      {/* Below the form and outside it — neither of these submits it. */}
      <div className="mt-5 flex flex-col gap-3 border-t border-hairline pt-5">
        {google}
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
