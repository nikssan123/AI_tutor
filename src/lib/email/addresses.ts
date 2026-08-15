import type { EnvLike } from "@/lib/env-types";

/**
 * Who mail comes from, and how a reply finds its way back to a conversation.
 *
 * Two mailboxes, deliberately not more:
 *
 * - **`EMAIL_FROM`** sends everything auth generates. Nobody replies to a
 *   password reset, and if they do we would rather they reached a person than a
 *   `no-reply@`, so it is a real address — just not one a human watches.
 * - **`EMAIL_SUPPORT_FROM`** sends everything a person wrote in `/admin/mail`,
 *   and is the address whose MX record points at Resend. Replies to it come
 *   back through the inbound webhook and land in the inbox.
 *
 * Threading is done with a plus-addressed `Reply-To` — `support+<threadId>@` —
 * rather than by matching `In-Reply-To` headers. Header matching needs the
 * `Message-ID` the provider assigned to our own outbound mail, which Resend
 * does not return, so it can only ever work on chains we did not start. The
 * token in the address is ours, survives every client, and is how GitHub and
 * every other system that does this reliably does it. Header matching is still
 * the fallback in `lib/mail/inbound.ts`, for the mail that arrives cold.
 */

/** Used when nothing is configured, which locally means the log transport. */
export const DEFAULT_FROM = "MeritKeep <hello@meritkeep.com>";
export const DEFAULT_SUPPORT_FROM = "MeritKeep <support@meritkeep.com>";

export interface Mailbox {
  /** The display name, or null for a bare address. */
  name: string | null;
  address: string;
}

/**
 * Parses `Name <a@b.co>` and `a@b.co` alike.
 *
 * Not an RFC 5322 parser and not trying to be — the inputs are our own
 * configuration and the `from` of a message Resend already accepted, both of
 * which are the two shapes above.
 */
export function parseMailbox(value: string): Mailbox {
  const angled = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!angled) return { name: null, address: value.trim() };

  const name = angled[1]!.replace(/^"|"$/g, "").trim();
  return { name: name === "" ? null : name, address: angled[2]!.trim() };
}

export function formatMailbox(mailbox: Mailbox): string {
  return mailbox.name === null
    ? mailbox.address
    : `${mailbox.name} <${mailbox.address}>`;
}

/**
 * Good enough to reject a typo before it costs a send, and no stricter.
 *
 * Anything beyond "there is a local part, an @, and a dot-bearing domain"
 * starts rejecting addresses that genuinely deliver, and the authoritative
 * check — does mail to this address bounce — is one only sending can perform.
 */
export function isEmailAddress(value: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value.trim());
}

export function systemFrom(env: EnvLike = process.env): string {
  return env.EMAIL_FROM ?? DEFAULT_FROM;
}

export function supportFrom(env: EnvLike = process.env): string {
  return env.EMAIL_SUPPORT_FROM ?? env.EMAIL_FROM ?? DEFAULT_SUPPORT_FROM;
}

/**
 * Where the product writes to us rather than to a learner.
 *
 * A build that failed is nobody's job until somebody is told, and "somebody" is
 * an inbox a person actually opens — so it falls back to the support address
 * rather than to `hello@`, which is a from-address and not a destination.
 * Overridable because the team that reads operational alerts is not always the
 * team that answers support.
 */
export function teamInbox(env: EnvLike = process.env): string {
  return env.EMAIL_TEAM ?? supportFrom(env);
}

/** `support@meritkeep.com` + `abc` → `support+abc@meritkeep.com`. */
export function plusAddress(address: string, token: string): string {
  const at = address.lastIndexOf("@");
  if (at === -1) return address;
  return `${address.slice(0, at)}+${token}${address.slice(at)}`;
}

/**
 * The `Reply-To` for a message in a thread: the support mailbox, tagged.
 *
 * The display name is kept, because a bare `support+9f3c…@` in a mail client's
 * "to" field looks like a machine address someone should not write to — which
 * is the opposite of what a support reply is asking for.
 */
export function threadReplyAddress(
  threadId: string,
  env: EnvLike = process.env,
): string {
  const mailbox = parseMailbox(supportFrom(env));
  return formatMailbox({
    name: mailbox.name,
    address: plusAddress(mailbox.address, threadId),
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The thread id an inbound message was addressed to, if any.
 *
 * The local part before the `+` must match the support mailbox's. Without that
 * check, a thread token pasted into a CC on some unrelated address would pull a
 * stranger's mail into a conversation it has nothing to do with.
 */
export function threadIdFromRecipients(
  recipients: readonly string[],
  env: EnvLike = process.env,
): string | null {
  const support = parseMailbox(supportFrom(env)).address.toLowerCase();
  const at = support.lastIndexOf("@");
  const local = support.slice(0, at);
  const domain = support.slice(at);

  for (const recipient of recipients) {
    const address = parseMailbox(recipient).address.toLowerCase();
    if (!address.endsWith(domain)) continue;

    const plus = address.slice(0, address.lastIndexOf("@")).split("+");
    if (plus.length !== 2 || plus[0] !== local) continue;
    if (UUID.test(plus[1]!)) return plus[1]!.toLowerCase();
  }

  return null;
}
