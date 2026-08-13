/**
 * Where to send someone once they are signed in.
 *
 * `/learn` offers to build a subject nothing covers, and that offer points at
 * `/start?topic=…`. A signed-out visitor taking it used to land on the sign-in
 * form with their subject dropped — asked what they wanted to learn, told we
 * would build it, and then asked again. This carries the destination across
 * the sign-in screens so the answer survives.
 *
 * Everything here exists to stop that being an open redirect. A `?next=` a
 * visitor can set is a `?next=` an attacker can set, and "sign in and we will
 * send you wherever this parameter says" is the classic phishing hand-off: a
 * real sign-in page on the real domain, then a fake one on theirs. So the
 * value is a path we will visit, never a URL — checked here, once, rather than
 * trusted at each of the screens that pass it along.
 */

/** Where sign-in goes when nothing asked for anywhere else. */
export const DEFAULT_DESTINATION = "/today";

/**
 * Long enough for `/start?topic=` plus a subject a person would actually type
 * (the intake caps a reply at 500 characters), short enough that the parameter
 * cannot be used to stuff a URL.
 */
const MAX_LENGTH = 600;

/** CR, LF and friends in a `Location` header are header injection. */
function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

/**
 * The destination `value` asks for, or `/today` if it is asking for anything
 * we are not willing to send someone to.
 *
 * Rejected, and why each one matters:
 *
 * - anything not starting with `/` — `https://evil.example` and `evil.example`
 *   are both off-site, and the second one relies on being read as a hostname.
 * - `//evil.example` — protocol-relative, so it *looks* like a path and is a
 *   different origin. This is the one that gets missed.
 * - `/\evil.example` — browsers normalise the backslash to a slash, so this is
 *   `//evil.example` wearing a hat.
 */
export function safeDestination(value: string | undefined | null): string {
  if (!value) return DEFAULT_DESTINATION;
  if (value.length > MAX_LENGTH) return DEFAULT_DESTINATION;
  if (!value.startsWith("/")) return DEFAULT_DESTINATION;
  if (hasControlCharacter(value)) return DEFAULT_DESTINATION;

  const second = value[1];
  if (second === "/" || second === "\\") return DEFAULT_DESTINATION;

  return value;
}

/**
 * Adds `?next=` to one of the auth screens, and leaves it off when the
 * destination is the default — a URL that says `?next=/today` is noise in the
 * address bar and one more thing to get wrong.
 */
export function withDestination(path: string, destination: string): string {
  const next = safeDestination(destination);
  if (next === DEFAULT_DESTINATION) return path;

  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}next=${encodeURIComponent(next)}`;
}
