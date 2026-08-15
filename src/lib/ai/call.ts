import type Anthropic from "@anthropic-ai/sdk";
import {
  MODELS,
  STEP_EFFORT,
  STEP_MODELS,
  degrade,
  supportsAdaptiveThinking,
  type ModelTier,
} from "./models";
import { costCentsFor, uncachedCostCentsFor } from "./pricing";

/**
 * One structured call to a model, with the parts §14 refuses to leave to a
 * prompt: model routing, the cache breakpoint, the schema retry, and the
 * numbers an `AgentRun` row needs.
 *
 * **Structured output comes from tool use, and the schema is enforced twice.**
 * The JSON Schema on the tool is what the model is steered by; the caller's Zod
 * contract is what actually decides whether the result is usable. Structured
 * outputs cannot express half of what §14.9.2's contracts assert — array
 * lengths, string bounds, numeric floors — so a schema-only guarantee would be
 * a guarantee about shape and not about content. Steering and enforcement are
 * therefore kept as two separate things that agree.
 */

/** §14.9.6 — prompts are files in git, loaded by `(name, version)`. */
export interface PromptRef {
  readonly name: string;
  readonly version: number;
}

/** §14.9.4 — the frozen prefix carries the breakpoint; volatile text follows it. */
export interface StructuredCall<T> {
  /** §14.9.3 — which step this is, which decides the model tier. */
  step: keyof typeof STEP_MODELS;
  /** Recorded on the `AgentRun` row, so a result traces back to a prompt. */
  prompt: PromptRef;
  /**
   * Frozen system prompt. Cached, so it must not interpolate a timestamp, a
   * user id, or anything else that varies (§14.9.4's cache hygiene list).
   */
  system: string;
  /**
   * Volatile content. Strictly after the breakpoint.
   *
   * A block array rather than a string where the call carries something that is
   * not text — the Skill Check's photo grader sends an image beside its
   * question. Everything else passes a string and reads the same as before.
   */
  user: string | Anthropic.ContentBlockParam[];
  tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  /** The contract that decides whether the model's output is usable. */
  parse: (raw: unknown) => ParseOutcome<T>;
  /**
   * Anthropic-hosted tools the model may reach for before answering.
   *
   * Declaring any of these changes the shape of the call in two ways that are
   * not optional, so they are handled here rather than left to each caller.
   *
   * **`tool_choice` stops being forced.** Every other step in the product pins
   * the model to exactly one tool, which is what makes the output structured.
   * A forced choice means the model must call *that* tool first, so it could
   * never search — the two are mutually exclusive, and asking for both silently
   * gets you the schema without the research.
   *
   * **The turn can pause.** A server tool runs inside the request, and a long
   * one comes back `pause_turn` with no answer yet; the fix is to re-send with
   * the partial assistant turn appended, which `callStructured` does.
   *
   * They render before the submit tool and ahead of the cached system prompt,
   * so they must be module constants — a tool list assembled per request would
   * invalidate §14.9.4's breakpoint on every call.
   */
  serverTools?: Anthropic.ToolUnion[];
  /** §14.9.7 limit 1 — degrade Opus to Sonnet before queueing or notifying. */
  degraded?: boolean;
  maxTokens?: number;
  /**
   * Overrides §14.9.3's effort for this step. `null` forces thinking off. Left
   * unset, the step's own row in `STEP_EFFORT` decides — which is where the
   * plan wrote it down.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  /**
   * A wall clock for the whole call, resumes and schema retries included.
   *
   * Unset on every step but one, and that is the point: this exists for a call
   * whose *duration* is unbounded in a way token limits do not catch. A server
   * tool can pause the turn, and each resume re-sends the conversation so far —
   * so `MAX_SCHEMA_ATTEMPTS` × (1 + `MAX_PAUSE_RESUMES`) is ten requests, each
   * with its own transport retries behind it. A measured reading-list call sat
   * in that loop for 4m45s and 46¢, which is most of a pack build's budget
   * spent on the one artefact the pack does not need (see `resources.ts`).
   *
   * `max_tokens` cannot bound this — the cost is in the *number* of requests,
   * not the size of any one of them. So the ceiling is time, enforced in two
   * places: no attempt or resume starts once it has passed, and each request
   * carries what is left of it as its own timeout, so an in-flight one cannot
   * outlive the budget either. Overrunning returns `invalid` like any other
   * unusable answer, which callers already handle.
   */
  budgetMs?: number;
}

export type ParseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /**
   * Server-side web searches, which are billed per request rather than per
   * token (`WEB_SEARCH_CENTS_PER_REQUEST`). A fifth field rather than a fudge
   * into `inputTokens`, because the two are priced on different scales and a
   * ledger that hid one inside the other could not be checked against a bill.
   */
  webSearchRequests: number;
}

