import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";

/**
 * Turning what Better Auth throws into something a person can act on.
 *
 * Its own messages are short and technically accurate — "Session is not fresh",
 * "You can't unlink your last account" — which is the right register for an API
 * and the wrong one for someone who just wants to know what to do next. The
 * codes below are the ones a learner can actually hit from `/account`; anything
 * else falls back to the caller's sentence rather than leaking an internal
 * string into the UI.
 */
const KNOWN: Record<string, string> = {
  SESSION_NOT_FRESH:
    "Sign out and back in first. For safety, this change needs a recent sign-in.",
  FAILED_TO_UNLINK_LAST_ACCOUNT:
    "Set a password first. Disconnecting Google now would leave you with no way to sign in.",
  INVALID_PASSWORD: "That current password isn't right.",
  PASSWORD_TOO_SHORT: "That password is too short.",
  PASSWORD_ALREADY_SET:
    "This account already has a password — change it instead of setting a new one.",
  USER_ALREADY_EXISTS: "That address is already in use.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "That address is already in use.",
  INVALID_TOKEN: "That link is not valid. Ask for a new one.",
  TOKEN_EXPIRED: "That link has expired. Ask for a new one.",

  // The confirmation code. Better Auth's own wording — "Invalid OTP", "Too many
  // attempts" — names a mechanism the reader never asked about and does not say
  // what to do next.
  INVALID_OTP: "That code isn't right. Check it and try again.",
  OTP_EXPIRED: "That code has expired. Ask for a new one.",
  TOO_MANY_ATTEMPTS: "Too many tries with that code. Ask for a new one.",
};

/** Postgres' unique-violation SQLSTATE, which is how a taken handle arrives. */
const UNIQUE_VIOLATION = "23505";

function hasCode(value: unknown, code: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (value as { code?: unknown }).code === code
  );
}

/**
 * The handle collision does not come back as an `APIError` — it comes back as
 * whatever the driver threw, because the uniqueness rule lives in a Postgres
 * index rather than in Better Auth. Checking `cause` as well as the error
 * itself covers both the raw driver error and a wrapped one.
 */
export function isHandleTaken(error: unknown): boolean {
  return (
    hasCode(error, UNIQUE_VIOLATION) ||
    hasCode((error as { cause?: unknown } | null)?.cause, UNIQUE_VIOLATION)
  );
}

/**
 * The same translation, for a code that arrived in a query string rather than
 * in a thrown error.
 *
 * Better Auth's `/verify-email` and `/reset-password` callbacks redirect to our
 * page with `?error=TOKEN_EXPIRED` on failure, so the screen has to be able to
 * turn a bare code into a sentence with no error object in hand. Anything
 * unrecognised falls back — which also means a page can pass a sentence of its
 * own straight through.
 */
export function messageForCode(
  code: string | undefined,
  fallback: string,
): string {
  return code && code in KNOWN ? KNOWN[code]! : fallback;
}

export function explain(error: unknown, fallback: string): string {
  if (isHandleTaken(error)) return "That handle is taken. Try another.";

  if (error instanceof APIError) {
    const code = error.body?.code;
    if (typeof code === "string" && code in KNOWN) return KNOWN[code]!;

    const message = error.body?.message;
    if (typeof message === "string" && message.length > 0) return message;
  }

  return fallback;
}

/**
 * The two ways every account form ends.
 *
 * Messages travel in the query string rather than in component state, which is
 * what lets `/account` be a plain server-rendered page with no client JS: the
 * form posts, the action redirects, the page reads the sentence and renders it.
 */
export function accountOk(message: string): never {
  redirect(`/account?ok=${encodeURIComponent(message)}`);
}

export function accountError(message: string): never {
  redirect(`/account?error=${encodeURIComponent(message)}`);
}
