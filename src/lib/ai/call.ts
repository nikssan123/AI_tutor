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
  /** Volatile content. Strictly after the breakpoint. */
  user: string;
  tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  /** The contract that decides whether the model's output is usable. */
  parse: (raw: unknown) => ParseOutcome<T>;
  /** §14.9.7 limit 1 — degrade Opus to Sonnet before queueing or notifying. */
  degraded?: boolean;
  maxTokens?: number;
  /**
   * Overrides §14.9.3's effort for this step. `null` forces thinking off. Left
   * unset, the step's own row in `STEP_EFFORT` decides — which is where the
   * plan wrote it down.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
}

export type ParseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
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
};

function addUsage(a: CallUsage, b: Anthropic.Usage): CallUsage {
  return {
    inputTokens: a.inputTokens + b.input_tokens,
    outputTokens: a.outputTokens + b.output_tokens,
    cacheReadInputTokens:
      a.cacheReadInputTokens + (b.cache_read_input_tokens ?? 0),
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + (b.cache_creation_input_tokens ?? 0),
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

export async function callStructured<T>(
  client: Anthropic,
  call: StructuredCall<T>,
  clock: () => number = Date.now,
): Promise<CallResult<T>> {
  const model = modelFor(call.step, call.degraded);
  const effort = call.effort === undefined ? STEP_EFFORT[call.step] : call.effort;
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

  for (let attempt = 1; attempt <= MAX_SCHEMA_ATTEMPTS; attempt += 1) {
    attempts = attempt;
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

    const response = await client.messages.create({
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
        {
          name: call.tool.name,
          description: call.tool.description,
          input_schema: call.tool.inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: call.tool.name },
      messages,
    });

    usage = addUsage(usage, response.usage);

    // §14.9.5 — check stop_reason *before* reading content, and never retry the
    // identical prompt after a refusal.
    if (response.stop_reason === "refusal") {
      return {
        status: "refused",
        detail: response.stop_details?.explanation ?? "The model declined.",
        ...meta(),
      };
    }

    const block = response.content.find((b) => b.type === "tool_use");
    if (!block) {
      lastError = "no tool call was made";
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
