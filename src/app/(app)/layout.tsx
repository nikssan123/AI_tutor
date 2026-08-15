import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { currentUser } from "@/lib/account/session";
import { VERIFY_SNOOZE_COOKIE } from "@/lib/account/verify-banner";
import { AppNav } from "@/components/app-nav";
import { CloseIcon } from "@/components/icons";
import { snoozeVerifyBannerAction } from "./actions";

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
      <div className="mx-auto flex max-w-5xl items-center gap-x-4 px-6 py-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--text-label-size)] text-ink-muted">
          {/* One state, one action (§8.5.5). The banner's job is to say the
              account is unconfirmed; /account is where the consequences and
              the resend live, so the sentence does not carry them here.

              The link carries a fragment *and* a flag: the fragment scrolls the
              Email card into view, and `confirm=1` is what rings it once you
              are there. Without the flag, following this from /account itself
              — where the banner is also drawn — did visibly nothing, which is
              the worst outcome for the one control we ask people to find. */}
          <span>Your email address isn&rsquo;t confirmed.</span>
          <Link
            href="/account?confirm=1#email"
            className="font-[550] text-accent underline-offset-4 hover:underline"
          >
            Confirm it
          </Link>
        </p>

        {/*
         * And a way out of it. A banner on every screen with no close is a
         * banner people stop seeing, so this puts it away for a week
         * (`verify-banner.ts`) rather than forever.
         *
         * A form, because the click writes a cookie and this segment ships no
         * client JavaScript. `ml-auto` rather than `justify-between` on the
         * row: the sentence keeps its natural width and the × sits at the far
         * edge whatever the sentence wraps to.
         */}
        <form action={snoozeVerifyBannerAction} className="ml-auto shrink-0">
          <button
            type="submit"
            // The 44px touch target §8.5.4 asks for, which is also what sets
            // the banner's height — hence `py-1` on the row above. The hover
            // fill is `surface` rather than the usual `accent-weak`, which is
            // what this band is already painted in.
            className="inline-flex size-[var(--touch-min)] items-center justify-center rounded-[var(--radius-pill)] text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-surface hover:text-ink"
          >
            <CloseIcon className="size-4" />
            {/* The icon is decorative; the button still has to say what it
                does, and "Dismiss" would promise more than a week. */}
            <span className="sr-only">Hide this for a week</span>
          </button>
        </form>
      </div>
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

  // The jar is only opened for an account that would see the banner: a
  // confirmed one never reads a cookie it cannot act on.
  const nudge =
    !user.emailVerified && !(await cookies()).has(VERIFY_SNOOZE_COOKIE);

  return (
    <div className="min-h-screen bg-ground text-ink lg:flex lg:items-start">
      <AppNav />
      {/* `min-w-0` so a wide child — the path graph's horizontal scroller —
          shrinks inside the flex row instead of stretching it and pushing the
          rail off the left of the viewport. */}
      <div className="min-w-0 flex-1">
        {nudge ? <UnverifiedBanner /> : null}
        {children}
      </div>
    </div>
  );
}
