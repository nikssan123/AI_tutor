import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS } from "@/lib/billing/catalog";
import type { AgentFrame, AgentOutcome } from "@/lib/ai/agent";

/**
 * The Assistant's endpoint. A route handler is a public URL, so most of what is
 * worth testing here is who may reach it and what stops them — "the button was
 * disabled" is not a property of the request that arrives.
 *
 * The rest is the ledger. A loop that spends four requests and reports one is
 * the exact failure the weekly cost review exists to catch, and it would be
 * invisible everywhere else.
 */

const currentSessionMock = vi.fn();
const messagesTodayMock = vi.fn(async (..._a: unknown[]) => 0);
const historyMock = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const threadMock = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const logTurnMock = vi.fn();
const recordRunMock = vi.fn();
const streamAgentMock = vi.fn();
const allowanceMock = vi.fn(async (..._a: unknown[]) => ({
  blocked: false,
  allowanceCents: 100,
  reserveCents: 50,
  spentCents: 0,
}));

vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/ai/client", () => ({ getAnthropic: () => ({}) }));
vi.mock("@/lib/account/session", () => ({
  currentSession: () => currentSessionMock(),
}));
vi.mock("@/lib/ai/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/agent")>()),
  streamAgent: (...a: unknown[]) => streamAgentMock(...(a as [])),
}));
vi.mock("@/lib/assistant/store", () => ({
  assistantHistory: (...a: unknown[]) => historyMock(...(a as [])),
  assistantThread: (...a: unknown[]) => threadMock(...(a as [])),
  logAssistantTurn: (...a: unknown[]) => logTurnMock(...(a as [])),
  messagesToday: (...a: unknown[]) => messagesTodayMock(...(a as [])),
}));
vi.mock("@/lib/ai/runlog", () => ({
  recordAgentRun: (...a: unknown[]) => recordRunMock(...(a as [])),
}));
vi.mock("@/lib/billing/gate", () => ({
  assistantAllowance: (...a: unknown[]) => allowanceMock(...(a as [])),
  overCapMessage: () => "over cap",
}));

const { GET, POST, line, parseBody } = await import("@/app/api/assistant/route");

const META = {
  model: "claude-sonnet-5",
  promptName: "assistant",
  promptVersion: 1,
  attempts: 1,
  usage: {
    inputTokens: 900,
    outputTokens: 30,
    cacheReadInputTokens: 850,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
  },
  costCents: 0.2,
  uncachedCostCents: 0.9,
  latencyMs: 700,
};

