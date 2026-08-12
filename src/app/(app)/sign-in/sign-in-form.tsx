"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button, Card, Meta } from "@/components/ui";

/**
 * Deliberately one form for both sign-in and sign-up. §8 screen 3 defers signup
 * until *after* the diagnostic result — "show value first" — so this screen is
 * a utility, not a conversion surface, and does not deserve two of anything.
 */
export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(mode: "in" | "up") {
    setPending(true);
    setError(null);

    let result;
    try {
      result =
        mode === "in"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name: email });
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
      setError(result.error.message ?? "That didn't work.");
      return;
    }
    router.push("/today");
    router.refresh();
  }

  return (
    <Card className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="text-[length:var(--text-label-size)] font-[550]">Email</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-[var(--touch-min)] rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-ink"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-[length:var(--text-label-size)] font-[550]">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-[var(--touch-min)] rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-ink"
        />
      </label>

      {error ? (
        <span className="text-[length:var(--text-label-size)] text-problem">{error}</span>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button onClick={() => submit("in")} disabled={pending}>
          Sign in
        </Button>
        <Button variant="text" onClick={() => submit("up")} disabled={pending}>
          Create an account
        </Button>
      </div>
      <Meta>Sessions last 30 days.</Meta>
    </Card>
  );
}