/**
 * Everything an `AgentRun` row needs (§14.8: "the exact version, model and
 * cost"), attached to every outcome — including the ones that failed.
 *
 * A refusal and a schema failure both cost real money, and a cost log that only
 * records successes under-reports exactly when something is going wrong, which
 * is the moment it most needs to be accurate.
 */
export interface CallMeta {
  model: string;
  promptName: string;
  promptVersion: number;
  attempts: number;
  usage: CallUsage;
  /** Null when the model has no published rate — never silently zero. */
  costCents: number | null;
  /** What the same call would have cost with no prompt cache (§14.9.4). */
  uncachedCostCents: number | null;
  latencyMs: number;
}

export type CallResult<T> =
  | ({ status: "ok"; value: T } & CallMeta)
  | ({ status: "refused"; detail: string } & CallMeta)
  | ({ status: "invalid"; detail: string } & CallMeta);

const EMPTY_USAGE: CallUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 0,
};

function addUsage(a: CallUsage, b: Anthropic.Usage): CallUsage {
  return {
    inputTokens: a.inputTokens + b.input_tokens,
    outputTokens: a.outputTokens + b.output_tokens,
    cacheReadInputTokens:
      a.cacheReadInputTokens + (b.cache_read_input_tokens ?? 0),
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + (b.cache_creation_input_tokens ?? 0),
    // Null on every call that used no server tool, which is every call in the
    // product but one.
    webSearchRequests:
      a.webSearchRequests + (b.server_tool_use?.web_search_requests ?? 0),
  };
}

export function modelFor(
  step: keyof typeof STEP_MODELS,
  degraded = false,
): string {
  const tier: ModelTier = degraded
    ? degrade(STEP_MODELS[step])
    : STEP_MODELS[step];
  return MODELS[tier];
}

/**
 * §14.9.5 — "retry once with the validation error appended. Second failure →
 * fall back to the pack's canonical output; never show the user a broken
 * object." The fallback belongs to the caller, so this returns `invalid` rather
 * than throwing: a broken draft is an expected outcome of asking a model for a
 * structured object, not an exception.
 */
export const MAX_SCHEMA_ATTEMPTS = 2;

/**
 * The request body for one structured call, built once.
 *
 * Exported because the goal analyzer also runs this exact call *streamed* — a
 * person is watching it type, and a Server Action cannot start a response
 * before it has one. Two call sites building their own params is how the
 * cache breakpoint, the thinking config or the forced tool choice ends up on
 * one path and not the other, which is a difference nothing would catch.
 */
