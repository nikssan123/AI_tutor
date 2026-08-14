import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliver,
  getTransport,
  LogTransport,
  MemoryTransport,
  ResendTransport,
  resolveTransport,
  sendMessage,
  setTransport,
} from "@/lib/email";

const message = {
  to: "a@b.co",
  subject: "Confirm your email",
  text: "Confirm: https://x.test/v",
  html: "<div>Confirm</div>",
};

afterEach(() => {
  setTransport(undefined);
  vi.restoreAllMocks();
});

describe("MemoryTransport", () => {
  it("records instead of sending, and can be emptied", async () => {
    const transport = new MemoryTransport();
    await transport.send(message);
    expect(transport.sent).toEqual([message]);

    transport.clear();
    expect(transport.sent).toEqual([]);
  });
});

describe("LogTransport", () => {
  it("prints the whole body, not just that a mail would have been sent", async () => {
    // The body holds the link. A local environment that says "email sent" and
    // shows nothing is one where nobody ever exercises verification.
    const lines: string[] = [];
    await new LogTransport((line) => lines.push(line)).send(message);

    expect(lines[0]).toContain("a@b.co");
    expect(lines[0]).toContain("Confirm your email");
    expect(lines[0]).toContain("https://x.test/v");
  });

  it("says why it did not send", async () => {
    const lines: string[] = [];
    await new LogTransport((line) => lines.push(line)).send(message);
    expect(lines[0]).toContain("RESEND_API_KEY");
  });

  it("writes to console.info when given no writer", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await new LogTransport().send(message);
    expect(info).toHaveBeenCalledOnce();
  });
});

describe("ResendTransport", () => {
  function stubFetch(response: () => Response | Promise<Response>) {
    return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      response(),
    );
  }

  it("posts the message to Resend with both bodies", async () => {
    const fetchImpl = stubFetch(() => new Response("{}", { status: 200 }));
    await new ResendTransport("re_key", "u <a@b.co>", fetchImpl).send(message);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init!.method).toBe("POST");
    expect(
      (init!.headers as Record<string, string>).authorization,
    ).toBe("Bearer re_key");

    expect(JSON.parse(init!.body as string)).toEqual({
      from: "u <a@b.co>",
      to: ["a@b.co"],
      subject: "Confirm your email",
      text: "Confirm: https://x.test/v",
      html: "<div>Confirm</div>",
    });
  });

  it("puts Resend's own explanation in the error", async () => {
    // The status code alone sends whoever reads the log to the dashboard to
    // learn what the response body already said.
    const fetchImpl = stubFetch(
      () => new Response("The domain is not verified", { status: 403 }),
    );

    await expect(
      new ResendTransport("k", "f", fetchImpl).send(message),
    ).rejects.toThrow(/403.*domain is not verified/);
  });

  it("still reports the failure when the body cannot be read", async () => {
    const response = new Response(null, { status: 500 });
    vi.spyOn(response, "text").mockRejectedValue(new Error("stream broken"));
    const fetchImpl = stubFetch(() => response);

    await expect(
      new ResendTransport("k", "f", fetchImpl).send(message),
    ).rejects.toThrow(/500.*no response body/);
  });

  it("defaults to the platform fetch", () => {
    // Constructing is enough: the default is what production uses, and a typo
    // in it would only show up on the first real send.
    expect(() => new ResendTransport("k", "f")).not.toThrow();
  });
});

describe("resolveTransport", () => {
  it("logs to the console when no key is configured", () => {
    expect(resolveTransport({}).name).toBe("log");
  });

  it("reads the real environment by default", () => {
    // process.env has no RESEND_API_KEY under test, so this is the log
    // transport — the point is that the default argument is wired at all.
    expect(resolveTransport().name).toBe("log");
  });

  it("uses Resend once a key is present", () => {
    expect(
      resolveTransport({ RESEND_API_KEY: "k", EMAIL_FROM: "u <a@b.co>" }).name,
    ).toBe("resend");
  });

  it("refuses a key with no from address rather than guessing one", () => {
    // Resend rejects an unverified `from`, so a guessed default would turn a
    // missing variable into silently undelivered password resets.
    expect(() => resolveTransport({ RESEND_API_KEY: "k" })).toThrow(
      /EMAIL_FROM/,
    );
  });
});

describe("getTransport", () => {
  beforeEach(() => setTransport(undefined));

  it("caches the resolved transport", () => {
    expect(getTransport()).toBe(getTransport());
  });

  it("takes an override, and drops it again", () => {
    const memory = new MemoryTransport();
    setTransport(memory);
    expect(getTransport()).toBe(memory);

    setTransport(undefined);
    expect(getTransport()).not.toBe(memory);
  });
});

