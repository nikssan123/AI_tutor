import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  fetchReceivedEmail,
  parseWebhook,
  textFromHtml,
  TIMESTAMP_TOLERANCE_SECONDS,
  verifyWebhook,
} from "@/lib/mail/inbound";
import { threadHeaders } from "@/lib/mail/send";
import type { MessageRow } from "@/lib/mail/store";

/**
 * The wire protocol: what Resend sends us and what we believe.
 *
 * The signature tests are the security-critical ones. `/api/email/inbound` is a
 * public endpoint that writes to the database, so anything that gets past
 * `verifyWebhook` can file a support request from any address it likes —
 * including one belonging to a real account — and get an operator to answer it.
 */

const SECRET = `whsec_${Buffer.from("a-signing-key").toString("base64")}`;
const NOW = 1_800_000_000;

function sign(body: string, id = "msg_1", timestamp = String(NOW)): string {
  const key = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
  const digest = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return `v1,${digest}`;
}

function headers(body: string, overrides: Partial<Record<string, string | null>> = {}) {
  return {
    id: "msg_1",
    timestamp: String(NOW),
    signature: sign(body),
    ...overrides,
  } as { id: string | null; timestamp: string | null; signature: string | null };
}

describe("verifyWebhook", () => {
  const body = '{"type":"email.received"}';

  it("accepts a correctly signed request", () => {
    expect(verifyWebhook(SECRET, headers(body), body, NOW)).toEqual({ ok: true });
  });

  it("accepts a secret written without the whsec_ prefix", () => {
    const bare = SECRET.replace(/^whsec_/, "");
    expect(verifyWebhook(bare, headers(body), body, NOW)).toEqual({ ok: true });
  });

  it("accepts the right signature among several candidates", () => {
    // Svix sends more than one during a secret rotation.
    const signature = `v1,${Buffer.from("wrong").toString("base64")} ${sign(body)}`;
    expect(
      verifyWebhook(SECRET, headers(body, { signature }), body, NOW),
    ).toEqual({ ok: true });
  });

  it.each([
    ["id", { id: null }],
    ["timestamp", { timestamp: null }],
    ["signature", { signature: null }],
  ])("refuses a request with no %s header", (_name, overrides) => {
    const result = verifyWebhook(SECRET, headers(body, overrides), body, NOW);
    expect(result).toEqual({ ok: false, reason: "missing signature headers" });
  });

  it("refuses a timestamp that is not a number", () => {
    expect(
      verifyWebhook(SECRET, headers(body, { timestamp: "soon" }), body, NOW),
    ).toEqual({ ok: false, reason: "bad timestamp" });
  });

  it.each([
    ["too old", -(TIMESTAMP_TOLERANCE_SECONDS + 1)],
    ["too new", TIMESTAMP_TOLERANCE_SECONDS + 1],
  ])("refuses a request whose clock is %s", (_name, drift) => {
    // Bounds replay: a captured request stops working before anyone can do
    // much with it, and a retry from a delayed queue still lands.
    const timestamp = String(NOW + drift);
    const result = verifyWebhook(
      SECRET,
      { id: "msg_1", timestamp, signature: sign(body, "msg_1", timestamp) },
      body,
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: "timestamp outside tolerance" });
  });

  it("accepts one right at the edge of the tolerance", () => {
    const timestamp = String(NOW - TIMESTAMP_TOLERANCE_SECONDS);
    expect(
      verifyWebhook(
        SECRET,
        { id: "msg_1", timestamp, signature: sign(body, "msg_1", timestamp) },
        body,
        NOW,
      ),
    ).toEqual({ ok: true });
  });

  it("refuses a body that was changed after signing", () => {
    // Which is why the route reads `request.text()` and parses afterwards:
    // re-serialising parsed JSON reorders keys and breaks the signature.
    const result = verifyWebhook(SECRET, headers(body), `${body} `, NOW);
    expect(result).toEqual({ ok: false, reason: "signature did not match" });
  });

  it("refuses a signature signed with a different secret", () => {
    const other = `whsec_${Buffer.from("someone-elses-key").toString("base64")}`;
    expect(verifyWebhook(other, headers(body), body, NOW).ok).toBe(false);
  });

  it.each([
    ["an unknown version", "v2,abcd"],
    ["no version at all", "abcd"],
    ["a signature of the wrong length", "v1,YWJj"],
  ])("refuses %s", (_name, signature) => {
    // The length guard is required rather than an optimisation:
    // `timingSafeEqual` throws on a mismatch instead of returning false.
    expect(
      verifyWebhook(SECRET, headers(body, { signature }), body, NOW).ok,
    ).toBe(false);
  });

  it("defaults its clock to now", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(
      verifyWebhook(SECRET, {
        id: "msg_1",
        timestamp,
        signature: sign(body, "msg_1", timestamp),
      }, body).ok,
    ).toBe(true);
  });
});

