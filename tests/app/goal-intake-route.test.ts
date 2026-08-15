import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallResult } from "@/lib/ai/call";
import type { AnalyzerTurn } from "@/lib/goals/analyzer";
import {
  OUTCOME_SEPARATOR,
  TURN_FAILED,
  TURN_OK,
} from "@/lib/goals/intake-protocol";

/**
 * The streamed intake turn.
 *
 * A route handler is a public URL, so every guarantee the page makes has to be
 * re-made here. These assert the guards as hard as the happy path: "the screen
 * stopped offering a box" is not a property of the request that arrives.
 */

const currentSessionMock = vi.fn();
const loadIntakeMock = vi.fn();
const saveIntakeMock = vi.fn();
const recordTurnMock = vi.fn();
const analyzerStreamMock = vi.fn();
const runAnalyzerMock = vi.fn();
const logCallMock = vi.fn();

vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/ai/client", () => ({ getAnthropic: () => ({}) }));
vi.mock("@/lib/account/session", () => ({
  currentSession: () => currentSessionMock(),
}));
vi.mock("@/lib/ai/runlog", () => ({
  logCall: (...args: unknown[]) => logCallMock(...args),
}));
// Partial: `turn.ts` is the real thing here, and it reads `shouldFinishNext`
// and `isComplete` out of this module to decide when the analyzer must close.
vi.mock("@/lib/goals/analyzer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/goals/analyzer")>()),
  runAnalyzer: (...args: unknown[]) => runAnalyzerMock(...args),
}));
vi.mock("@/lib/goals/analyzer-stream", () => ({
  analyzerStream: (...args: unknown[]) => analyzerStreamMock(...args),
}));
vi.mock("@/lib/goals/intake-store", () => ({
  loadIntake: (...args: unknown[]) => loadIntakeMock(...args),
  saveIntake: (...args: unknown[]) => saveIntakeMock(...args),
}));
vi.mock("@/lib/goals/turn", async () => {
  // The real context-building and cap logic; only the write is a mock, because
  // the point of these tests is that the route runs the same turn the action
  // does rather than a second copy of it.
  const real =
    await vi.importActual<typeof import("@/lib/goals/turn")>(
      "@/lib/goals/turn",
    );
  return { ...real, recordTurn: (...args: unknown[]) => recordTurnMock(...args) };
});

const { parseBody, POST } = await import("@/app/api/goal-intake/route");

const INTAKE = {
  messages: [],
  captured: null,
  chips: [],
  clarity: 0,
  done: false,
};

const TURN: AnalyzerTurn = {
  reply: "How many hours a week do you have?",
  captured: {
    subject: "Rust",
    matchedPack: null,
    outcomeType: "career",
    statedLevel: "none",
    weeklyHours: null,
    deadline: null,
    motivation: null,
    constraints: [],
    existingAssets: [],
    priorDomain: "none",
    levelSaid: null,
    weeklyHoursSaid: null,
    deadlineSaid: null,
  },
  clarity: 0.4,
  done: false,
  chips: [],
} as AnalyzerTurn;

const OK: CallResult<AnalyzerTurn> = {
  status: "ok",
  value: TURN,
  model: "claude-haiku-4-5-20251001",
  promptName: "goal_analyzer",
  promptVersion: 1,
  attempts: 1,
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
  costCents: 0,
  uncachedCostCents: 0,
  latencyMs: 1,
} as CallResult<AnalyzerTurn>;

/** A generator that yields the given chunks and then returns `result`. */
function streamOf(chunks: string[], result: CallResult<AnalyzerTurn>) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
    return result;
  })();
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/goal-intake", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function readAll(response: Response): Promise<string> {
  return await response.text();
}

