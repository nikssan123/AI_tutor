/**
 * The handful of auth constants that both sides of the wire need.
 *
 * They live apart from `src/lib/auth.ts` because that module builds the Better
 * Auth instance — it imports the Drizzle adapter, which imports the database
 * client. A Client Component that wanted one number from it would drag all of
 * that into the browser bundle, and `@/db` would be the first thing to fail.
 */

/** Where a verification link lands once the token has been accepted. */
export const VERIFY_CALLBACK = "/verify-email";

/**
 * Better Auth's own default, stated here rather than inherited.
 *
 * Sign-up, reset, and both password forms on `/account` all have to agree with
 * the server about what is too short, and a number nobody wrote down is one
 * that drifts the first time someone reads a different changelog.
 */
export const MIN_PASSWORD_LENGTH = 8;