function answering(
  frames: AgentFrame[],
  over: Partial<AgentOutcome> = {},
): AsyncGenerator<AgentFrame, AgentOutcome, undefined> {
  return (async function* () {
    for (const frame of frames) yield frame;
    return {
      text: frames
        .filter((frame): frame is { t: "text"; v: string } => frame.t === "text")
        .map((frame) => frame.v)
        .join(""),
      steps: [META],
      refused: false,
      stopped: "end" as const,
      ...over,
    };
  })();
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Every NDJSON line the response carried, parsed. */
async function framesOf(response: Response): Promise<unknown[]> {
  const body = await response.text();
  return body
    .split("\n")
    .filter((raw) => raw !== "")
    .map((raw) => JSON.parse(raw) as unknown);
}

beforeEach(() => {
  vi.clearAllMocks();
  currentSessionMock.mockResolvedValue({
    user: { id: "u1", plan: "pro" },
  });
  messagesTodayMock.mockResolvedValue(0);
  historyMock.mockResolvedValue([]);
  threadMock.mockResolvedValue([]);
  allowanceMock.mockResolvedValue({
    blocked: false,
    allowanceCents: 100,
    reserveCents: 50,
    spentCents: 0,
  });
  streamAgentMock.mockImplementation(() =>
    answering([{ t: "text", v: "Billing does that." }]),
  );
});

describe("parseBody", () => {
  it("takes a message and nothing else", () => {
    expect(parseBody({ message: "hi" })).toEqual({ message: "hi" });
  });

  it("refuses anything that is not a question", () => {
    for (const body of [null, "hi", {}, { message: "" }, { message: "   " }, { message: 4 }]) {
      expect(parseBody(body)).toBeUndefined();
    }
  });

  it("truncates rather than refusing a very long one", () => {
    const parsed = parseBody({ message: "x".repeat(5_000) });
    expect(parsed!.message).toHaveLength(2_000);
  });
});

describe("line", () => {
  it("writes one JSON object per line", () => {
    expect(line({ t: "done" })).toBe('{"t":"done"}\n');
  });

  /** Prose with a newline in it must not frame a second object. */
  it("escapes a newline inside text rather than ending the frame", () => {
    const written = line({ t: "text", v: "one\ntwo" });
    expect(written.split("\n")).toHaveLength(2);
    expect(JSON.parse(written)).toEqual({ t: "text", v: "one\ntwo" });
  });
});


describe("GET", () => {
  it("turns away anyone not signed in", async () => {
    currentSessionMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  /**
   * Fetched on open rather than inlined by the layout: that renders on every
   * signed-in screen, and putting a conversation into every page's HTML would
   * make everybody pay for a thread most never open.
   */
  it("hands back the thread as the panel redraws it", async () => {
    const turns = [
      { role: "user", segments: [{ kind: "text", text: "what am I paying?" }] },
      {
        role: "assistant",
        segments: [
          { kind: "text", text: "Here it is." },
          {
            kind: "view",
            view: { widget: "plan_card", payload: { planId: "pro", renewsOn: null } },
          },
        ],
      },
    ];
    threadMock.mockResolvedValue(turns);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      turns,
      left: PLANS.pro.entitlements.assistantMessagesPerDay,
    });
    expect(threadMock).toHaveBeenCalledWith({}, "u1");
  });

  it("hands back nothing for a learner who has never asked", async () => {
    expect(await (await GET()).json()).toEqual({
      turns: [],
      left: PLANS.pro.entitlements.assistantMessagesPerDay,
    });
  });

  /**
   * So the stop is not a surprise. The route enforces it regardless — this is
   * what lets the panel say "two left" before the wall rather than after it.
   */
  it("says how many questions are left today", async () => {
    messagesTodayMock.mockResolvedValue(2);

    const body = (await (await GET()).json()) as { left: number };
    expect(body.left).toBe(PLANS.pro.entitlements.assistantMessagesPerDay - 2);
  });

  it("never reports fewer than none left", async () => {
    messagesTodayMock.mockResolvedValue(999);

    const body = (await (await GET()).json()) as { left: number };
    expect(body.left).toBe(0);
  });
});

describe("POST", () => {
  it("turns away anyone not signed in", async () => {
    currentSessionMock.mockResolvedValue(null);
    expect((await POST(post({ message: "hi" }))).status).toBe(401);
  });

  it("turns away a request that carries no question", async () => {
    expect((await POST(post({}))).status).toBe(400);
  });

  it("survives a body that is not JSON at all", async () => {
    const request = new Request("http://localhost/api/assistant", {
      method: "POST",
      body: "not json",
    });
    expect((await POST(request)).status).toBe(400);
  });

  /**
   * 429 rather than 402: nothing is over budget and nothing is forbidden. They
   * have asked as much as this plan answers in a day, and tomorrow it is
   * available again.
   */
  it("stops at the day's allowance, and says it starts again tomorrow", async () => {
    messagesTodayMock.mockResolvedValue(
      PLANS.pro.entitlements.assistantMessagesPerDay,
    );

    const response = await POST(post({ message: "hi" }));

    expect(response.status).toBe(429);
    expect(await response.text()).toContain("tomorrow");
    expect(streamAgentMock).not.toHaveBeenCalled();
  });

  it("reads the allowance from the learner's own plan", async () => {
    currentSessionMock.mockResolvedValue({ user: { id: "u1", plan: "free" } });
    messagesTodayMock.mockResolvedValue(
      PLANS.free.entitlements.assistantMessagesPerDay,
    );

    // The same count that is fine on pro is the wall on free.
    expect((await POST(post({ message: "hi" }))).status).toBe(429);
  });

  /**
   * The ceiling with the month's remaining sessions held back, not the cap.
   * The assistant spends from the same ledger the sessions do, so racing them
   * would let a chatty afternoon take the budget a session needed.
   */
  it("refuses once the month's reserved work would be at risk", async () => {
    allowanceMock.mockResolvedValue({
      blocked: true,
      allowanceCents: 58,
      reserveCents: 62,
      spentCents: 60,
    });

    const response = await POST(post({ message: "hi" }));

    expect(response.status).toBe(402);
    expect(await response.text()).toBe("over cap");
    expect(streamAgentMock).not.toHaveBeenCalled();
  });

  it("streams frames and finishes with done", async () => {
    streamAgentMock.mockImplementation(() =>
      answering([
        { t: "tool", label: "Looking that up…" },
        { t: "text", v: "Billing does that." },
      ]),
    );

    const response = await POST(post({ message: "where do I cancel?" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await framesOf(response)).toEqual([
      { t: "tool", label: "Looking that up…" },
      { t: "text", v: "Billing does that." },
      { t: "done" },
    ]);
  });

  it("logs the turn once and the ledger once per model request", async () => {
    streamAgentMock.mockImplementation(() =>
      answering([{ t: "text", v: "ok" }], {
        steps: [META, { ...META, costCents: 0.4 }, { ...META, costCents: 0.1 }],
      }),
    );

    await framesOf(await POST(post({ message: "hi" })));

    expect(logTurnMock).toHaveBeenCalledTimes(1);
    expect(logTurnMock.mock.calls[0]![1]).toMatchObject({
      userId: "u1",
      question: "hi",
      answer: "ok",
    });

    // Three requests, three rows. One averaged row would hide a loop
    // misbehaving from the only review that would catch it.
    expect(recordRunMock).toHaveBeenCalledTimes(3);
  });


  /**
   * The layout is assembled from what is actually sent, not from the outcome:
   * the outcome carries the joined prose and nothing about where the views sat
   * in it, and where they sat is the whole point.
   */
  it("stores the layout, with the views where they arrived", async () => {
    streamAgentMock.mockImplementation(() =>
      answering([
        { t: "text", v: "Here it is." },
        { t: "tool", label: "Checking…" },
        {
          t: "widget",
          name: "plan_card",
          payload: { planId: "pro", renewsOn: null },
        },
        { t: "text", v: " Renews in October." },
      ]),
    );

    await framesOf(await POST(post({ message: "what am I paying?" })));

    const record = logTurnMock.mock.calls[0]![1] as {
      segments: Array<{ kind: string }>;
    };
    expect(record.segments.map((s) => s.kind)).toEqual(["text", "view", "text"]);
  });

  it("stores no layout for an answer that showed nothing", async () => {
    await framesOf(await POST(post({ message: "hi" })));

    const record = logTurnMock.mock.calls[0]![1] as { segments: unknown[] };
    expect(record.segments).toEqual([
      { kind: "text", text: "Billing does that." },
    ]);
  });

  it("records a refused turn as a refusal, and still bills it", async () => {
    streamAgentMock.mockImplementation(() =>
      answering([], { refused: true, stopped: "refusal" }),
    );

    await framesOf(await POST(post({ message: "hi" })));

    expect(recordRunMock).toHaveBeenCalledTimes(1);
    expect(recordRunMock.mock.calls[0]![1]).toMatchObject({ status: "refusal" });
  });

  it("replays the thread before the new question", async () => {
    historyMock.mockResolvedValue([
      { role: "user", content: "earlier" },
      { role: "assistant", content: "answer" },
    ]);

    await framesOf(await POST(post({ message: "and now?" })));

    const call = streamAgentMock.mock.calls[0]![1] as {
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ name: string }>;
    };
    expect(call.messages).toEqual([
      { role: "user", content: "earlier" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "and now?" },
    ]);
    expect(call.tools.map((tool) => tool.name)).toContain("find_page");
  });

  /**
   * The stream has already started, so there is no status code left to change.
   * Saying so in a frame is the only honest option — a silent truncation reads
   * as the assistant trailing off mid-sentence.
   */
  it("says so in a frame when it breaks mid-answer", async () => {
    streamAgentMock.mockImplementation(() =>
      (async function* (): AsyncGenerator<AgentFrame, AgentOutcome, undefined> {
        yield { t: "text", v: "Half a sen" };
        throw new Error("upstream died");
      })(),
    );

    const frames = await framesOf(await POST(post({ message: "hi" })));

    expect(frames[0]).toEqual({ t: "text", v: "Half a sen" });
    expect(frames[1]).toMatchObject({ t: "error" });
    expect(JSON.stringify(frames[1])).toContain("upstream died");
    // Nothing was logged, because nothing finished.
    expect(logTurnMock).not.toHaveBeenCalled();
  });

  it("names an upstream failure that was not an Error", async () => {
    streamAgentMock.mockImplementation(() =>
      (async function* (): AsyncGenerator<AgentFrame, AgentOutcome, undefined> {
        throw "nope";
      })(),
    );

    const frames = await framesOf(await POST(post({ message: "hi" })));
    expect(JSON.stringify(frames[0])).toContain("unknown error");
  });
});
