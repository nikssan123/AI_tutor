import type { Metadata } from "next";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { messageForCode } from "@/lib/account/errors";
import {
  Button,
  ButtonLink,
  Card,
  DisplayTitle,
  Field,
  Lead,
  stagger,
  Status,
} from "@/components/ui";
import { AuthFrame } from "@/components/app-shell";
import { currentSession } from "@/lib/account/session";
import { resetPasswordAction } from "./actions";

export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ token?: string; error?: string }> };

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token, error } = await searchParams;

  /*
   * Two different senders write this `error`. Better Auth's own callback
   * redirects here with a bare code (`INVALID_TOKEN`, `TOKEN_EXPIRED`) when the
   * link itself is bad; `resetPasswordAction` redirects here with a finished
   * sentence. `messageForCode` maps the first and passes the second through.
   */
  const message = error ? messageForCode(error, error) : null;

  // No guest guard here either: a reset link can be opened in a browser that
  // is still signed in, and the nav would already be showing the wordmark.
  const signedIn = (await currentSession()) !== null;

  // No token means the link was truncated, hand-typed, or already spent. There
  // is nothing to submit, so the page offers the only thing that can help.
  if (!token) {
    return (
      <AuthFrame brand={!signedIn}>
        <div className="rise flex flex-col gap-3">
          <DisplayTitle>That link didn&rsquo;t work</DisplayTitle>
          <Lead>
            {message ??
              "Reset links expire after an hour and can only be used once."}
          </Lead>
        </div>
        <div className="rise" style={stagger(1)}>
          <ButtonLink href="/forgot-password">Send a new link</ButtonLink>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame brand={!signedIn}>
      <div className="rise flex flex-col gap-3">
        <DisplayTitle>Set a new password</DisplayTitle>
        <Lead>
          This signs out every device that is signed in to this account,
          including anyone else who has your password.
        </Lead>
      </div>

      <Card className="rise flex flex-col gap-5" style={stagger(1)}>
        {message ? <Status tone="problem">{message}</Status> : null}

        <form action={resetPasswordAction} className="flex flex-col gap-5">
          <input type="hidden" name="token" value={token} />

          <Field
            label="New password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          />

          <Field
            label="Type it again"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
          />

          <Button type="submit" className="sm:w-full">
            Set the password
          </Button>
        </form>
      </Card>
    </AuthFrame>
  );
}
