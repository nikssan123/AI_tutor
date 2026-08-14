import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { mailMessage, mailThread, user } from "@/db/schema";
import { DEFAULT_LOCALE, resolveLocale, type Locale } from "@/lib/i18n/locales";
import type { ThreadKind } from "@/lib/email/catalog";

/**
 * Reading and writing the correspondence.
 *
 * Every function here takes its `Db` rather than reaching for `getDb()`, which
 * is what lets the inbound webhook, the admin actions and the tests all run
 * against the same code with different handles — and what lets a write and the
 * thread bookkeeping it implies share one transaction.
 */

export type Direction = "inbound" | "outbound";
export type MessageStatus =
  | "received"
  | "sent"
  | "failed"
  | "bounced"
  | "complained";

export interface ThreadRow {
  id: string;
  participantEmail: string;
  participantName: string | null;
  userId: string | null;
  subject: string;
  locale: Locale;
  kind: ThreadKind;
  status: string;
  needsReply: boolean;
  lastMessageAt: Date;
  createdAt: Date;
}

export interface MessageRow {
  id: string;
  threadId: string;
  direction: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  body: string;
  html: string | null;
  providerId: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  template: string | null;
  locale: string;
  sentByEmail: string | null;
  status: string;
  error: string | null;
  createdAt: Date;
}

/** How many threads the inbox shows before paging would be needed. */
export const INBOX_PAGE_SIZE = 100;

/**
 * Addresses are compared lowercased everywhere.
 *
 * See the column comment on `participant_email`: the RFC says the local part is
 * case-sensitive, every provider disagrees, and following the RFC here would
 * split one person into two threads.
 */
export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * `Re: Re: FW: Broken login` → `broken login`.
 *
 * Used only to decide whether a cold inbound message belongs to a conversation
 * we already have. Deliberately aggressive about prefixes and whitespace,
 * because the alternative — a new thread per reply — is the failure mode that
 * makes an inbox useless, while the cost of being wrong is two conversations
 * merged that a person can still read in order.
 */
