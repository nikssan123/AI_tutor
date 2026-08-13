/**
 * Parsing and validating the profile form, away from the action that runs it.
 *
 * Same shape as `parseGoalForm` (§24 E3): a result, never a throw. Every one of
 * these failures is a person mistyping into a form, and a form that 500s on a
 * bad timezone is worse than one that says what it wanted.
 */

export const MAX_NAME_LENGTH = 80;
export const MIN_HANDLE_LENGTH = 3;
export const MAX_HANDLE_LENGTH = 30;

export interface ProfileUpdate {
  name: string;
  handle: string | null;
  locale: string;
  timezone: string;
}

export type ProfileFormResult =
  | { ok: true; update: ProfileUpdate }
  | { ok: false; error: string };

export type HandleResult =
  | { ok: true; handle: string | null }
  | { ok: false; error: string };

/**
 * The handle is the one profile field that is not private: it appears in the
 * public Proof Page URL `/p/{handle}/{slug}` (§8, screen 12).
 *
 * So it is lower-cased rather than merely checked. The unique index in
 * `src/db/schema/auth.ts` is case-sensitive, which without this would let
 * `Nikolay` and `nikolay` both exist — two URLs a reader cannot tell apart, and
 * the cheapest impersonation there is.
 */
export function normaliseHandle(raw: string): HandleResult {
  const handle = raw.trim().toLowerCase();

  // Empty means "no handle", not "invalid handle". Clearing it has to stay
  // possible: it is published, and the answer to publishing something you
  // regret cannot be "contact support".
  if (handle.length === 0) return { ok: true, handle: null };

  if (handle.length < MIN_HANDLE_LENGTH || handle.length > MAX_HANDLE_LENGTH) {
    return {
      ok: false,
      error: `A handle is between ${MIN_HANDLE_LENGTH} and ${MAX_HANDLE_LENGTH} characters.`,
    };
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) {
    return {
      ok: false,
      error:
        "A handle can use letters, numbers and single hyphens between them — nothing else.",
    };
  }

  return { ok: true, handle };
}

/**
 * Checked against the platform's own tz database rather than a list we
 * maintain. A wrong timezone is not cosmetic: it decides which calendar day a
 * session is planned for, so "Europe/Sofa" has to fail here rather than quietly
 * plan someone's day in UTC.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Language, or language-region. Enough to pick copy and format a date. */
export function isValidLocale(locale: string): boolean {
  return /^[a-z]{2}(-[A-Z]{2})?$/.test(locale);
}

export function parseProfileForm(form: FormData): ProfileFormResult {
  const name = String(form.get("name") ?? "").trim();
  if (name.length === 0) {
    return { ok: false, error: "Your name can't be empty." };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Keep your name under ${MAX_NAME_LENGTH} characters.`,
    };
  }

  const handle = normaliseHandle(String(form.get("handle") ?? ""));
  if (!handle.ok) return handle;

  const locale = String(form.get("locale") ?? "").trim();
  if (!isValidLocale(locale)) {
    return { ok: false, error: "That doesn't look like a language code." };
  }

  const timezone = String(form.get("timezone") ?? "").trim();
  if (!isValidTimezone(timezone)) {
    return { ok: false, error: "We don't recognise that timezone." };
  }

  return {
    ok: true,
    update: { name, handle: handle.handle, locale, timezone },
  };
}
