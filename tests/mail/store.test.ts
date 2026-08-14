import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { createClient } from "@/db";
import { mailMessage, mailThread, user } from "@/db/schema";
import {
  accountFor,
  appendMessage,
  createThread,
  findThreadByMessageId,
  findThreadBySubject,
  getThread,
  INBOX_FILTERS,
  isInboxFilter,
  listMessages,
  listThreads,
  markDelivery,
  normalizeAddress,
  normalizeSubject,
  setThreadLocale,
  setThreadStatus,
  waitingCount,
} from "@/lib/mail/store";

/**
 * The correspondence, against a real database.
 *
 * These are database properties — that a duplicate webhook delivery does not
 * file a support request twice, that appending a message and moving the
 * thread's clock happen together or not at all — so a mock would be asserting
 * on the mock.
 */

describe("normalizeAddress", () => {
  it("lowercases and trims", () => {
    // The RFC says the local part is case-sensitive; every provider anyone
    // uses disagrees, and following the RFC would split one correspondent into
    // two threads the first time they typed their own address differently.
    expect(normalizeAddress("  Ana@Example.COM ")).toBe("ana@example.com");
  });
});

describe("normalizeSubject", () => {
  it.each([
    ["Re: Broken login", "broken login"],
    ["RE: Re: FW: Broken login", "broken login"],
    ["AW: Antw: Kaputt", "kaputt"],
    ["Re[2]: Broken login", "broken login"],
    ["  Broken   login  ", "broken login"],
  ])("reads %o as %o", (value, expected) => {
    expect(normalizeSubject(value)).toBe(expected);
  });
});

