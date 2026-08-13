import { createAuthClient } from "better-auth/react";

/**
 * No `baseURL` on purpose.
 *
 * Given none, Better Auth's client falls back to the relative `/api/auth`
 * (`better-auth/dist/client/config.mjs`), which resolves against whatever
 * origin the page was served from — always the right one, on localhost, on a
 * Vercel preview, and in production.
 *
 * It used to read `NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`. Since only
 * `NEXT_PUBLIC_*` variables are inlined into the browser bundle, forgetting to
 * set that one in production shipped a sign-in form that posted credentials to
 * the visitor's own machine — a failure that cannot happen when there is no
 * variable to forget.
 */
export const authClient = createAuthClient();
