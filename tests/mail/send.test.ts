import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { desc, eq, inArray, like } from "drizzle-orm";
import { createClient } from "@/db";
import { adminAudit, mailThread, user } from "@/db/schema";
import { MemoryTransport, setTransport } from "@/lib/email";
import { dark, light } from "@/lib/theme";
import { changeThreadStatus, sendTemplatedEmail } from "@/lib/mail/send";
import {
  appendMessage,
  getThread,
  listMessages,
  listThreads,
} from "@/lib/mail/store";

/**
 * Sending, from the operator's side.
 *
 * The rule under test throughout: **nothing leaves without a row and an audit
 * entry**. A support reply is a promise made on the product's behalf, and an
 * outreach send is a message to someone who did not ask for one; both are
 * exactly what §14.8's audit log exists for.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("sendTemplatedEmail", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  afterAll(() => close());

  const ADMIN = {
    userId: "mail-send-admin",
    email: "admin@mail-send.local",
    name: "Nikolay",
  };
  const LEARNER = "mail-send-learner";
  const ENV = {
    EMAIL_SUPPORT_FROM: "MeritKeep <support@meritkeep.com>",
    NEXT_PUBLIC_SITE_URL: "https://meritkeep.com",
  };

  const transport = new MemoryTransport();

  async function reset() {
    await db
      .delete(mailThread)
      .where(like(mailThread.participantEmail, "%@mail-send.local"));
    await db
      .delete(adminAudit)
      .where(like(adminAudit.actorEmail, "%@mail-send.local"));
    await db.delete(user).where(inArray(user.id, [ADMIN.userId, LEARNER]));
  }

  beforeEach(async () => {
    await reset();
    await db.insert(user).values([
      { id: ADMIN.userId, name: "Nikolay", email: ADMIN.email, role: "admin" },
      {
        id: LEARNER,
        name: "Ana Ivanova",
        email: "ana@mail-send.local",
        locale: "bg",
        theme: "dark",
      },
    ]);

    transport.clear();
    setTransport(transport);
  });

  afterEach(() => setTransport(undefined));

  async function audits() {
    return db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.actorEmail, ADMIN.email))
      .orderBy(desc(adminAudit.createdAt));
  }

  it("starts a thread, sends the message, and records both", async () => {
    const result = await sendTemplatedEmail(
      db,
      ADMIN,
      {
        to: "Ana@mail-send.local",
        templateId: "welcome",
        variables: { name: "Ana" },
      },
      ENV,
    );

    expect(result.ok).toBe(true);
    expect(result.message).toContain("ana@mail-send.local");

    const [sent] = transport.sent;
    expect(sent?.to).toBe("ana@mail-send.local");
    expect(sent?.from).toBe("MeritKeep <support@meritkeep.com>");
    // The reply carries the thread, so an answer lands on this conversation
    // rather than starting a new one.
    expect(sent?.replyTo).toBe(
      `MeritKeep <support+${result.threadId}@meritkeep.com>`,
    );

    const messages = await listMessages(db, result.threadId!);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      direction: "outbound",
      status: "sent",
      template: "welcome",
      sentByEmail: ADMIN.email,
      fromAddress: "support@meritkeep.com",
    });

    expect(await audits()).toMatchObject([
      { action: "mail.send", outcome: "ok", target: "ana@mail-send.local" },
    ]);
  });

  it("writes to a learner in their own language by default", async () => {
    // The thread borrows the account's locale, and the message follows it.
    const result = await sendTemplatedEmail(
      db,
      ADMIN,
      { to: "ana@mail-send.local", templateId: "welcome", variables: { name: "Ana" } },
      ENV,
    );

    expect(transport.sent[0]?.html).toContain('<html lang="bg">');
    expect((await getThread(db, result.threadId!))?.locale).toBe("bg");
  });

  it("paints it in the learner's theme, not the operator's", async () => {
    // The one send composed from someone else's browser: the cookie in the tab
    // this runs in belongs to the admin, so the palette comes off the row.
    await sendTemplatedEmail(
      db,
      ADMIN,
      { to: "ana@mail-send.local", templateId: "welcome", variables: { name: "Ana" } },
      ENV,
    );

    expect(transport.sent[0]?.html).toContain(`background:${dark.ground}`);
  });

  it("keeps following the learner's theme on a reply into an old thread", async () => {
    // The read used to be skipped once a thread existed, because a thread knows
    // its own language. It does not know the reader's palette, and the reader
    // can change theirs between the first message and the answer.
    const first = await sendTemplatedEmail(
      db,
      ADMIN,
      { to: "ana@mail-send.local", templateId: "welcome", variables: { name: "Ana" } },
      ENV,
    );

    await db
      .update(user)
      .set({ theme: "light" })
      .where(eq(user.id, LEARNER));
    transport.clear();

    await sendTemplatedEmail(
      db,
      ADMIN,
      {
        threadId: first.threadId,
        templateId: "reply",
        variables: { name: "Ana", message: "Here you go." },
      },
      ENV,
    );

    expect(transport.sent[0]?.html).toContain(`background:${light.ground}`);
  });

  it("falls back to System for a stranger with no account", async () => {
    await sendTemplatedEmail(
      db,
      ADMIN,
      {
        to: "nobody@mail-send.local",
        templateId: "welcome",
        variables: { name: "Nobody" },
      },
      ENV,
    );

    expect(transport.sent[0]?.html).toContain(
      "@media (prefers-color-scheme:dark)",
    );
  });

  it("lets the operator override the language, and remembers it", async () => {
    const result = await sendTemplatedEmail(
      db,
      ADMIN,
      {
        to: "ana@mail-send.local",
        templateId: "welcome",
        locale: "de",
        variables: { name: "Ana" },
      },
      ENV,
    );

    expect(transport.sent[0]?.html).toContain('<html lang="de">');
    expect((await getThread(db, result.threadId!))?.locale).toBe("de");
  });

  it("continues an existing thread and threads the reply", async () => {
    const first = await sendTemplatedEmail(
      db,
      ADMIN,
      { to: "ana@mail-send.local", templateId: "welcome", variables: { name: "Ana" } },
      ENV,
    );

    const second = await sendTemplatedEmail(
      db,
      ADMIN,
      {
        threadId: first.threadId,
        templateId: "reply",
        variables: { name: "Ana", message: "Here's what I found." },
      },
      ENV,
    );

    expect(second.threadId).toBe(first.threadId);
    expect(await listMessages(db, first.threadId!)).toHaveLength(2);
    // One conversation, not two.
    expect(await listThreads(db, "all")).toHaveLength(1);
  });

  it("threads the reply in the reader's mail client when it can", async () => {
    // Best-effort and not what threading depends on — the token in the reply
    // address is — but it is what makes the conversation look like one.
    const first = await sendTemplatedEmail(
      db,
      ADMIN,
      { to: "ana@mail-send.local", templateId: "welcome", variables: { name: "Ana" } },
      ENV,
    );
    await appendMessage(db, {
      threadId: first.threadId!,
      direction: "inbound",
      fromAddress: "ana@mail-send.local",
      toAddress: "support@meritkeep.com",
      subject: "Re: Welcome",
      body: "Thanks!",
      messageId: "<theirs@x.co>",
      status: "received",
    });
    transport.clear();

    await sendTemplatedEmail(
      db,
      ADMIN,
      {
        threadId: first.threadId,
        templateId: "reply",
        variables: { name: "Ana", message: "You're welcome." },
      },
      ENV,
    );

    expect(transport.sent[0]?.headers).toEqual({
      "In-Reply-To": "<theirs@x.co>",
      References: "<theirs@x.co>",
    });
  });

  it("closes the thread when the operator says the answer resolves it", async () => {
    const first = await sendTemplatedEmail(
      db,
      ADMIN,
      { to: "ana@mail-send.local", templateId: "welcome", variables: { name: "Ana" } },
      ENV,
    );

    await sendTemplatedEmail(
      db,
      ADMIN,
      {
        threadId: first.threadId,
        templateId: "resolved",
        variables: { name: "Ana", message: "Fixed." },
      },
      ENV,
    );

    expect((await getThread(db, first.threadId!))?.status).toBe("closed");
  });

  it("records a failed send on the thread rather than losing it", async () => {
    // A support reply that failed silently is a person who thinks they have
    // been answered and has not been.
    setTransport({
      name: "broken",
      send: () => Promise.reject(new Error("Resend is down")),
    });

    const result = await sendTemplatedEmail(
      db,
      ADMIN,
      { to: "ana@mail-send.local", templateId: "welcome", variables: { name: "Ana" } },
      ENV,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Resend is down");
    expect(result.threadId).toBeDefined();

    expect(await listMessages(db, result.threadId!)).toMatchObject([
      { status: "failed", error: "Resend is down" },
    ]);
    expect(await audits()).toMatchObject([
      { action: "mail.send", outcome: "error" },
    ]);
  });

  it("does not close a thread on a resolve that failed to send", async () => {
    const first = await sendTemplatedEmail(
      db,
      ADMIN,
      { to: "ana@mail-send.local", templateId: "welcome", variables: { name: "Ana" } },
      ENV,
    );

    setTransport({ name: "broken", send: () => Promise.reject(new Error("no")) });
    await sendTemplatedEmail(
      db,
      ADMIN,
      {
        threadId: first.threadId,
        templateId: "resolved",
        variables: { name: "Ana", message: "Fixed." },
      },
      ENV,
    );

    expect((await getThread(db, first.threadId!))?.status).toBe("open");
  });

  describe("refusals", () => {
    async function expectRefusal(
      input: Parameters<typeof sendTemplatedEmail>[2],
      match: RegExp,
    ) {
      const result = await sendTemplatedEmail(db, ADMIN, input, ENV);

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(match);
      // Nothing left behind but the audit row saying it was refused.
      expect(transport.sent).toHaveLength(0);
      expect(await listThreads(db, "all")).toHaveLength(0);
      expect(await audits()).toMatchObject([{ outcome: "denied" }]);
    }

    it("refuses a template it does not have", () =>
      expectRefusal(
        { to: "ana@mail-send.local", templateId: "nope", variables: {} },
        /No template called/,
      ));

    it("refuses a message with a hole in it", () =>
      // "Hi , you asked for " is worse than silence.
      expectRefusal(
        { to: "ana@mail-send.local", templateId: "checkIn", variables: { name: "Ana" } },
        /Fill in every field first: goal/,
      ));

    it("refuses a reply template sent cold", () =>
      // Its subject is the thread's, so sent cold it arrives as "Re:" a
      // conversation the reader never had.
      expectRefusal(
        {
          to: "ana@mail-send.local",
          templateId: "reply",
          variables: { name: "Ana", message: "Hi" },
        },
        /only be sent as a reply/,
      ));

    it("records a refusal against the thread when that is all it knows", async () => {
      const { threadId } = await sendTemplatedEmail(
        db,
        ADMIN,
        { to: "ana@mail-send.local", templateId: "welcome", variables: { name: "Ana" } },
        ENV,
      );
      transport.clear();

      const result = await sendTemplatedEmail(
        db,
        ADMIN,
        { threadId, templateId: "nope", variables: {} },
        ENV,
      );

      expect(result.ok).toBe(false);
      expect((await audits())[0]).toMatchObject({
        action: "mail.send",
        outcome: "denied",
        target: threadId,
      });
    });

    it("records a refusal against nothing at all when it knows nothing", async () => {
      await sendTemplatedEmail(db, ADMIN, { templateId: "nope", variables: {} }, ENV);
      expect((await audits())[0]).toMatchObject({ outcome: "denied", target: "" });
    });

    it("refuses a thread that does not exist", () =>
      expectRefusal(
        {
          threadId: "00000000-0000-4000-8000-000000000000",
          templateId: "reply",
          variables: { name: "Ana", message: "Hi" },
        },
        /No such thread/,
      ));

    it("refuses something that is not an address", () =>
      expectRefusal(
        { to: "ana at example", templateId: "welcome", variables: { name: "Ana" } },
        /is not an email address/,
      ));

    it("refuses a send with no recipient at all", () =>
      expectRefusal(
        { templateId: "welcome", variables: { name: "Ana" } },
        /is not an email address/,
      ));
  });

  describe("changeThreadStatus", () => {
    it("closes and reopens, and says who did it", async () => {
      const { threadId } = await sendTemplatedEmail(
        db,
        ADMIN,
        { to: "ana@mail-send.local", templateId: "welcome", variables: { name: "Ana" } },
        ENV,
      );

      expect(await changeThreadStatus(db, ADMIN, threadId!, "closed")).toEqual({
        ok: true,
        message: "Thread closed.",
        threadId,
      });
      expect((await getThread(db, threadId!))?.status).toBe("closed");

      expect(await changeThreadStatus(db, ADMIN, threadId!, "open")).toEqual({
        ok: true,
        message: "Thread reopened.",
        threadId,
      });

      expect(await audits()).toMatchObject([
        { action: "mail.status", outcome: "ok" },
        { action: "mail.status", outcome: "ok" },
        { action: "mail.send", outcome: "ok" },
      ]);
    });

    it("refuses a thread that does not exist, and records the refusal", async () => {
      const result = await changeThreadStatus(
        db,
        ADMIN,
        "00000000-0000-4000-8000-000000000000",
        "closed",
      );

      expect(result.ok).toBe(false);
      expect(await audits()).toMatchObject([
        { action: "mail.status", outcome: "denied" },
      ]);
    });
  });
});
