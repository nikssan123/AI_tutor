import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/billing/webhook`, which is deliberately thin.
 *
 * Everything it decides lives in `lib/billing/stripe/receive.ts` and is tested
 * against a real database there. What is left to assert is the part only the
 * route can get wrong: reading the **raw** body rather than parsed JSON, and
 * passing the signature through under the name Stripe uses.
 */

const receiveWebhookMock = vi.fn();
const appDb = { marker: "db" };

vi.mock("@/db", () => ({ getDb: () => appDb }));
vi.mock("@/lib/billing/stripe/receive", () => ({
  receiveWebhook: (...args: unknown[]) => receiveWebhookMock(...args),
}));

const { POST } = await import("@/app/api/billing/webhook/route");

const BODY = '{"id":"evt_1","type":"invoice.paid","data":{"object":{}}}';

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://meritkeep.com/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1800000000,v1=abcd", ...headers },
    body: BODY,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  receiveWebhookMock.mockResolvedValue({
    status: 200,
    body: { status: "handled", event: "invoice.paid" },
  });
});

describe("POST /api/billing/webhook", () => {
  it("passes the body through exactly as received", async () => {
    // Stripe signs the exact bytes. Re-serialising parsed JSON reorders keys
    // and changes spacing, leaving nothing to check the signature against.
    await POST(request());

    expect(receiveWebhookMock.mock.calls[0]![0]).toBe(appDb);
    expect(receiveWebhookMock.mock.calls[0]![1].body).toBe(BODY);
  });

  it("passes the signature under the header Stripe sends it in", async () => {
    await POST(request());
    expect(receiveWebhookMock.mock.calls[0]![1].signature).toBe(
      "t=1800000000,v1=abcd",
    );
  });

  it("reports a missing signature as null rather than inventing one", async () => {
    const bare = new Request("https://meritkeep.com/api/billing/webhook", {
      method: "POST",
      body: BODY,
    });

    await POST(bare);
    expect(receiveWebhookMock.mock.calls[0]![1].signature).toBeNull();
  });

  it("answers with the status the handler chose", async () => {
    // The status is an instruction to Stripe — it retries anything that is not
    // 2xx, with backoff, for up to three days.
    receiveWebhookMock.mockResolvedValue({
      status: 400,
      body: { error: "signature did not match" },
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "signature did not match" });
  });
});
