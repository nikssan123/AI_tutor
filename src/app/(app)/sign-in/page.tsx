import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import { DisplayTitle, Lead } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <DisplayTitle>Sign in</DisplayTitle>
        <Lead>
          Email and password only. §17.2 needs auth to exist, not to be a feature.
        </Lead>
      </div>
      <SignInForm />
    </main>
  );
}
