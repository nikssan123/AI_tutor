import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "./sign-in-form";
import { signInWithGoogleAction } from "./actions";
import { googleEnabled } from "@/lib/auth";
import { requireGuest } from "@/lib/account/session";
import { safeDestination, withDestination } from "@/lib/account/next-url";
import { Button, DisplayTitle, Lead, stagger, Status } from "@/components/ui";
import { GoogleIcon } from "@/components/icons";
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
      {/* `sm:w-full` overrides the base rule that buttons go intrinsic on
          desktop. In a 28rem auth card a shrink-wrapped button looks stranded,
          and this one has to line up with "Sign in" below it. */}
      <Button variant="social" type="submit" className="sm:w-full">
        <GoogleIcon />
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
    <AuthFrame
      footer={
        <>
          Don&rsquo;t have an account?{" "}
          {/* Carries the destination across, because the visitor who most often
              has nowhere to sign in to is the one who arrived with a subject
              they wanted built. */}
          <Link
            href={withDestination("/sign-up", destination)}
            className="text-accent underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </>
      }
    >
      <div className="rise flex flex-col gap-2 text-center">
        <DisplayTitle>Welcome back</DisplayTitle>
        <Lead>Pick up where you left off.</Lead>
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
