import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import { signInWithGoogleAction } from "./actions";
import { googleEnabled } from "@/lib/auth";
import { requireGuest } from "@/lib/account/session";
import { safeDestination } from "@/lib/account/next-url";
import { Button, DisplayTitle, Lead, stagger, Status } from "@/components/ui";
import { AuthFrame } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ reset?: string; error?: string; next?: string }>;
};

/**
 * The Google button is a Server Action form rendered here and passed *into* the
 * client form as a slot.
 *
 * It could have been a `signIn.social` call inside the client component, and
 * that is what the SDK's examples do. This way it works with no JavaScript at
 * all, which matters more on this screen than anywhere else: someone whose
 * bundle failed to load still needs a way in.
 */
function GoogleButton({ destination }: { destination: string }) {
  return (
    <form action={signInWithGoogleAction}>
      {/* Google's callback is decided before the round trip, so where they
          were going has to travel with the request rather than be read back
          off a URL that no longer exists by the time we return. */}
      <input type="hidden" name="next" value={destination} />
      <Button variant="text" type="submit" className="px-0">
        Continue with Google
      </Button>
    </form>
  );
}

export default async function SignInPage({ searchParams }: Props) {
  const { reset, error, next } = await searchParams;

  // Sanitised once, here, so neither the client form nor the Google action has
  // to be trusted to do it — and so a hostile `?next=` is already gone by the
  // time anything renders it into a link.
  const destination = safeDestination(next);

  // Nobody signed in has any business on this screen. The guard is in the page
  // rather than the layout because a layout cannot stop the page below it from
  // rendering, and it runs before anything else here so the form is never built
  // for someone who will not see it.
  await requireGuest(destination);

  return (
    <AuthFrame>
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
        <SignInForm
          destination={destination}
          google={
            googleEnabled() ? <GoogleButton destination={destination} /> : null
          }
        />
      </div>
    </AuthFrame>
  );
}
