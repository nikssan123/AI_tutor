import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { createClient } from "@/db";
import { mailMessage, mailThread, user } from "@/db/schema";
import { recordReceived, resolveThread, type ReceivedEmail } from "@/lib/mail/inbound";
import { handleWebhook } from "@/lib/mail/webhook";
import {
  appendMessage,
  createThread,
  getThread,
  listMessages,
  listThreads,
} from "@/lib/mail/store";

/**
 * Mail arriving, filed against a real database.
 *
 * The question every test here asks is the one an inbox lives or dies on: did
 * this land on the conversation it belongs to? Getting it wrong in one
 * direction means a new thread per reply; in the other, a stranger's mail
 * inside someone else's support conversation.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

const SECRET = `whsec_${Buffer.from("inbound-test-key").toString("base64")}`;
const NOW = 1_800_000_000;
const ENV = {
  RESEND_WEBHOOK_SECRET: SECRET,
  RESEND_API_KEY: "re_key",
  EMAIL_SUPPORT_FROM: "MeritKeep <support@meritkeep.com>",
};

function signed(body: string) {
  const key = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
  const id = "msg_1";
  return {
    body,
    headers: {
      id,
      timestamp: String(NOW),
      signature: `v1,${createHmac("sha256", key).update(`${id}.${NOW}.${body}`).digest("base64")}`,
    },
  };
}

live("inbound mail", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  afterAll(() => close());

  const LEARNER = "mail-in-learner";
  const FROM = "Ana Ivanova <ana@mail-in.local>";

  function email(overrides: Partial<ReceivedEmail> = {}): ReceivedEmail {
    return {
      id: `re_${Math.random().toString(36).slice(2)}`,
      from: FROM,
      to: ["support@meritkeep.com"],
      subject: "Broken login",
      text: "It will not let me in.",
      html: null,
      messageId: "<first@x.co>",
      inReplyTo: null,
      references: [],
      ...overrides,
    };
  }

  async function reset() {
    await db
      .delete(mailThread)
      .where(like(mailThread.participantEmail, "%@mail-in.local"));
    await db.delete(user).where(inArray(user.id, [LEARNER]));
  }

  beforeEach(async () => {
    await reset();
    await db.insert(user).values({
      id: LEARNER,
      name: "Ana Ivanova",
      email: "ana@mail-in.local",
      locale: "bg",
    });
  });

  // Several tests below silence `console.error`; without this the spies stack
  // and each one counts every earlier test's calls as well as its own.
  afterEach(() => vi.restoreAllMocks());

  describe("recordReceived", () => {
    it("opens a thread for a stranger and marks it waiting on us", async () => {
      const result = await recordReceived(db, email(), ENV);

      const thread = await getThread(db, result.threadId);
      expect(result.stored).toBe(true);
      expect(thread).toMatchObject({
        participantEmail: "ana@mail-in.local",
        participantName: "Ana Ivanova",
        subject: "Broken login",
        kind: "support",
        needsReply: true,
        status: "open",
        // Linked to the account behind the address, so the operator can see
        // who they are answering without going looking.
        userId: LEARNER,
        locale: "bg",
      });

      expect(await listMessages(db, result.threadId)).toMatchObject([
        {
          direction: "inbound",
          status: "received",
          body: "It will not let me in.",
          messageId: "<first@x.co>",
        },
      ]);
    });

    it("stores an HTML-only message as readable text, keeping the original", async () => {
      const result = await recordReceived(
        db,
        email({ text: null, html: "<p>One.</p><p>Two.</p>" }),
        ENV,
      );

      const [message] = await listMessages(db, result.threadId);
      expect(message?.body).toBe("One.\n\nTwo.");
      expect(message?.html).toBe("<p>One.</p><p>Two.</p>");
    });

    it("survives a message with neither body, and no visible recipient", async () => {
      const result = await recordReceived(
        db,
        email({ text: null, html: null, to: [] }),
        ENV,
      );

      expect((await listMessages(db, result.threadId))[0]).toMatchObject({
        body: "",
        toAddress: "",
      });
    });

    it("files a webhook retry once", async () => {
      const same = email({ id: "re_retry" });
      const first = await recordReceived(db, same, ENV);
      const second = await recordReceived(db, same, ENV);

      expect(first.stored).toBe(true);
      expect(second.stored).toBe(false);
      expect(await listMessages(db, first.threadId)).toHaveLength(1);
    });
  });

  describe("resolveThread", () => {
    it("follows the reply-to token above everything else", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-in.local",
        subject: "Something else entirely",
        kind: "outreach",
      });

      const found = await resolveThread(
        db,
        email({
          to: [`support+${thread.id}@meritkeep.com`],
          subject: "Nothing like the original",
        }),
        ENV,
      );

      expect(found?.id).toBe(thread.id);
    });

    it("ignores a token for a thread that no longer exists", async () => {
      const found = await resolveThread(
        db,
        email({ to: ["support+00000000-0000-4000-8000-000000000000@meritkeep.com"] }),
        ENV,
      );
      expect(found).toBeUndefined();
    });

    it("falls back to In-Reply-To", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-in.local",
        subject: "Broken login",
        kind: "support",
      });
      await appendMessage(db, {
        threadId: thread.id,
        direction: "inbound",
        fromAddress: "ana@mail-in.local",
        toAddress: "support@meritkeep.com",
        subject: "Broken login",
        body: "Hi",
        messageId: "<earlier@x.co>",
        status: "received",
      });

      const found = await resolveThread(
        db,
        email({ subject: "Unrelated", inReplyTo: "<earlier@x.co>" }),
        ENV,
      );
      expect(found?.id).toBe(thread.id);
    });

    it("falls back to the References chain", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-in.local",
        subject: "Broken login",
        kind: "support",
      });
      await appendMessage(db, {
        threadId: thread.id,
        direction: "inbound",
        fromAddress: "ana@mail-in.local",
        toAddress: "support@meritkeep.com",
        subject: "Broken login",
        body: "Hi",
        messageId: "<root@x.co>",
        status: "received",
      });

      const found = await resolveThread(
        db,
        email({
          subject: "Unrelated",
          inReplyTo: "<unknown@x.co>",
          references: ["<root@x.co>"],
        }),
        ENV,
      );
      expect(found?.id).toBe(thread.id);
    });

    it("falls back to the same person and the same subject", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-in.local",
        subject: "Broken login",
        kind: "support",
      });

      const found = await resolveThread(
        db,
        email({ subject: "Re: Broken login", messageId: null }),
        ENV,
      );
      expect(found?.id).toBe(thread.id);
    });

    it("starts a new thread when nothing matches", async () => {
      expect(
        await resolveThread(db, email({ subject: "Brand new question" }), ENV),
      ).toBeUndefined();
    });
  });

  describe("handleWebhook", () => {
    function fetchStub(body: unknown, status = 200) {
      return vi.fn(async () =>
        status === 200
          ? Response.json(body)
          : new Response("nope", { status }),
      );
    }

    const received = JSON.stringify({
      type: "email.received",
      data: { email_id: "re_hook_1" },
    });

    it("records a signed inbound message end to end", async () => {
      const result = await handleWebhook(db, signed(received), {
        env: ENV,
        nowSeconds: NOW,
        fetchImpl: fetchStub({
          id: "re_hook_1",
          from: FROM,
          to: ["support@meritkeep.com"],
          subject: "Broken login",
          text: "Help.",
        }),
      });

      expect(result.status).toBe(200);
      expect(result.body.stored).toBe(true);
      expect(await listThreads(db, "waiting")).toHaveLength(1);
    });

    it("refuses everything when no secret is configured", async () => {
      // An endpoint that writes to the database and cannot check who is
      // calling it is one anybody can file a support request through.
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await handleWebhook(db, signed(received), {
        env: { RESEND_API_KEY: "k" },
        nowSeconds: NOW,
      });

      expect(result.status).toBe(500);
      expect(error).toHaveBeenCalledOnce();
      expect(await listThreads(db, "all")).toHaveLength(0);
    });

    it("refuses an unsigned call", async () => {
      const result = await handleWebhook(
        db,
        { body: received, headers: { id: null, timestamp: null, signature: null } },
        { env: ENV, nowSeconds: NOW },
      );

      expect(result.status).toBe(401);
      expect(await listThreads(db, "all")).toHaveLength(0);
    });

    it("refuses a body that is not JSON, without asking Resend to retry", async () => {
      // It will not parse any better in ten minutes, and an endless retry loop
      // hides the real failure.
      const result = await handleWebhook(db, signed("not json"), {
        env: ENV,
        nowSeconds: NOW,
      });
      expect(result.status).toBe(400);
    });

    it("refuses a payload it cannot make sense of", async () => {
      const result = await handleWebhook(db, signed('"a string"'), {
        env: ENV,
        nowSeconds: NOW,
      });
      expect(result).toEqual({ status: 400, body: { error: "unknown payload" } });
    });

    it("acknowledges an event it does not act on", async () => {
      const body = JSON.stringify({
        type: "email.opened",
        data: { email_id: "re_x" },
      });

      expect(await handleWebhook(db, signed(body), { env: ENV, nowSeconds: NOW })).toEqual(
        { status: 200, body: { ignored: "email.opened" } },
      );
    });

    it("marks a bounce against the message it belongs to", async () => {
      const thread = await createThread(db, {
        participantEmail: "ana@mail-in.local",
        subject: "Hello",
        kind: "outreach",
      });
      await appendMessage(db, {
        threadId: thread.id,
        direction: "outbound",
        fromAddress: "support@meritkeep.com",
        toAddress: "ana@mail-in.local",
        subject: "Hello",
        body: "Hi",
        providerId: "re_out_9",
        status: "sent",
      });

      const body = JSON.stringify({
        type: "email.bounced",
        data: { email_id: "re_out_9", reason: "mailbox full" },
      });

      const result = await handleWebhook(db, signed(body), {
        env: ENV,
        nowSeconds: NOW,
      });

      expect(result).toEqual({
        status: 200,
        body: { status: "bounced", matched: true },
      });

      const [message] = await db
        .select()
        .from(mailMessage)
        .where(eq(mailMessage.providerId, "re_out_9"));
      expect(message?.status).toBe("bounced");
    });

    it("accepts a bounce for mail it has no record of", async () => {
      const body = JSON.stringify({
        type: "email.complained",
        data: { email_id: "re_never_seen" },
      });

      expect(
        await handleWebhook(db, signed(body), { env: ENV, nowSeconds: NOW }),
      ).toEqual({ status: 200, body: { status: "complained", matched: false } });
    });

    it("asks to be retried when there is no API key to read the body with", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await handleWebhook(db, signed(received), {
        env: { RESEND_WEBHOOK_SECRET: SECRET },
        nowSeconds: NOW,
      });

      expect(result.status).toBe(500);
      expect(error).toHaveBeenCalledOnce();
    });

    it("asks to be retried when the API will not hand over the message", async () => {
      // Resend still holds it, and the usual cause is transient.
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await handleWebhook(db, signed(received), {
        env: ENV,
        nowSeconds: NOW,
        fetchImpl: fetchStub(null, 503),
      });

      expect(result.status).toBe(502);
      expect(error).toHaveBeenCalledOnce();
      expect(await listThreads(db, "all")).toHaveLength(0);
    });

    it("reads the real environment by default", async () => {
      // No secret in the test environment, so this is the refusal — the point
      // is that the default argument is wired at all.
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await handleWebhook(db, signed(received))).status).toBe(500);
    });
  });
});