export function normalizeSubject(value: string): string {
  return value
    .replace(/^\s*((re|aw|antw|fwd?|sv|vs|res)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toThreadRow(row: {
  id: string;
  participantEmail: string;
  participantName: string | null;
  userId: string | null;
  subject: string;
  locale: string;
  kind: string;
  status: string;
  needsReply: boolean;
  lastMessageAt: Date;
  createdAt: Date;
}): ThreadRow {
  return {
    ...row,
    locale: resolveLocale(row.locale),
    kind: row.kind === "outreach" ? "outreach" : "support",
  };
}

const THREAD_COLUMNS = {
  id: mailThread.id,
  participantEmail: mailThread.participantEmail,
  participantName: mailThread.participantName,
  userId: mailThread.userId,
  subject: mailThread.subject,
  locale: mailThread.locale,
  kind: mailThread.kind,
  status: mailThread.status,
  needsReply: mailThread.needsReply,
  lastMessageAt: mailThread.lastMessageAt,
  createdAt: mailThread.createdAt,
};

/** Which slice of the inbox is on screen. */
export type InboxFilter = "waiting" | "open" | "all";

export const INBOX_FILTERS: readonly InboxFilter[] = ["waiting", "open", "all"];

export function isInboxFilter(value: unknown): value is InboxFilter {
  return (
    typeof value === "string" &&
    (INBOX_FILTERS as readonly string[]).includes(value)
  );
}

export async function listThreads(
  db: Db,
  filter: InboxFilter = "waiting",
  limit = INBOX_PAGE_SIZE,
): Promise<ThreadRow[]> {
  const where =
    filter === "waiting"
      ? eq(mailThread.needsReply, true)
      : filter === "open"
        ? eq(mailThread.status, "open")
        : undefined;

  const rows = await db
    .select(THREAD_COLUMNS)
    .from(mailThread)
    .where(where)
    .orderBy(desc(mailThread.lastMessageAt))
    .limit(limit);

  return rows.map(toThreadRow);
}

/** How many threads are waiting on us — the number the nav badge shows. */
export async function waitingCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mailThread)
    .where(eq(mailThread.needsReply, true));

  // An aggregate over zero rows is still one row holding zero.
  return row!.count;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A thread, or nothing — including when the id could not name one.
 *
 * The shape check is not tidiness. Every caller receives its id from outside:
 * a URL segment, a form field, the local part of an address a stranger chose.
 * Postgres raises `invalid input syntax for type uuid` on anything that is not
 * one, so without this `/admin/mail/nonsense` is a 500 rather than the 404 the
 * page intends, and a hand-posted `threadId` crashes a send.
 */
export async function getThread(
  db: Db,
  id: string,
): Promise<ThreadRow | undefined> {
  if (!UUID.test(id)) return undefined;

  const [row] = await db
    .select(THREAD_COLUMNS)
    .from(mailThread)
    .where(eq(mailThread.id, id))
    .limit(1);

  return row === undefined ? undefined : toThreadRow(row);
}

export async function listMessages(
  db: Db,
  threadId: string,
): Promise<MessageRow[]> {
  return db
    .select()
    .from(mailMessage)
    .where(eq(mailMessage.threadId, threadId))
    .orderBy(mailMessage.createdAt);
}

/**
 * The account behind an address, if there is one.
 *
 * Worth doing on every inbound message rather than only on outreach: knowing
 * that the person writing in is on the free plan and signed up yesterday is
 * most of what an operator needs before answering, and looking it up by hand is
 * the friction that stops them.
 */
export async function accountFor(
  db: Db,
  email: string,
): Promise<{ id: string; name: string; locale: Locale } | undefined> {
  const [row] = await db
    .select({ id: user.id, name: user.name, locale: user.locale })
    .from(user)
    .where(eq(user.email, normalizeAddress(email)))
    .limit(1);

  return row === undefined
    ? undefined
    : { id: row.id, name: row.name, locale: resolveLocale(row.locale) };
}

export interface NewThread {
  participantEmail: string;
  participantName?: string | null;
  subject: string;
  kind: ThreadKind;
  locale?: Locale;
  needsReply?: boolean;
}

export async function createThread(
  db: Db,
  input: NewThread,
): Promise<ThreadRow> {
  const email = normalizeAddress(input.participantEmail);
  const account = await accountFor(db, email);

  const [row] = await db
    .insert(mailThread)
    .values({
      participantEmail: email,
      participantName: input.participantName ?? account?.name ?? null,
      userId: account?.id ?? null,
      subject: input.subject,
      kind: input.kind,
      // The account's language is the best guess we have for a first message.
      // After that the thread owns it.
      locale: input.locale ?? account?.locale ?? DEFAULT_LOCALE,
      needsReply: input.needsReply ?? false,
    })
    .returning(THREAD_COLUMNS);

  return toThreadRow(row!);
}

/**
 * The thread a cold inbound message belongs to.
 *
 * Called only when the reply-to token was absent — see `lib/email/addresses.ts`
 * for why that token is the primary mechanism. Matching on
 * (participant, normalised subject, still open) is the best available guess for
 * mail that arrived without one.
 */
export async function findThreadBySubject(
  db: Db,
  participantEmail: string,
  subject: string,
): Promise<ThreadRow | undefined> {
  const rows = await db
    .select(THREAD_COLUMNS)
    .from(mailThread)
    .where(
      and(
        eq(mailThread.participantEmail, normalizeAddress(participantEmail)),
        eq(mailThread.status, "open"),
      ),
    )
    .orderBy(desc(mailThread.lastMessageAt))
    .limit(INBOX_PAGE_SIZE);

  const target = normalizeSubject(subject);
  const match = rows.find((row) => normalizeSubject(row.subject) === target);

  return match === undefined ? undefined : toThreadRow(match);
}

/** The thread carrying a given `Message-ID`, for header-based threading. */
export async function findThreadByMessageId(
  db: Db,
  messageId: string,
): Promise<ThreadRow | undefined> {
  const [row] = await db
    .select(THREAD_COLUMNS)
    .from(mailThread)
    .innerJoin(mailMessage, eq(mailMessage.threadId, mailThread.id))
    .where(eq(mailMessage.messageId, messageId))
    .orderBy(desc(mailMessage.createdAt))
    .limit(1);

  return row === undefined ? undefined : toThreadRow(row);
}

export interface NewMessage {
  threadId: string;
  direction: Direction;
  fromAddress: string;
  toAddress: string;
  subject: string;
  body: string;
  html?: string | null;
  providerId?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  template?: string | null;
  locale?: Locale;
  sentByEmail?: string | null;
  status: MessageStatus;
  error?: string | null;
}

/**
 * Appends a message and moves the thread's clock with it.
 *
 * One transaction, because a message whose thread still says "answered" is a
 * support request that silently never gets read. `needsReply` follows the
 * direction: something arrived, it is our move; we answered, it is theirs.
 *
 * A duplicate `providerId` is not an error. Resend retries any webhook that did
 * not answer 200, so the second delivery of a message we already filed has to
 * be a no-op rather than a second copy or a 500 that provokes a third attempt.
 */
export async function appendMessage(
  db: Db,
  input: NewMessage,
): Promise<MessageRow | undefined> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(mailMessage)
      .values({
        threadId: input.threadId,
        direction: input.direction,
        fromAddress: input.fromAddress,
        toAddress: input.toAddress,
        subject: input.subject,
        body: input.body,
        html: input.html ?? null,
        providerId: input.providerId ?? null,
        messageId: input.messageId ?? null,
        inReplyTo: input.inReplyTo ?? null,
        template: input.template ?? null,
        locale: input.locale ?? DEFAULT_LOCALE,
        sentByEmail: input.sentByEmail ?? null,
        status: input.status,
        error: input.error ?? null,
      })
      .onConflictDoNothing({ target: mailMessage.providerId })
      .returning();

    if (row === undefined) return undefined;

    await tx
      .update(mailThread)
      .set({
        lastMessageAt: row.createdAt,
        needsReply: input.direction === "inbound",
        // An answer to a closed thread reopens it. The alternative is a reply
        // that lands nowhere an operator will look again.
        status: "open",
      })
      .where(eq(mailThread.id, input.threadId));

    return row;
  });
}

export async function setThreadStatus(
  db: Db,
  threadId: string,
  status: "open" | "closed",
): Promise<void> {
  await db
    .update(mailThread)
    .set({ status, needsReply: false })
    .where(eq(mailThread.id, threadId));
}

export async function setThreadLocale(
  db: Db,
  threadId: string,
  locale: Locale,
): Promise<void> {
  await db.update(mailThread).set({ locale }).where(eq(mailThread.id, threadId));
}

/**
 * Records what a provider told us later about something we sent.
 *
 * Returns whether a row was found: a bounce for a message we have no record of
 * is the ordinary case, not an error — auth mail is not in this table by
 * design, and its bounces arrive here all the same.
 */
export async function markDelivery(
  db: Db,
  providerId: string,
  status: MessageStatus,
  error: string | null = null,
): Promise<boolean> {
  const rows = await db
    .update(mailMessage)
    .set({ status, error })
    .where(eq(mailMessage.providerId, providerId))
    .returning({ id: mailMessage.id });

  return rows.length > 0;
}
