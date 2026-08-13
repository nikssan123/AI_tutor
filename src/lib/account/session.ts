import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
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
