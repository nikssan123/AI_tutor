import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import { signInWithGoogleAction } from "./actions";
import { googleEnabled } from "@/lib/auth";
import { Button, DisplayTitle, Lead, stagger, Status } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ reset?: string; error?: string }> };

/**
 * The Google button is a Server Action form rendered here and passed *into* the
 * client form as a slot.
 *
 * It could have been a `signIn.social` call inside the client component, and
 * that is what the SDK's examples do. This way it works with no JavaScript at
 * all, which matters more on this screen than anywhere else: someone whose
 * bundle failed to load still needs a way in.
 */
function GoogleButton() {
  return (
    <form action={signInWithGoogleAction}>
      <Button variant="text" type="submit" className="px-0">
        Continue with Google
      </Button>
    </form>
  );
}

export default async function SignInPage({ searchParams }: Props) {
  const { reset, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <div className="rise flex flex-col gap-3">
        <DisplayTitle>Sign in</DisplayTitle>
        <Lead>Use your email and password, or continue with Google.</Lead>
      </div>

      {reset ? (
        <div className="rise">
          <Status tone="verified">
            Password changed. Sign in with the new one.
          </Status>
        </div>
      ) : null}

      {error ? (
        <div className="rise">
          <Status tone="problem">
            That didn&rsquo;t work with Google. Try again, or use your password.
          </Status>
        </div>
      ) : null}

      {/* SignInForm already renders a Card, so this only carries the entrance
          — wrapping it in a second surface would be a card inside a card. */}
      <div className="rise" style={stagger(1)}>
        <SignInForm google={googleEnabled() ? <GoogleButton /> : null} />
      </div>
    </main>
  );
}
