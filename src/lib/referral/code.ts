/**
 * Referral codes — PLAN-MONETIZATION §9.
 *
 * A code is something a person reads off a screenshot and types into a phone,
 * so the alphabet matters more than the entropy. Lowercase only, and without
 * the four characters that are read wrong more often than they are read right.
 */

/**
 * No `i`, `l`, `o`, `0`, `1`. Those five are the whole reason a code typed off
 * a photo fails, and dropping them costs about half a bit per character against
 * an alphabet we can afford to shorten.
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export const CODE_LENGTH = 8;

/** What `/r/{code}` will accept. Anything else is not a code we ever issued. */
export const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

export function isReferralCode(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

/**
 * Lowercase, trim, and drop a leading `@` or `/`.
 *
 * People paste `/r/abcd2345` and `@abcd2345` into the box as often as they type
 * the code, and refusing those is refusing a customer over punctuation.
 */
export function normalizeCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[@/]+/, "")
    .replace(/^r\//, "");
}

/**
 * A fresh code.
 *
 * `crypto.getRandomValues` rather than `Math.random`: a guessable code lets
 * somebody attribute their own signups to a stranger, which is not a
 * catastrophe but is free to prevent.
 *
 * Rejection sampling rather than modulo, so every character is equally likely —
 * 31 does not divide 256, and biasing towards the front of the alphabet would
 * shrink the space for no reason.
 */
export function generateCode(
  randomBytes: (n: number) => Uint8Array = defaultRandom,
): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = "";

  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }

  return out;
}

function defaultRandom(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