describe("deliver", () => {
  it("reports success", async () => {
    const memory = new MemoryTransport();
    setTransport(memory);

    expect(await deliver(message)).toBe(true);
    expect(memory.sent).toEqual([message]);
  });

  it("swallows a transport failure so the auth flow survives it", async () => {
    // A sign-up that 500s because the mail provider is down leaves someone
    // with no account and no explanation. A lost verification email leaves
    // them signed in with a resend button.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setTransport({
      name: "broken",
      send: () => Promise.reject(new Error("Resend is down")),
    });

    expect(await deliver(message)).toBe(false);
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]![0])).toContain("a@b.co");
  });
});

/**
 * What `/admin/mail` needs and auth does not: which message this was, and
 * whether it actually left.
 */
describe("the envelope", () => {
  function stubFetch(response: () => Response | Promise<Response>) {
    return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      response(),
    );
  }

  function bodyOf(fetchImpl: ReturnType<typeof stubFetch>) {
    return JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
  }

  it("lets a message override the configured sender", async () => {
    // Support mail comes from the mailbox a person watches; auth mail keeps
    // the configured default.
    const fetchImpl = stubFetch(() => Response.json({ id: "re_1" }));
    await new ResendTransport("k", "Auth <a@b.co>", fetchImpl).send({
      ...message,
      from: "Support <s@b.co>",
    });

    expect(bodyOf(fetchImpl).from).toBe("Support <s@b.co>");
  });

  it("sends reply-to and custom headers only when they exist", async () => {
    const bare = stubFetch(() => Response.json({ id: "re_1" }));
    await new ResendTransport("k", "f", bare).send(message);
    expect(bodyOf(bare)).not.toHaveProperty("reply_to");
    expect(bodyOf(bare)).not.toHaveProperty("headers");

    const full = stubFetch(() => Response.json({ id: "re_2" }));
    await new ResendTransport("k", "f", full).send({
      ...message,
      replyTo: "support+t1@meritkeep.com",
      headers: { "In-Reply-To": "<x@y>" },
    });

    expect(bodyOf(full).reply_to).toBe("support+t1@meritkeep.com");
    expect(bodyOf(full).headers).toEqual({ "In-Reply-To": "<x@y>" });
  });

  it("returns the provider id, which is what a bounce is keyed on", async () => {
    const fetchImpl = stubFetch(() => Response.json({ id: "re_abc" }));
    expect(
      await new ResendTransport("k", "f", fetchImpl).send(message),
    ).toBe("re_abc");
  });

  it.each([
    ["a body that is not JSON", () => new Response("ok", { status: 200 })],
    ["a body with no id", () => Response.json({ ok: true })],
    ["an id that is not a string", () => Response.json({ id: 7 })],
  ])("accepts a send with %s", async (_name, response) => {
    // The API has already accepted the message. Failing here would report a
    // delivered email as failed, which is the worse of the two wrong answers.
    await expect(
      new ResendTransport("k", "f", stubFetch(response)).send(message),
    ).resolves.toBeUndefined();
  });

  it("names the messages it recorded, so a test can find one", async () => {
    const memory = new MemoryTransport();
    expect(await memory.send(message)).toBe("memory-1");
    expect(await memory.send(message)).toBe("memory-2");
  });

  it("prints the sender and reply address when a message carries them", () => {
    const lines: string[] = [];
    new LogTransport((line) => lines.push(line)).send({
      ...message,
      from: "Support <s@b.co>",
      replyTo: "support+t1@meritkeep.com",
    });

    expect(lines[0]).toContain("Support <s@b.co>");
    expect(lines[0]).toContain("support+t1@meritkeep.com");
  });
});

describe("sendMessage", () => {
  it("reports the provider id on success", async () => {
    const memory = new MemoryTransport();
    setTransport(memory);

    expect(await sendMessage(message)).toEqual({ ok: true, id: "memory-1" });
  });

  it("reports null when the transport has no id to give", async () => {
    setTransport(new LogTransport(() => {}));
    expect(await sendMessage(message)).toEqual({ ok: true, id: null });
  });

  it("hands the failure back rather than swallowing it", async () => {
    // The opposite contract from `deliver`: a support reply that failed
    // silently is a person who thinks they have been answered and has not been.
    setTransport({
      name: "broken",
      send: () => Promise.reject(new Error("Resend is down")),
    });

    expect(await sendMessage(message)).toEqual({
      ok: false,
      error: "Resend is down",
    });
  });

  it("survives a rejection that is not an Error", async () => {
    setTransport({ name: "odd", send: () => Promise.reject("nope") });
    expect(await sendMessage(message)).toEqual({ ok: false, error: "nope" });
  });
});
