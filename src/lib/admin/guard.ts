import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getAuth } from "@/lib/auth";

/** The one role that opens `/admin`. */
export const ADMIN_ROLE = "admin";

/** The role every account starts with, mirroring the column default. */
export const DEFAULT_ROLE = "user";

export interface AdminIdentity {
  userId: string;
  email: string;
  role: string;
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === ADMIN_ROLE;
}

/**
 * The authorization boundary for `/admin`. Every admin page, action and route
 * handler calls this — it is not a layout check.
 *
 * That distinction is the whole point. Next's own guidance (`node_modules/next/
 * dist/docs/01-app/02-guides/authentication.md`, "Layouts and auth checks") is
 * that a layout "does not control whether the rest of the route renders. Route
 * segments and parallel route slots are rendered by the router, so a layout
 * that hides or swaps them does not stop them from running or from appearing in
 * the RSC Payload." A guard in `admin/layout.tsx` would look like security and
 * leak the data anyway.
 *
 * Two further deliberate choices:
 *
 * - The role is read from the database rather than from `session.user.role`.
 *   The session object is a snapshot; re-reading means a revoked admin loses
 *   access on their very next request, and it keeps that true even if someone
 *   later enables `session.cookieCache` — which would otherwise serve a stale
 *   role for the life of the cookie.
 * - A non-admin gets `notFound()`, not a 403. A 403 confirms that `/admin`
 *   exists and that the account simply lacks the role, which is a free hint.
 *
 * `cache` memoizes per render pass, so a page that guards and then reads the
 * identity again does not pay for a second round trip.
 */
export const requireAdmin = cache(async (): Promise<AdminIdentity> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [row] = await getDb()
    .select({ role: schema.user.role, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .limit(1);

  // `row` is undefined when the session outlived the account it names — a
  // deleted user holding a live cookie. Treated exactly like a non-admin.
  if (!row || !isAdminRole(row.role)) notFound();

  return { userId: session.user.id, email: row.email, role: row.role };
});
