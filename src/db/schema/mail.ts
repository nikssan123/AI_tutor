import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * The correspondence a person is on one end of: outreach we started, support
 * they started, and every reply either way.
 *
 * **What is deliberately not here: the mail auth sends.** A verification link
 * and a reset link are credentials for as long as they live, and writing them
 * into a table an operator can browse — and a console can query — turns a
 * database read into account takeover. Those messages stay fire-and-forget in
 * `lib/email`. Nothing is lost that matters: what an operator actually needs to
 * know is "did the send fail", and that is already in the logs.
 *
 * A thread exists whether or not the person ever replies, because the outbound
 * message is the thing a reply attaches to. That is why an outreach send
 * creates one: without it the answer arrives with nowhere to go.
 */

/** `open` while it is anyone's move; `closed` once it is nobody's. */
export const THREAD_STATUSES = ["open", "closed"] as const;

export const mailThread = pgTable(
  "mail_thread",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * The person on the other end, lowercased.
     *
     * Lowercased because it is a lookup key: the local part of an address is
     * case-sensitive by the RFC and case-insensitive at every provider anyone
     * actually uses, so preserving the case would split one correspondent into
     * two threads the first time they typed their own address differently.
     */
    participantEmail: text("participant_email").notNull(),
    /** As they signed it, when the inbound mail carried a display name. */
    participantName: text("participant_name"),

    /**
     * The account this address belongs to, when it belongs to one.
     *
     * Nullable and `set null`, not `cascade`: a stranger can write in, and a
     * learner who deletes their account does not thereby delete the support
     * conversation in which they asked us to delete it.
     */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),

    subject: text("subject").notNull(),

    /**
     * The language the operator writes to this person in.
     *
     * Seeded from `user.locale` and then owned by the thread, because it is a
     * fact about the correspondence rather than about the account: someone can
     * hold their UI in German and open a ticket in English, and the reply
     * should follow the ticket.
     */
    locale: text("locale").notNull().default("en"),

    /** `outreach` | `support` — who spoke first. */
    kind: text("kind").notNull(),

    /** One of `THREAD_STATUSES`. */
    status: text("status").notNull().default("open"),

    /**
     * The inbox's unread flag: true from the moment something arrives until an
     * operator answers or closes it. A derived "is the last message inbound"
     * would be equivalent and would cost a join on every list render.
     */
    needsReply: boolean("needs_reply").notNull().default(false),

    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The inbox's only ordering: what is waiting, most recent first.
    index("mail_thread_inbox_idx").on(t.needsReply, t.lastMessageAt),
    index("mail_thread_participant_idx").on(t.participantEmail),
  ],
);

/** `received` for inbound; the rest are what happened to something we sent. */
export const MESSAGE_STATUSES = [
  "received",
  "sent",
  "failed",
  "bounced",
  "complained",
] as const;

export const mailMessage = pgTable(
  "mail_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => mailThread.id, { onDelete: "cascade" }),

    /** `inbound` | `outbound`. */
    direction: text("direction").notNull(),

    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    /** Always present: an inbound HTML-only mail is stored as its text part. */
    body: text("body").notNull(),
    html: text("html"),

    /**
     * Resend's id — the delivery id for something we sent, the received-email
     * id for something that arrived.
     *
     * Unique, and that uniqueness is load-bearing rather than tidy: Resend
     * retries a webhook that did not return 200, and without the constraint a
     * retry files the same support request twice. Postgres permits any number
     * of nulls in a unique index, so a log-transport send that has no id is
     * unaffected.
     */
    providerId: text("provider_id"),

    /** The RFC 5322 `Message-ID`, kept so a later reply can be threaded by it. */
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),

    /** The catalog template this was rendered from; null for inbound. */
    template: text("template"),
    locale: text("locale").notNull().default("en"),

    /**
     * Which operator sent it, by address. Null for inbound.
     *
     * Not a foreign key, for the reason `admin_audit` gives: a record of who
     * acted must not be erasable by the departure of the person who acted.
     */
    sentByEmail: text("sent_by_email"),

    /** One of `MESSAGE_STATUSES`. */
    status: text("status").notNull(),
    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mail_message_thread_idx").on(t.threadId, t.createdAt),
    uniqueIndex("mail_message_provider_idx").on(t.providerId),
    index("mail_message_reference_idx").on(t.messageId),
  ],
);
