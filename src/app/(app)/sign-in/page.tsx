import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import { DisplayTitle, Lead, stagger } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <div className="rise flex flex-col gap-3">
        <DisplayTitle>Sign in</DisplayTitle>
        <Lead>
          Email and password only. Auth needs to exist here, not to be a feature
          — nothing about signing in should be interesting.
        </Lead>
      </div>
      {/* SignInForm already renders a Card, so this only carries the entrance
          — wrapping it in a second surface would be a card inside a card. */}
      <div className="rise" style={stagger(1)}>
        <SignInForm />
      </div>
    </main>
  );
}
