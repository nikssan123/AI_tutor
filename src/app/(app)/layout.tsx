import type { Metadata } from "next";
import Link from "next/link";
import { currentUser, type AccountUser } from "@/lib/account/session";
import { signOutAction } from "./account/actions";

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

const NAV = [
  { href: "/today", label: "Today" },
  { href: "/account", label: "Account" },
];

function AppNav({ user }: { user: AccountUser }) {
  return (
    <header className="border-b border-hairline">
      <nav className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4">
        <Link
          href="/today"
          className="text-[length:var(--text-label-size)] font-[650] text-ink"
        >
          online_uni
        </Link>

        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-[length:var(--text-label-size)] text-ink-muted transition-colors duration-[var(--dur-fast)] hover:text-ink"
          >
            {item.label}
          </Link>
        ))}

        {/*
         * A form, not a link: signing out is a state change, and a GET that
         * ends a session is one prefetch away from ending it by accident.
         * As a Server Action it also needs no client JavaScript — which is
         * the whole reason there was no sign-out button here before.
         */}
        <form action={signOutAction} className="ml-auto">
          <button
            type="submit"
            className="text-[length:var(--text-label-size)] text-ink-muted transition-colors duration-[var(--dur-fast)] hover:text-ink"
          >
            Sign out
          </button>
        </form>
      </nav>

      {user.emailVerified ? null : (
        <div className="border-t border-hairline bg-accent-weak">
          <p className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-2 gap-y-1 px-6 py-3 text-[length:var(--text-label-size)] text-ink-muted">
            {/* One sentence, one action (§8.5.5) — and the sentence says what
                is actually at stake, not "please verify your email". */}
            <span>
              Your email isn&rsquo;t confirmed yet, so we can&rsquo;t send you a
              password reset if you need one.
            </span>
            <Link
              href="/account"
              className="font-[550] text-accent underline-offset-4 hover:underline"
            >
              Confirm it
            </Link>
          </p>
        </div>
      )}
    </header>
  );
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();

  return (
    <div className="min-h-screen bg-ground text-ink">
      {user ? <AppNav user={user} /> : null}
      {children}
    </div>
  );
}
