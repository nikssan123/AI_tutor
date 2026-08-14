import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/email/inbound`, which is deliberately thin.
 *
 * Everything it decides lives in `lib/mail/webhook.ts` and is tested against a
 * real database there. What is left to assert is the part only the route can
 * get wrong: reading the **raw** body rather than parsed JSON, and passing the
 * three signature headers through under the names Svix uses.
 */

const handleWebhookMock = vi.fn();
const appDb = { marker: "db" };

vi.mock("@/db", () => ({ getDb: () => appDb }));
vi.mock("@/lib/mail/webhook", () => ({
  handleWebhook: (...args: unknown[]) => handleWebhookMock(...args),
}));

const { POST } = await import("@/app/api/email/inbound/route");

const BODY = '{"type":"email.received","data":{"email_id":"re_1"}}';

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://meritkeep.com/api/email/inbound", {
    method: "POST",
    headers: {
      "svix-id": "msg_1",
      "svix-timestamp": "1800000000",
      "svix-signature": "v1,abcd",
      ...headers,
    },
    body: BODY,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  handleWebhookMock.mockResolvedValue({ status: 200, body: { stored: true } });
});

describe("POST /api/email/inbound", () => {
  it("passes the body through exactly as received", async () => {
    // The signature covers the exact bytes. Re-serialising parsed JSON
    // reorders keys and changes spacing, leaving nothing to check it against.
    await POST(request());

    expect(handleWebhookMock.mock.calls[0]![0]).toBe(appDb);
    expect(handleWebhookMock.mock.calls[0]![1].body).toBe(BODY);
  });

  it("passes the three signature headers under their own names", async () => {
    await POST(request());

    expect(handleWebhookMock.mock.calls[0]![1].headers).toEqual({
      id: "msg_1",
      timestamp: "1800000000",
      signature: "v1,abcd",
    });
  });

  it("reports a missing header as null rather than inventing one", async () => {
    const bare = new Request("https://meritkeep.com/api/email/inbound", {
      method: "POST",
      body: BODY,
    });

    await POST(bare);
    expect(handleWebhookMock.mock.calls[0]![1].headers).toEqual({
      id: null,
      timestamp: null,
      signature: null,
    });
  });

  it("answers with the status the handler chose", async () => {
    // The status is an instruction to Resend — it retries anything that is not
    // 2xx and keeps the message while it does.
    handleWebhookMock.mockResolvedValue({
      status: 401,
      body: { error: "signature did not match" },
    });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "signature did not match" });
  });
});
