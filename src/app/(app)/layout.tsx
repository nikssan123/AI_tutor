import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/account/session";
import { AppNav } from "@/components/app-nav";

/**
 * §13.1 — the authenticated segment.
 *
 * `noindex` is set at the *layout* level rather than per page, which is what
 * makes §13.3's guarantee structural: no authenticated route can leak into the
 * index by accident, including ones nobody remembers to annotate.
 *
 * The header below is chrome, not a boundary. It reads the session to decide
 * what to draw — signed out, on `/sign-in` or `/reset-password`, it draws
 * nothing — but every page underneath still calls `requireUser()` itself. A
 * layout cannot guard a route: it "does not control whether the rest of the
 * route renders" (`next/dist/docs/01-app/02-guides/authentication.md`), so a
 * check here would look like security while the page below it still ran.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Dynamic by construction — nothing under (app) is ever statically cached. */
export const dynamic = "force-dynamic";

function UnverifiedBanner() {
  return (
    <div className="border-b border-hairline bg-accent-weak">
      <p className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 px-6 py-3 text-[length:var(--text-label-size)] text-ink-muted">
        {/* One state, one action (§8.5.5). The banner's job is to say the
            account is unconfirmed; /account is where the consequences and
            the resend live, so the sentence does not carry them here. */}
        <span>Your email address isn&rsquo;t confirmed.</span>
        <Link
          href="/account"
          className="font-[550] text-accent underline-offset-4 hover:underline"
        >
          Confirm it
        </Link>
      </p>
    </div>
  );
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();

  // Signed out, or on a screen that has no session to navigate from — the page
  // below still guards itself. Nothing to draw around it.
  if (!user) return <div className="min-h-screen bg-ground text-ink">{children}</div>;

  return (
    <div className="min-h-screen bg-ground text-ink lg:flex lg:items-start">
      <AppNav />
      {/* `min-w-0` so a wide child — the path graph's horizontal scroller —
          shrinks inside the flex row instead of stretching it and pushing the
          rail off the left of the viewport. */}
      <div className="min-w-0 flex-1">
        {user.emailVerified ? null : <UnverifiedBanner />}
        {children}
      </div>
    </div>
  );
}
