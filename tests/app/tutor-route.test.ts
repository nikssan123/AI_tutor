import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The streaming endpoint. A route handler is a public URL, so the tests that
 * matter are the ones about who is allowed to reach it — "the page checked" is
 * not a property of the request that arrives here.
 */

const currentSessionMock = vi.fn();
const sessionViewMock = vi.fn();
const noteTurnMock = vi.fn();
const transcriptMock = vi.fn();
const tutorStreamMock = vi.fn();
const logTurnMock = vi.fn();
const recordRunMock = vi.fn();
const turnsTakenMock = vi.fn(async (..._a: unknown[]) => 0);
const aiAccessMock = vi.fn(async (..._a: unknown[]) => ({
  overCap: false,
  degraded: false,
  blocked: false,
  spentCents: 0,
  capCents: 150,
}));

vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/ai/client", () => ({ getAnthropic: () => ({}) }));
vi.mock("@/lib/account/session", () => ({
  currentSession: () => currentSessionMock(),
}));
vi.mock("@/lib/session/view", () => ({
  sessionView: (...a: unknown[]) => sessionViewMock(...(a as [])),
}));
vi.mock("@/lib/session/signals", () => ({
  noteTurn: (...a: unknown[]) => noteTurnMock(...(a as [])),
}));
vi.mock("@/lib/session/tutor", () => ({
  transcriptFor: (...a: unknown[]) => transcriptMock(...(a as [])),
  tutorStream: (...a: unknown[]) => tutorStreamMock(...(a as [])),
  logTurn: (...a: unknown[]) => logTurnMock(...(a as [])),
  turnsTaken: (...a: unknown[]) => turnsTakenMock(...(a as [])),
  MAX_TUTOR_TURNS: 30,
}));
vi.mock("@/lib/ai/runlog", () => ({
  recordAgentRun: (...a: unknown[]) => recordRunMock(...(a as [])),
}));
vi.mock("@/lib/billing/gate", () => ({
  aiAccess: (...a: unknown[]) => aiAccessMock(...(a as [])),
  overCapMessage: () => "over cap",
}));

const { POST, parseBody } = await import("@/app/api/tutor/route");

const META = {
  model: "claude-sonnet-5",
  promptName: "tutor",
  promptVersion: 1,
  attempts: 1,
  usage: {
    inputTokens: 1_200,
    outputTokens: 30,
    cacheReadInputTokens: 1_150,
    cacheCreationInputTokens: 0,
  },
  costCents: 0.2,
  uncachedCostCents: 0.9,
  latencyMs: 700,
};

async function* answering(chunks: string[], refused = false) {
  for (const chunk of chunks) yield chunk;
  return { text: chunks.join(""), refused, meta: META };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/tutor", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentSessionMock.mockResolvedValue({ user: { id: "u1" } });
  sessionViewMock.mockResolvedValue({
    session: { id: "sess-1" },
    goal: { packSlug: "sql-data-analysis" },
    block: undefined,
    learnerContext: "## Learner",
  });
  noteTurnMock.mockResolvedValue("none");
  transcriptMock.mockResolvedValue([]);
  tutorStreamMock.mockReturnValue(answering(["Because ", "of the grain."]));
});

describe("POST /api/tutor", () => {
  it("streams the answer and logs the turn", async () => {
    const response = await POST(post({ sessionId: "sess-1", message: "why?" }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Because of the grain.");
    expect(logTurnMock).toHaveBeenCalledOnce();
    expect(recordRunMock.mock.calls[0]![1]).toMatchObject({ status: "ok" });
  });

  it("logs a refusal as one", async () => {
    tutorStreamMock.mockReturnValue(answering(["No."], true));
    await (await POST(post({ sessionId: "s", message: "m" }))).text();
    expect(recordRunMock.mock.calls[0]![1]).toMatchObject({ status: "refusal" });
  });

  it("turns away a signed-out caller", async () => {
    currentSessionMock.mockResolvedValue(null);
    expect((await POST(post({ sessionId: "s", message: "m" }))).status).toBe(401);
    expect(tutorStreamMock).not.toHaveBeenCalled();
  });

  it("answers 404 for someone else's session", async () => {
    // `sessionView` scopes by user id, so a stranger's id and a made-up id get
    // the same answer. No id is confirmed to exist by a 403.
    sessionViewMock.mockResolvedValue(undefined);
    expect((await POST(post({ sessionId: "s", message: "m" }))).status).toBe(404);
  });

  it("rejects a body it cannot use", async () => {
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({ sessionId: "s" }))).status).toBe(400);
    expect((await POST(post({ sessionId: "s", message: "   " }))).status).toBe(400);
  });

  it("says so in the body when the stream dies mid-answer", async () => {
    // The response has already started, so there is no status code left to
    // change; a silent truncation reads as the tutor trailing off.
    tutorStreamMock.mockReturnValue(
      (async function* () {
        yield "Star";
        throw new Error("upstream gone");
      })(),
    );

    const text = await (await POST(post({ sessionId: "s", message: "m" }))).text();
    expect(text).toContain("Star");
    expect(text).toContain("upstream gone");
    expect(logTurnMock).not.toHaveBeenCalled();
  });

  it("reports a non-Error failure without crashing", async () => {
    tutorStreamMock.mockReturnValue(
      (async function* () {
        yield "x";
        throw "just a string";
      })(),
    );

    expect(
      await (await POST(post({ sessionId: "s", message: "m" }))).text(),
    ).toContain("unknown error");
  });
});