beforeEach(() => {
  currentSessionMock.mockResolvedValue({ user: { id: "user-1" } });
  loadIntakeMock.mockResolvedValue({ ...INTAKE });
  saveIntakeMock.mockResolvedValue(undefined);
  logCallMock.mockResolvedValue(undefined);
  recordTurnMock.mockResolvedValue({ ok: true, done: false });
  analyzerStreamMock.mockReturnValue(streamOf(["How many ", "hours?"], OK));
  runAnalyzerMock.mockResolvedValue(OK);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("parseBody", () => {
  it("takes a reply and trims it", () => {
    expect(parseBody({ reply: "  Rust  " })).toEqual({ reply: "Rust" });
  });

  it("caps what one turn can carry", () => {
    const long = "a".repeat(900);
    expect(parseBody({ reply: long })!.reply).toHaveLength(500);
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["a missing reply", {}],
    ["a reply that is not a string", { reply: 7 }],
    ["an empty reply", { reply: "" }],
    ["a reply that is only whitespace", { reply: "   " }],
  ])("rejects %s", (_name, body) => {
    expect(parseBody(body)).toBeUndefined();
  });
});

describe("POST /api/goal-intake", () => {
  it("refuses a request with no session", async () => {
    currentSessionMock.mockResolvedValue(null);
    const response = await POST(post({ reply: "Rust" }));
    expect(response.status).toBe(401);
  });

  it("refuses a body it cannot use", async () => {
    const response = await POST(post({ reply: "" }));
    expect(response.status).toBe(400);
  });

  it("refuses a body that is not JSON at all", async () => {
    const response = await POST(
      new Request("http://localhost/api/goal-intake", {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(response.status).toBe(400);
  });

  /**
   * §24 E3's cap. The screen stops offering a box once the conversation is
   * finished, but this endpoint is reachable without the screen.
   */
  it("refuses a turn on a conversation that is already finished", async () => {
    loadIntakeMock.mockResolvedValue({ ...INTAKE, done: true });
    const response = await POST(post({ reply: "Rust" }));
    expect(response.status).toBe(409);
  });

  it("streams the reply as it is written, then says the turn worked", async () => {
    const response = await POST(post({ reply: "Rust" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    // A streamed turn must never be replayed from a cache.
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(await readAll(response)).toBe(
      `How many hours?${OUTCOME_SEPARATOR}${TURN_OK}`,
    );
  });

  it("bills the turn, streamed or not (§14.8)", async () => {
    await readAll(await POST(post({ reply: "Rust" })));
    expect(logCallMock).toHaveBeenCalledWith({}, "user-1", OK);
  });

  it("carries what they typed into the model's context", async () => {
    await readAll(await POST(post({ reply: "Rust" })));

    const context = analyzerStreamMock.mock.calls[0]![1] as {
      messages: Array<{ r: string; t: string }>;
    };
    expect(context.messages.at(-1)).toEqual({ r: "l", t: "Rust" });
  });

  /**
   * One attempt streamed, then the blocking path — which can retry by telling
   * the model what was wrong, something you cannot do halfway through a
   * sentence already on screen.
   */
  it("falls back to the retrying path when the streamed turn is unusable", async () => {
    analyzerStreamMock.mockReturnValue(
      streamOf(["half a sen"], {
        ...OK,
        status: "invalid",
        detail: "not valid JSON",
      } as CallResult<AnalyzerTurn>),
    );

    const body = await readAll(await POST(post({ reply: "Rust" })));

    expect(runAnalyzerMock).toHaveBeenCalledTimes(1);
    // The verdict is the retried result's, not the abandoned one's.
    expect(body.endsWith(`${OUTCOME_SEPARATOR}${TURN_OK}`)).toBe(true);
    expect(logCallMock).toHaveBeenCalledWith({}, "user-1", OK);
  });

  it("says the turn failed when it could not be recorded", async () => {
    recordTurnMock.mockResolvedValue({ ok: false, done: false });
    const body = await readAll(await POST(post({ reply: "Rust" })));
    expect(body.endsWith(`${OUTCOME_SEPARATOR}${TURN_FAILED}`)).toBe(true);
  });

  /**
   * The turn that closes the conversation streams like any other one.
   *
   * The verdict says whether the turn worked and nothing else — where the
   * learner ends up is the refreshed page's business, and that page is what
   * knows there is a button on it now.
   */
  it("says nothing extra about the turn that ends the conversation", async () => {
    recordTurnMock.mockResolvedValue({ ok: true, done: true });
    const body = await readAll(await POST(post({ reply: "Rust" })));
    expect(body.endsWith(`${OUTCOME_SEPARATOR}${TURN_OK}`)).toBe(true);
  });

  /**
   * A failure that was never theirs must not cost them what they typed — the
   * conversation is saved one message longer, ending on them, and the client
   * is told to land on the banner.
   */
  it("keeps what they typed when the call throws", async () => {
    analyzerStreamMock.mockImplementation(() => {
      throw new Error("the model is down");
    });

    const body = await readAll(await POST(post({ reply: "Rust" })));

    expect(body).toBe(`${OUTCOME_SEPARATOR}${TURN_FAILED}`);
    expect(saveIntakeMock).toHaveBeenCalledWith({}, "user-1", {
      ...INTAKE,
      messages: [{ r: "l", t: "Rust" }],
    });
  });

  it("is never statically cached", async () => {
    const { dynamic } = await import("@/app/api/goal-intake/route");
    expect(dynamic).toBe("force-dynamic");
  });
});