describe("isInboxFilter", () => {
  it.each(INBOX_FILTERS)("accepts %s", (filter) => {
    expect(isInboxFilter(filter)).toBe(true);
  });

  it.each([["closed"], [""], [null], [7]])("rejects %o", (value) => {
    expect(isInboxFilter(value)).toBe(false);
  });
});

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("against a real database", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  afterAll(() => close());

  const LEARNER = "mail-store-learner";

  async function reset() {
    await db
      .delete(mailThread)
      .where(like(mailThread.participantEmail, "%@mail-store.local"));
    await db.delete(user).where(inArray(user.id, [LEARNER]));
  }

  beforeEach(async () => {
    await reset();
    await db.insert(user).values({
      id: LEARNER,
      name: "Ana Ivanova",
      email: "ana@mail-store.local",
      locale: "bg",
      theme: "dark",
    });
  });

  describe("createThread", () => {
    it("links the account behind the address, and borrows its language", () => {
      // The account's language is the best guess for a first message. After
      // that the thread owns it.
      return createThread(db, {
        participantEmail: "  ANA@mail-store.local ",
        subject: "Hello",
        kind: "outreach",
      }).then((thread) => {
        expect(thread.participantEmail).toBe("ana@mail-store.local");
        expect(thread.userId).toBe(LEARNER);
        expect(thread.participantName).toBe("Ana Ivanova");
        expect(thread.locale).toBe("bg");
        expect(thread.kind).toBe("outreach");
        expect(thread.status).toBe("open");
        expect(thread.needsReply).toBe(false);
      });
    });

    it("takes a stranger with no account", async () => {
      const thread = await createThread(db, {
        participantEmail: "nobody@mail-store.local",
        participantName: "Nobody",
        subject: "Hello",
        kind: "support",
        needsReply: true,
      });

      expect(thread.userId).toBeNull();
      expect(thread.participantName).toBe("Nobody");
      expect(thread.locale).toBe("en");
      expect(thread.needsReply).toBe(true);
    });

    it("prefers an explicit language over the account's", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Hello",
        kind: "support",
        locale: "de",
      });
      expect(thread.locale).toBe("de");
    });

    it("resolves a language the column should not have held", async () => {
      await db
        .update(user)
        .set({ locale: "klingon" })
        .where(eq(user.id, LEARNER));

      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Hello",
        kind: "support",
      });
      expect(thread.locale).toBe("en");
    });
  });

  describe("accountFor", () => {
    it("finds the account, or says there is none", async () => {
      expect(await accountFor(db, "ANA@mail-store.local")).toEqual({
        id: LEARNER,
        name: "Ana Ivanova",
        locale: "bg",
        // Carried because the mail frame needs it, and because a support reply
        // is composed from the operator's browser, not the reader's.
        theme: "dark",
      });
      expect(await accountFor(db, "nobody@mail-store.local")).toBeUndefined();
    });

    it("reads a nonsense theme as System, as the renderer expects", async () => {
      await db
        .update(user)
        .set({ theme: "chartreuse" })
        .where(eq(user.id, LEARNER));

      expect((await accountFor(db, "ana@mail-store.local"))?.theme).toBe(
        "system",
      );
    });
  });

  describe("appendMessage", () => {
    it("moves the thread's clock and hands it back to us", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Hello",
        kind: "outreach",
      });

      const message = await appendMessage(db, {
        threadId: thread.id,
        direction: "inbound",
        fromAddress: "ana@mail-store.local",
        toAddress: "support@meritkeep.com",
        subject: "Hello",
        body: "Anyone there?",
        providerId: "re_in_1",
        status: "received",
      });

      const after = await getThread(db, thread.id);
      expect(message?.status).toBe("received");
      expect(after?.needsReply).toBe(true);
      expect(after?.lastMessageAt).toEqual(message!.createdAt);
    });

    it("hands the thread back to them when we answer", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Hello",
        kind: "support",
        needsReply: true,
      });

      await appendMessage(db, {
        threadId: thread.id,
        direction: "outbound",
        fromAddress: "support@meritkeep.com",
        toAddress: "ana@mail-store.local",
        subject: "Re: Hello",
        body: "Here you go.",
        template: "reply",
        locale: "bg",
        sentByEmail: "admin@meritkeep.com",
        status: "sent",
      });

      expect((await getThread(db, thread.id))?.needsReply).toBe(false);
    });

    it("reopens a closed thread rather than losing the reply", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Hello",
        kind: "support",
      });
      await setThreadStatus(db, thread.id, "closed");

      await appendMessage(db, {
        threadId: thread.id,
        direction: "inbound",
        fromAddress: "ana@mail-store.local",
        toAddress: "support@meritkeep.com",
        subject: "Re: Hello",
        body: "Still broken.",
        status: "received",
      });

      const after = await getThread(db, thread.id);
      expect(after?.status).toBe("open");
      expect(after?.needsReply).toBe(true);
    });

    it("files a repeated webhook delivery exactly once", async () => {
      // Resend retries anything that did not answer 200. Without the unique
      // index the retry files the same support request twice.
      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Hello",
        kind: "support",
      });

      const first = await appendMessage(db, {
        threadId: thread.id,
        direction: "inbound",
        fromAddress: "ana@mail-store.local",
        toAddress: "support@meritkeep.com",
        subject: "Hello",
        body: "Anyone there?",
        providerId: "re_dupe",
        status: "received",
      });
      const second = await appendMessage(db, {
        threadId: thread.id,
        direction: "inbound",
        fromAddress: "ana@mail-store.local",
        toAddress: "support@meritkeep.com",
        subject: "Hello",
        body: "Anyone there?",
        providerId: "re_dupe",
        status: "received",
      });

      expect(first).toBeDefined();
      expect(second).toBeUndefined();
      expect(await listMessages(db, thread.id)).toHaveLength(1);
    });

    it("lets two messages with no provider id both land", async () => {
      // Postgres permits any number of nulls in a unique index, which is what
      // keeps the log transport — which has no ids — usable.
      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Hello",
        kind: "support",
      });

      for (const body of ["one", "two"]) {
        await appendMessage(db, {
          threadId: thread.id,
          direction: "outbound",
          fromAddress: "support@meritkeep.com",
          toAddress: "ana@mail-store.local",
          subject: "Hello",
          body,
          status: "sent",
        });
      }

      expect(await listMessages(db, thread.id)).toHaveLength(2);
    });
  });

  describe("the inbox", () => {
    async function seed() {
      const waiting = await createThread(db, {
        participantEmail: "waiting@mail-store.local",
        subject: "Waiting",
        kind: "support",
        needsReply: true,
      });
      const open = await createThread(db, {
        participantEmail: "open@mail-store.local",
        subject: "Open",
        kind: "outreach",
      });
      const closed = await createThread(db, {
        participantEmail: "closed@mail-store.local",
        subject: "Closed",
        kind: "support",
      });
      await setThreadStatus(db, closed.id, "closed");
      return { waiting, open, closed };
    }

    it("opens on what is waiting on us", async () => {
      const { waiting } = await seed();
      const rows = await listThreads(db);
      expect(rows.map((row) => row.id)).toEqual([waiting.id]);
    });

    it("shows every open thread, answered or not", async () => {
      const { waiting, open } = await seed();
      const rows = await listThreads(db, "open");
      expect(new Set(rows.map((row) => row.id))).toEqual(
        new Set([waiting.id, open.id]),
      );
    });

    it("shows closed threads only under all", async () => {
      const { closed } = await seed();
      const rows = await listThreads(db, "all");
      expect(rows.map((row) => row.id)).toContain(closed.id);
    });

    it("counts what is waiting", async () => {
      await seed();
      expect(await waitingCount(db)).toBe(1);
    });

    it("obeys its limit", async () => {
      await seed();
      expect(await listThreads(db, "all", 1)).toHaveLength(1);
    });
  });

  describe("finding a thread for a cold message", () => {
    it("matches an open thread by participant and subject, ignoring Re:", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Broken login",
        kind: "support",
      });

      expect(
        (await findThreadBySubject(db, "ANA@mail-store.local", "Re: Broken login"))
          ?.id,
      ).toBe(thread.id);
    });

    it("will not reopen a closed conversation by subject alone", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Broken login",
        kind: "support",
      });
      await setThreadStatus(db, thread.id, "closed");

      expect(
        await findThreadBySubject(db, "ana@mail-store.local", "Broken login"),
      ).toBeUndefined();
    });

    it("does not match a different person with the same subject", async () => {
      await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Broken login",
        kind: "support",
      });

      expect(
        await findThreadBySubject(db, "other@mail-store.local", "Broken login"),
      ).toBeUndefined();
    });

    it("matches by Message-ID", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Broken login",
        kind: "support",
      });
      await appendMessage(db, {
        threadId: thread.id,
        direction: "inbound",
        fromAddress: "ana@mail-store.local",
        toAddress: "support@meritkeep.com",
        subject: "Broken login",
        body: "Hi",
        messageId: "<first@x.co>",
        status: "received",
      });

      expect((await findThreadByMessageId(db, "<first@x.co>"))?.id).toBe(
        thread.id,
      );
      expect(await findThreadByMessageId(db, "<never@x.co>")).toBeUndefined();
    });
  });

  describe("thread bookkeeping", () => {
    it("clears the flag when a thread is closed, and can reopen it", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Hello",
        kind: "support",
        needsReply: true,
      });

      await setThreadStatus(db, thread.id, "closed");
      expect(await getThread(db, thread.id)).toMatchObject({
        status: "closed",
        needsReply: false,
      });

      await setThreadStatus(db, thread.id, "open");
      expect((await getThread(db, thread.id))?.status).toBe("open");
    });

    it("remembers the language we last wrote in", async () => {
      const thread = await createThread(db, {
        participantEmail: "nobody@mail-store.local",
        subject: "Hello",
        kind: "support",
      });

      await setThreadLocale(db, thread.id, "de");
      expect((await getThread(db, thread.id))?.locale).toBe("de");
    });

    it("says nothing about a thread that does not exist", async () => {
      expect(
        await getThread(db, "00000000-0000-4000-8000-000000000000"),
      ).toBeUndefined();
    });

    it.each([["not-a-uuid"], [""], ["1; drop table mail_thread"]])(
      "says nothing about %o rather than letting Postgres raise",
      async (id) => {
        // Every caller gets its id from outside — a URL segment, a form field,
        // the local part of an address a stranger chose. Without the shape
        // check `/admin/mail/nonsense` is a 500 rather than a 404.
        expect(await getThread(db, id)).toBeUndefined();
      },
    );
  });

  describe("markDelivery", () => {
    it("records a bounce against the message it belongs to", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-store.local",
        subject: "Hello",
        kind: "outreach",
      });
      await appendMessage(db, {
        threadId: thread.id,
        direction: "outbound",
        fromAddress: "support@meritkeep.com",
        toAddress: "ana@mail-store.local",
        subject: "Hello",
        body: "Hi",
        providerId: "re_out_1",
        status: "sent",
      });

      expect(await markDelivery(db, "re_out_1", "bounced", "mailbox full")).toBe(
        true,
      );

      const [message] = await db
        .select()
        .from(mailMessage)
        .where(eq(mailMessage.providerId, "re_out_1"));
      expect(message?.status).toBe("bounced");
      expect(message?.error).toBe("mailbox full");
    });

    it("says so, without complaining, when it recognises nothing", async () => {
      // Auth mail is deliberately not in this table, and its bounces arrive
      // here all the same.
      expect(await markDelivery(db, "re_unknown", "complained")).toBe(false);
    });
  });
});