describe("parseBody", () => {
  it("caps the message rather than forwarding whatever was sent", () => {
    const parsed = parseBody({ sessionId: "s", message: "x".repeat(9_000) });
    expect(parsed!.message.length).toBeLessThanOrEqual(2_000);
  });

  it("refuses anything that is not an object with both fields", () => {
    expect(parseBody(null)).toBeUndefined();
    expect(parseBody("string")).toBeUndefined();
    expect(parseBody({ sessionId: "", message: "m" })).toBeUndefined();
    expect(parseBody({ sessionId: "s", message: 5 })).toBeUndefined();
  });
});

/**
 * PLAN-ADAPTATION step 3 — the classification runs after the answer, and the
 * answer is what the learner is owed.
 */
describe("tutor signals on the streamed turn", () => {
  it("classifies the exchange once the answer has been delivered", async () => {
    const response = await POST(
      post({ sessionId: "sess-1", message: "I don't follow" }),
    );
    // The stream's `start` only runs once the body is pulled, so the turn is
    // not classified until the learner has actually been sent the answer.
    await response.text();

    expect(noteTurnMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        userId: "u1",
        sessionId: "sess-1",
        packSlug: "sql-data-analysis",
        question: "I don't follow",
        answer: "Because of the grain.",
      }),
    );
  });

  it("delivers the answer whole even when the classification falls over", async () => {
    noteTurnMock.mockRejectedValue(new Error("haiku is down"));

    const response = await POST(post({ sessionId: "sess-1", message: "why?" }));

    // The learner asked a question and got an answer. A label they will never
    // see failing must not turn that into an error message.
    expect(await response.text()).toBe("Because of the grain.");
  });
});

describe("the limits the tutor is subject to", () => {
  it("stops a conversation at thirty turns", async () => {
    // §14.9.7 limit 4, and §17.2's "DON'T BUILD: a general chatbot — the tutor
    // is scoped to the session". 409 rather than 403: nothing is forbidden,
    // the conversation is simply finished.
    turnsTakenMock.mockResolvedValue(30);

    const response = await POST(post({ sessionId: "sess-1", message: "why?" }));
    expect(response.status).toBe(409);
    expect(await response.text()).toMatch(/thirty questions/);
    expect(tutorStreamMock).not.toHaveBeenCalled();
  });

  it("lets the thirtieth through", async () => {
    turnsTakenMock.mockResolvedValue(29);
    const response = await POST(post({ sessionId: "sess-1", message: "why?" }));
    expect(response.status).toBe(200);
  });

  it("refuses when the month's ceiling is reached", async () => {
    // The tutor is the highest-volume spender in the product and was, until
    // E13, the largest thing the cap did not cover: it recorded every cent and
    // nothing ever read the total back. 402 — payment is exactly what is
    // required.
    aiAccessMock.mockResolvedValue({
      overCap: true,
      degraded: true,
      blocked: true,
      spentCents: 150,
      capCents: 150,
    });

    const response = await POST(post({ sessionId: "sess-1", message: "why?" }));
    expect(response.status).toBe(402);
    expect(tutorStreamMock).not.toHaveBeenCalled();
  });

  it("checks the turn count before the ceiling", async () => {
    // Cheaper, and a better message: somebody who has simply talked a lot
    // should be told that, not sold a subscription.
    turnsTakenMock.mockResolvedValue(30);
    aiAccessMock.mockResolvedValue({
      overCap: true,
      degraded: true,
      blocked: true,
      spentCents: 150,
      capCents: 150,
    });

    expect((await POST(post({ sessionId: "sess-1", message: "why?" }))).status).toBe(409);
  });
});