describe("parseWebhook", () => {
  it("reads a received email down to its id", () => {
    // The payload is metadata only — Resend does not put the body in a webhook
    // — so reading nothing but the id means a shape change cannot break this.
    expect(
      parseWebhook({
        type: "email.received",
        created_at: "2026-08-14T10:00:00Z",
        data: { email_id: "re_1", from: "a@b.co", subject: "Hi" },
      }),
    ).toEqual({ kind: "received", emailId: "re_1" });
  });

  it.each([
    ["email.bounced", "bounced"],
    ["email.complained", "complained"],
  ])("reads %s as a delivery outcome", (type, status) => {
    expect(
      parseWebhook({ type, data: { email_id: "re_2", reason: "mailbox full" } }),
    ).toEqual({ kind: "delivery", emailId: "re_2", status, reason: "mailbox full" });
  });

  it("accepts a delivery event with no reason", () => {
    expect(parseWebhook({ type: "email.bounced", data: { email_id: "re_2" } })).toEqual(
      { kind: "delivery", emailId: "re_2", status: "bounced", reason: null },
    );
  });

  it("falls back to a plain id field", () => {
    expect(parseWebhook({ type: "email.received", data: { id: "re_3" } })).toEqual({
      kind: "received",
      emailId: "re_3",
    });
  });

  it("ignores an event type it does not act on", () => {
    expect(parseWebhook({ type: "email.opened", data: { email_id: "re_4" } })).toEqual({
      kind: "ignored",
      name: "email.opened",
    });
  });

  it("ignores an event with no id, whatever its type", () => {
    expect(parseWebhook({ type: "email.received", data: {} })).toEqual({
      kind: "ignored",
      name: "email.received",
    });
    expect(parseWebhook({ type: "email.received" })).toEqual({
      kind: "ignored",
      name: "email.received",
    });
    expect(parseWebhook({ type: "x", data: { email_id: "" } })).toEqual({
      kind: "ignored",
      name: "x",
    });
  });

  it.each([[null], ["a string"], [{}], [{ type: 7 }]])(
    "rejects %o outright",
    (payload) => {
      expect(parseWebhook(payload)).toBeNull();
    },
  );
});