export function structuredRequest<T>(
  call: StructuredCall<T>,
  messages: Anthropic.MessageParam[],
): Anthropic.MessageCreateParamsNonStreaming {
  const model = modelFor(call.step, call.degraded);
  const effort = call.effort === undefined ? STEP_EFFORT[call.step] : call.effort;

  return {
    model,
    max_tokens: call.maxTokens ?? 16_000,
    // Only where the model has them *and* where §14.9.3 asked for them.
    // Haiku 4.5 400s on either parameter, and a step the plan marked "none"
    // pays for thinking it was never supposed to do.
    ...(supportsAdaptiveThinking(model) && effort !== null
      ? {
          thinking: { type: "adaptive" as const },
          output_config: { effort },
        }
      : {}),
    system: [
      {
        type: "text",
        text: call.system,
        // §14.9.4 layer 1. Verified by assertion, not by hope — see the
        // cacheReadInputTokens field on the result.
        //
        // A breakpoint on a short prompt caches nothing and says nothing:
        // the minimum cacheable prefix is model-dependent, and a system
        // prompt below it silently returns zero on both cache counters. So
        // zeroes here mean "prompt too short" at least as often as they mean
        // "cache miss", and a caller reading them needs to know which.
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      ...(call.serverTools ?? []),
      {
        name: call.tool.name,
        description: call.tool.description,
        input_schema: call.tool.inputSchema as Anthropic.Tool.InputSchema,
      },
    ],
    // See `serverTools`: a forced choice and a server tool cannot both apply,
    // so a call that may search asks rather than pins. The submit tool is still
    // the only way to return an answer, because its schema is the only thing
    // `parse` accepts — "auto" widens what the model may do on the way there,
    // not what counts as arriving.
    tool_choice:
      call.serverTools && call.serverTools.length > 0
        ? { type: "auto" }
        : { type: "tool", name: call.tool.name },
    messages,
  };
}

/**
 * How many times a paused turn may be resumed before the attempt is abandoned.
 *
 * A server tool loop that pauses this many times is not close to finishing, and
 * every resume re-sends the whole transcript — so the cost of waiting grows
 * while the odds do not. Four is enough for the researcher's handful of
 * searches and short of anything that looks like a loop.
 */
export const MAX_PAUSE_RESUMES = 4;

export async function callStructured<T>(
  client: Anthropic,
  call: StructuredCall<T>,
  clock: () => number = Date.now,
): Promise<CallResult<T>> {
  const model = modelFor(call.step, call.degraded);
  const startedAt = clock();
  let usage = EMPTY_USAGE;
  let lastError = "";
  let attempts = 0;

  const meta = (): CallMeta => ({
    model,
    promptName: call.prompt.name,
    promptVersion: call.prompt.version,
    attempts,
    usage,
    costCents: costCentsFor(model, usage),
    uncachedCostCents: uncachedCostCentsFor(model, usage),
    latencyMs: clock() - startedAt,
  });

  /*
   * What is left of `budgetMs`, or null for a call that has no ceiling.
   *
   * Read fresh every time rather than computed once: the whole point is that it
   * shrinks as the loop runs, and a value captured at the top would let the
   * last request start with the budget it had at the first.
   */
  const deadline =
    call.budgetMs === undefined ? null : startedAt + call.budgetMs;
  const msLeft = (): number | null =>
    deadline === null ? null : deadline - clock();
  const spent = (): boolean => {
    const left = msLeft();
    return left !== null && left <= 0;
  };

  for (let attempt = 1; attempt <= MAX_SCHEMA_ATTEMPTS; attempt += 1) {
    attempts = attempt;

    // Checked before the request rather than after it, so an overrun costs
    // nothing further. The first attempt can only trip this on a budget that
    // was already gone when the call started.
    if (spent()) {
      lastError = `the ${call.budgetMs}ms budget ran out`;
      break;
    }
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: call.user },
    ];

    if (attempt > 1) {
      // The retry names what was wrong rather than asking again and hoping.
      messages.push(
        { role: "assistant", content: "(previous attempt omitted)" },
        {
          role: "user",
          content: `Your previous answer did not satisfy the schema: ${lastError}\nReturn a corrected call to ${call.tool.name}.`,
        },
      );
    }

    /*
     * The budget rides on the request as its own timeout, because stopping
     * between requests is only half of it: the SDK's default is ten minutes per
     * request with two transport retries behind it, so one hung call could
     * outlast any ceiling this loop tried to keep on its own.
     */
    const options = () => {
      const left = msLeft();
      // Floored at 1ms rather than passed through: the clock moves between the
      // check above and this line, and a zero or negative timeout makes the SDK
      // abort by *throwing* — which would leave `generatePack` on the exception
      // path, where a deterministic failure looks transient to the queue and
      // gets retried at full price. An overrun must return, not throw.
      return left === null ? undefined : { timeout: Math.max(left, 1) };
    };

    let response = await client.messages.create(
      structuredRequest(call, messages),
      options(),
    );
    usage = addUsage(usage, response.usage);

    /*
     * A server tool that runs long returns `pause_turn` — a real turn with real
     * usage on it, just not a finished one. Resuming is re-sending the same
     * conversation with the partial assistant turn appended; the server picks
     * up where it stopped rather than starting over. No extra user message: the
     * trailing tool use is the signal, and "continue" would be read as an
     * instruction.
     */
    for (
      let resumes = 0;
      response.stop_reason === "pause_turn" &&
      resumes < MAX_PAUSE_RESUMES &&
      // The resume loop is where an unbounded call actually spends its time, so
      // this is the condition the budget most needs to sit in: each pass
      // re-sends everything the last one accumulated.
      !spent();
      resumes += 1
    ) {
      messages.push({ role: "assistant", content: response.content });
      response = await client.messages.create(
        structuredRequest(call, messages),
        options(),
      );
      usage = addUsage(usage, response.usage);
    }

    // §14.9.5 — check stop_reason *before* reading content, and never retry the
    // identical prompt after a refusal.
    if (response.stop_reason === "refusal") {
      return {
        status: "refused",
        detail: response.stop_details?.explanation ?? "The model declined.",
        ...meta(),
      };
    }

    /*
     * Still `tool_use` alone, even with server tools in play: a search the
     * model ran arrives as `server_tool_use`, a different block type, so there
     * is nothing here to disambiguate from.
     */
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block) {
      /*
       * Three ways to end a turn with nothing to parse, and they are worth
       * telling apart in the log: the model ran out of resumes, the *budget*
       * ran out from under it mid-search, or it simply answered without
       * calling the tool. The second reads identically to the first from the
       * response alone, which is why `spent()` is asked rather than inferred.
       */
      lastError =
        response.stop_reason === "pause_turn"
          ? spent()
            ? `still working when the ${call.budgetMs}ms budget ran out`
            : `still working after ${MAX_PAUSE_RESUMES} resumes`
          : "no tool call was made";
      continue;
    }

    const parsed = call.parse(block.input);
    if (parsed.ok) {
      return { status: "ok", value: parsed.value, ...meta() };
    }
    lastError = parsed.error;
  }

  return { status: "invalid", detail: lastError, ...meta() };
}
