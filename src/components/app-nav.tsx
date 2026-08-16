"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AccountIcon,
  MasteryIcon,
  PathIcon,
  ProgressIcon,
  TodayIcon,
} from "@/components/icons";
import { Wordmark } from "@/components/logo";
import { cx } from "@/components/ui";

/**
 * §8.5.5 — "Mobile nav: bottom bar. Desktop nav: the same destinations in a
 * quiet left rail, icon + label, flat, no nesting."
 *
 * Until now the authenticated surface had neither. It had a row of four
 * same-weight text links in a header, with no icons and — the part that
 * actually hurt — no active state, so the chrome never told you where you
 * were. That is the shape of a scaffold, not of a product.
 *
 * This is the one client component in the app chrome, and it is client for
 * exactly one reason: `usePathname`. Reading the current URL on the server "is
 * not supported. This design is intentional" — and a Client Component is the
 * documented answer for an active nav link
 * (`next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md`,
 * "Active Nav Links"). The cost is bounded: the rail re-renders on navigation
 * without being re-fetched, and §8.5.8's zero-JS cap is a rule about the
 * *marketing* routes, which never render this.
 *
 * Sign-out is deliberately *not* here. A responsive shell draws two bars and
 * hides one, so anything in both is in the DOM twice — two buttons with the
 * same accessible name, which is a real defect and not merely an untidy test.
 * It lives on `/account` instead, which is what "You" in this nav points at,
 * and which is where a rare, destructive-ish action belongs anyway.
 */

/**
 * Five, not §8.5.5's three. The count itself was never the rule — §8.5.2 bans
 * "the exactly-four-item bottom tab bar" as an iOS tic, which is an argument
 * against copying a number rather than for one. The rule that does bind is one
 * flat level with a word on every destination, and this keeps it.
 *
 * **Path is the one §8.5.5 actually named, and it was the one that was missing.**
 * The rail shipped Today, Calendar, Mastery, Progress and You — two of the
 * spec's three, plus *three* reporting surfaces, and no slot at all for the
 * thing being reported on. The most expensive artefact the product makes had
 * one inbound link in the entire application, from `/calendar`'s empty state,
 * and a learner who never hit that state never saw their own course.
 *
 * The room for it came from `/calendar`, which was never a destination's worth
 * of screen on its own: it opened with a `Figure` about the same commitment
 * `/progress` opens with, and closed with the same work priced at the same two
 * paces. It is bands three to five of `/progress` now.
 *
 * It sits second because it is the only destination that answers "what am I
 * taking" rather than "how is it going", and that question comes first.
 *
 * The screen answers to `/path` directly. It used to live at `/goals/{id}/path`,
 * which is what made this destination impossible to draw — the rail is a Client
 * Component and has no session to resolve an id from. One active course at a
 * time is a transactional invariant (`pauseOthers`), so the id in that URL only
 * ever had one value and the screen never needed it.
 */
const DESTINATIONS: ReadonlyArray<{
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { href: "/today", label: "Today", Icon: TodayIcon },
  { href: "/path", label: "Path", Icon: PathIcon },
  { href: "/mastery", label: "Mastery", Icon: MasteryIcon },
  { href: "/progress", label: "Progress", Icon: ProgressIcon },
  { href: "/account", label: "You", Icon: AccountIcon },
];

/**
 * `/mastery` is current on `/mastery?show=left`, and `/account` on any screen
 * below it. Prefix-matched on a path boundary so `/today` cannot light up for
 * a future `/today-something`.
 */
export function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <Link href="/today">
      <Wordmark />
    </Link>
  );
}

export function AppNav() {
  const pathname = usePathname();

  return (
    <>
      {/* ── Mobile: a slim top bar for identity ──────────────────────────── */}
      <header className="flex items-center gap-4 border-b border-hairline px-6 py-4 lg:hidden">
        <Brand />
      </header>

      {/* ── Desktop: the quiet left rail ─────────────────────────────────── */}
      <nav
        aria-label="Main"
        className={cx(
          "hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-56 lg:shrink-0",
          "lg:flex-col lg:gap-8 lg:border-r lg:border-hairline lg:px-4 lg:py-6",
        )}
      >
        <div className="px-3">
          <Brand />
        </div>

        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {DESTINATIONS.map(({ href, label, Icon }) => {
            const current = isCurrent(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cx(
                    "flex min-h-[var(--touch-min)] items-center gap-3 rounded-[var(--radius-control)] px-3",
                    "text-[length:var(--text-label-size)]",
                    "transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                    current
                      ? "bg-accent-weak font-[650] text-accent"
                      : "font-[550] text-ink-muted hover:bg-surface hover:text-ink",
                  )}
                >
                  <Icon />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Mobile: the bottom bar ───────────────────────────────────────── */}
      <nav
        aria-label="Main"
        className={cx(
          "fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface lg:hidden",
          // Clears the home indicator on a notched phone.
          "pb-[env(safe-area-inset-bottom)]",
        )}
      >
        <ul className="m-0 flex list-none items-stretch justify-around gap-1 p-0">
          {DESTINATIONS.map(({ href, label, Icon }) => {
            const current = isCurrent(pathname, href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cx(
                    "flex min-h-[var(--touch-min)] flex-col items-center justify-center gap-1 py-2",
                    "text-[length:var(--text-meta-size)]",
                    "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                    current ? "font-[650] text-accent" : "text-ink-muted",
                  )}
                >
                  <Icon />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