describe("fetchReceivedEmail", () => {
  const full = {
    id: "re_1",
    from: "Ana <ana@x.co>",
    to: ["support+t1@meritkeep.com"],
    received_for: ["support@meritkeep.com"],
    subject: "Broken login",
    text: "It will not let me in.",
    html: "<p>It will not let me in.</p>",
    message_id: "<abc@x.co>",
    headers: {
      "In-Reply-To": "<earlier@meritkeep.com>",
      References: "<one@x.co> <two@x.co>",
    },
  };

  function stub(response: () => Response) {
    return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response());
  }

  it("asks the right URL with the API key", () => {
    const fetchImpl = stub(() => Response.json(full));
    void fetchReceivedEmail("re_1", "re_key", fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails/receiving/re_1");
    expect((init!.headers as Record<string, string>).authorization).toBe(
      "Bearer re_key",
    );
  });

  it("reads every field the thread needs", async () => {
    const email = await fetchReceivedEmail("re_1", "k", stub(() => Response.json(full)));

    expect(email).toEqual({
      id: "re_1",
      from: "Ana <ana@x.co>",
      // `received_for` is where the token lives when a forwarding rule
      // rewrote the visible `to`.
      to: ["support+t1@meritkeep.com", "support@meritkeep.com"],
      subject: "Broken login",
      text: "It will not let me in.",
      html: "<p>It will not let me in.</p>",
      messageId: "<abc@x.co>",
      inReplyTo: "<earlier@meritkeep.com>",
      references: ["<one@x.co>", "<two@x.co>"],
    });
  });

  it("copes with a sparse response", async () => {
    const email = await fetchReceivedEmail(
      "re_9",
      "k",
      stub(() => Response.json({})),
    );

    expect(email.id).toBe("re_9");
    expect(email.subject).toBe("(no subject)");
    expect(email.text).toBeNull();
    expect(email.to).toEqual([]);
    expect(email.messageId).toBeNull();
    expect(email.references).toEqual([]);
  });

  it("reads a single recipient given as a string", async () => {
    const email = await fetchReceivedEmail(
      "re_9",
      "k",
      stub(() => Response.json({ to: "one@x.co", headers: 7 })),
    );
    expect(email.to).toEqual(["one@x.co"]);
    expect(email.inReplyTo).toBeNull();
  });

  it("finds a header whatever its capitalisation", async () => {
    const email = await fetchReceivedEmail(
      "re_9",
      "k",
      stub(() => Response.json({ headers: { "MESSAGE-ID": "<x@y>" } })),
    );
    expect(email.messageId).toBe("<x@y>");
  });

  it("throws with the API's own explanation", async () => {
    await expect(
      fetchReceivedEmail(
        "re_1",
        "k",
        stub(() => new Response("no such email", { status: 404 })),
      ),
    ).rejects.toThrow(/404.*no such email/);
  });

  it("still throws when the error body cannot be read", async () => {
    const response = new Response(null, { status: 500 });
    vi.spyOn(response, "text").mockRejectedValue(new Error("stream broken"));

    await expect(
      fetchReceivedEmail("re_1", "k", stub(() => response)),
    ).rejects.toThrow(/500.*no response body/);
  });

  it("defaults to the platform fetch", () => {
    // Constructing the call is enough: the default is what production uses,
    // and a typo in it would only show up on the first real inbound message.
    expect(() => void fetchReceivedEmail("re_1", "k")).not.toThrow();
  });
});

describe("textFromHtml", () => {
  it("keeps the words and the paragraph breaks", () => {
    expect(
      textFromHtml("<p>One.</p><p>Two.<br>Three.</p>"),
    ).toBe("One.\n\nTwo.\nThree.");
  });

  it("drops script and style content entirely", () => {
    expect(textFromHtml("<style>p{color:red}</style><p>Hi</p><script>x()</script>")).toBe(
      "Hi",
    );
  });

  it("decodes the entities a mail client actually emits", () => {
    expect(textFromHtml("<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;&nbsp;f</p>")).toBe(
      `a & b <c> "d" 'e' f`,
    );
  });

  it("is empty for an empty document", () => {
    expect(textFromHtml("")).toBe("");
  });
});

describe("threadHeaders", () => {
  function message(messageId: string | null): MessageRow {
    return { messageId } as MessageRow;
  }

  it("points at the most recent message and lists them all", () => {
    expect(
      threadHeaders([message("<one@x.co>"), message("<two@x.co>")]),
    ).toEqual({
      "In-Reply-To": "<two@x.co>",
      References: "<one@x.co> <two@x.co>",
    });
  });

  it("gives up rather than failing when nothing carried an id", () => {
    // These headers only make the conversation look right in the recipient's
    // client. Threading itself rides on the reply-to token.
    expect(threadHeaders([])).toBeUndefined();
    expect(threadHeaders([message(null)])).toBeUndefined();
  });
});
