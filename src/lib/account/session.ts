import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { safeDestination } from "@/lib/account/next-url";
import { DEFAULT_ROLE } from "@/lib/admin/guard";

/**
 * The Data Access Layer for the signed-in learner.
 *
 * Next's own guidance (`node_modules/next/dist/docs/01-app/02-guides/
 * authentication.md`, "Creating a Data Access Layer") is to centralise the
 * session check in one memoized function and call it from every page, action
 * and route handler — rather than in a layout, which "does not control whether
 * the rest of the route renders". `src/lib/admin/guard.ts` already does this
 * for `/admin`; this is the same shape for the ordinary account.
 *
 * Before this existed, every `(app)` page repeated the same four lines of
 * `getSession`-then-`redirect`. The repetition was not the problem — the
 * problem is that a new page can forget them and nothing fails.
 */

/** What a screen is allowed to know about the person looking at it. */
export interface AccountUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  handle: string | null;
  locale: string;
  timezone: string;
  plan: string;
  role: string;
}

type Session = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>
>;

/**
 * `cache` memoizes per render pass, so a page that guards and then reads the
 * user again does not pay for a second session lookup — and neither does the
 * layout that renders the header above it.
 */
export const currentSession = cache(
  async (): Promise<Session | null> =>
    getAuth().api.getSession({ headers: await headers() }),
);

/**
 * A Data Transfer Object, not the session's user.
 *
 * The same guide's "Using Data Transfer Objects" section: return the fields the
 * screen needs rather than the whole record. `session.user` is a live Better
 * Auth object that gains fields as plugins arrive, and handing it to a Client
 * Component means whatever it gains next is serialised into the page.
 */
export function toAccountUser(user: Session["user"]): AccountUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    handle: user.handle ?? null,
    /*
     * The `??` fallbacks are not defensive padding: Better Auth types every
     * `required: false` additional field as possibly-undefined, while the
     * columns behind them are `NOT NULL DEFAULT`. The values below repeat those
     * column defaults so the two cannot disagree — a session that somehow
     * arrives without a timezone plans someone's day in the wrong one, which is
     * a wrong answer rather than a missing one.
     */
    locale: user.locale ?? "en",
    timezone: user.timezone ?? "UTC",
    plan: user.plan ?? "free",
    role: user.role ?? DEFAULT_ROLE,
  };
}

/** The signed-in learner, or `null`. For chrome that renders either way. */
export async function currentUser(): Promise<AccountUser | null> {
  const session = await currentSession();
  return session ? toAccountUser(session.user) : null;
}

/** The signed-in learner, or a redirect to sign in. For pages and actions. */
export async function requireUser(): Promise<AccountUser> {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  return toAccountUser(session.user);
}

/**
 * The mirror of `requireUser`, for the screens that only mean anything signed
 * out: sign in, and create an account.
 *
 * The marketing header is static — it has to be, for §13.3's rendering
 * guarantee — so it says "Sign in" to everyone, signed in or not. Following it
 * used to hand a signed-in learner a form asking them to do something they had
 * already done, with no hint of which account they were in. This turns that
 * click into what the person actually meant by it: take me into the app.
 *
 * `next` is honoured rather than ignored, so the offer someone was carrying
 * survives being already signed in — a learner who takes `/learn`'s "we'll
 * build it" offer lands on `/start`, not on `/today` having lost the subject.
 * It is sanitised here as well as at the screen, because a redirect built from
 * an unchecked parameter is an open redirect no matter who else checked it.
 *
 * Deliberately *not* on `/forgot-password` or `/reset-password`: having a
 * session on this device and having forgotten the password are not exclusive,
 * and `/account` can only change a password for someone who can type the
 * current one. Guarding those would strand exactly the person who needs them.
 */
export async function requireGuest(next?: string | null): Promise<void> {
  const session = await currentSession();
  if (session) redirect(safeDestination(next));
}
