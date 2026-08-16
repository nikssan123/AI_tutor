import type Anthropic from "@anthropic-ai/sdk";
import { STEP_EFFORT, supportsAdaptiveThinking, type STEP_MODELS } from "./models";
import { modelFor, type CallMeta, type CallUsage, type PromptRef } from "./call";
import { costCentsFor, uncachedCostCentsFor } from "./pricing";

/**
 * A streamed call that may reach for tools before it answers — the third shape
 * of model call in the product, and the only one that loops.
 *
 * `callStructured` returns an object and can be retried against its schema.
 * `streamChat` returns prose to somebody watching it appear and cannot be taken
 * back once it has. This returns prose *and* runs work in the middle of it, and
 * it is a third function rather than a flag on the second for the reason those
 * two are already separate: what differs is the thing that matters. A loop has a
 * step count, a wall clock, and a ledger row per request, none of which a single
 * call has any use for.
 *
 * **What the model may do here is wider than anywhere else in the product, so
 * what it may *decide* is narrower.** Every other step pins the model to one
 * tool and treats its output as the answer. Here the model chooses which tool to
 * call — and that is the whole of its authority. It never sees the tool's data,
 * only the short summary the tool writes for it (`ToolOutcome.forModel`), and
 * the payload the learner actually reads goes to the screen untouched by it.
 * See `ASSISTANT-PLAN.md` §2.
 */

export interface ToolOutcome {
  /**
   * What the model is told. Short, factual, and deliberately not the figures:
   * a model that was never given the calendar cannot narrate the calendar back
   * at somebody who is already looking at it.
   */
  forModel: string;
  /**
   * What the learner is shown, rendered by a real component. Null for a lookup
   * that only informs the model's next sentence.
   */
  forView: { widget: string; payload: unknown } | null;
  /** Whether `forModel` describes a failure rather than a result. */
  failed?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * What the panel says while this runs — "Checking your calendar…".
   *
   * The tool's own words rather than the model's. A label the model wrote would
   * be a claim about what is happening made by the party that cannot see it.
   */
  label: string;
  /**
   * The view this tool puts on screen, when it has one.
   *
   * Declared so a panel can hold the right amount of space open while the
   * lookup runs, instead of reflowing the moment a month grid lands. A tool
   * that only informs the model's next sentence leaves it unset, and nothing is
   * reserved — a skeleton for a view that never comes is worse than no skeleton
   * at all.
   *
   * A `string` rather than a widget name, because this module knows nothing
   * about this product's widgets and should not start now.
   */
  shows?: string;
  /** Never throws; a tool that fails says so in `forModel`. See `runTool`. */
  run: (input: unknown) => Promise<ToolOutcome>;
}

/** What the route multiplexes onto one NDJSON stream (§3). */
export type AgentFrame =
  | { t: "text"; v: string }
  | { t: "tool"; label: string; shows?: string }
  | { t: "widget"; name: string; payload: unknown };

/** Why the loop stopped, which is worth telling apart in the log. */
export type AgentStop = "end" | "steps" | "budget" | "refusal";

export interface AgentCall {
  step: keyof typeof STEP_MODELS;
  prompt: PromptRef;
  /** The frozen prefix; carries the cache breakpoint (§14.9.4). */
  system: string;
  messages: Anthropic.MessageParam[];
  tools: AgentTool[];
  maxTokens?: number;
  degraded?: boolean;
  maxSteps?: number;
  budgetMs?: number;
}

export interface AgentOutcome {
  /** Everything streamed across every step, joined. What gets stored. */
  text: string;
  /**
   * One entry per model request.
   *
   * §10 — a turn that spent four requests must write four `AgentRun` rows. One
   * averaged row would under-report the per-agent cost review exactly where a
   * loop is the thing going wrong, which is the only reason to review it.
   */
  steps: CallMeta[];
  refused: boolean;
  stopped: AgentStop;
}

/**
 * How many model requests one message may cost.
 *
 * The ceiling that makes an always-open button affordable. Four is a lookup, a
 * second lookup the first one implied, and an answer — past that a loop is not
 * converging, and every further step re-sends everything before it.
 */
export const MAX_AGENT_STEPS = 4;

const EMPTY_USAGE: CallUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  // The assistant declares no server tools — its tools are this product's, run
  // here, and are not billed per request.
  webSearchRequests: 0,
};

export function agentRequest(
  call: AgentCall,
  messages: Anthropic.MessageParam[],
): Anthropic.MessageCreateParamsStreaming {
  const model = modelFor(call.step, call.degraded);
  const effort = STEP_EFFORT[call.step];

  return {
    model,
    max_tokens: call.maxTokens ?? 2_000,
    ...(supportsAdaptiveThinking(model) && effort !== null
      ? { thinking: { type: "adaptive" as const }, output_config: { effort } }
      : {}),
    system: [
      {
        type: "text",
        text: call.system,
        // §14.9.4 layer 1. The prefix is frozen instructions and nothing else —
        // a tool list assembled per request would invalidate it on every call,
        // which is why `tools` below is built from a registry rather than from
        // whatever this learner happens to have.
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: call.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    })),
    // Auto, not forced: the point is that the model may answer without a
    // lookup. "What can you do?" needs no tool, and pinning one would make it
    // run a query to answer a question about itself.
    tool_choice: { type: "auto" },
    messages,
    stream: true,
  };
}

/** One `tool_use` block, assembled from its deltas. */
interface PendingTool {
  id: string;
  name: string;
  json: string;
}

/**
 * Runs a tool without letting it take the turn down.
 *
 * A tool is a database query behind a model's guess at an argument, so it will
 * eventually throw. The learner is mid-answer when it does, and the model can
 * do something sensible with "that lookup failed" — so a failure becomes a
 * result the model reads, not an exception that truncates a reply already on
 * screen.
 */
export async function runTool(
  tool: AgentTool,
  input: unknown,
): Promise<ToolOutcome> {
  try {
    return await tool.run(input);
  } catch (error) {
    return {
      forModel: `That lookup failed: ${error instanceof Error ? error.message : "unknown error"}. Tell them you could not read it and point them at the page.`,
      forView: null,
      failed: true,
    };
  }
}

export async function* streamAgent(
  client: Anthropic,
  call: AgentCall,
  clock: () => number = Date.now,
): AsyncGenerator<AgentFrame, AgentOutcome, undefined> {
  const model = modelFor(call.step, call.degraded);
  const maxSteps = call.maxSteps ?? MAX_AGENT_STEPS;
  const startedAt = clock();
  const deadline =
    call.budgetMs === undefined ? null : startedAt + call.budgetMs;
  const spent = (): boolean => deadline !== null && clock() >= deadline;

  const messages: Anthropic.MessageParam[] = [...call.messages];
  const steps: CallMeta[] = [];
  let text = "";
  let refused = false;
  /* Reads "the loop ran out of steps" unless something else ends it first,
     which is the honest default: falling out of the bottom of the loop is
     exactly that. */
  let stopped: AgentStop = "steps";

  for (let step = 0; step < maxSteps; step += 1) {
    // Checked before the request rather than after, so an overrun costs
    // nothing further — the same shape `callStructured` uses.
    if (spent()) {
      stopped = "budget";
      break;
    }

    const stepStartedAt = clock();
    let usage = EMPTY_USAGE;
    const blocks = new Map<number, Anthropic.ContentBlockParam>();
    const pending = new Map<number, PendingTool>();

    const stream = await client.messages.create(agentRequest(call, messages));

    for await (const event of stream) {
      if (event.type === "message_start") {
        usage = {
          inputTokens: event.message.usage.input_tokens,
          outputTokens: event.message.usage.output_tokens,
          cacheReadInputTokens:
            event.message.usage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens:
            event.message.usage.cache_creation_input_tokens ?? 0,
          webSearchRequests: 0,
        };
        continue;
      }

      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          pending.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            json: "",
          });
        } else if (event.content_block.type === "text") {
          blocks.set(event.index, { type: "text", text: "" });
        }
        continue;
      }

      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          const block = blocks.get(event.index);
          // Only ever absent if a delta arrives for a block that never
          // started, which the API does not do — but the map lookup has to
          // resolve to something either way.
          if (block?.type === "text") {
            block.text += event.delta.text;
          }
          text += event.delta.text;
          yield { t: "text", v: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          const tool = pending.get(event.index);
          if (tool) tool.json += event.delta.partial_json;
        }
        continue;
      }

      if (event.type === "message_delta") {
        // Output tokens are only final here; `message_start` reports zero.
        usage = { ...usage, outputTokens: event.usage.output_tokens };
        if (event.delta.stop_reason === "refusal") refused = true;
      }
    }

    steps.push({
      model,
      promptName: call.prompt.name,
      promptVersion: call.prompt.version,
      attempts: 1,
      usage,
      costCents: costCentsFor(model, usage),
      uncachedCostCents: uncachedCostCentsFor(model, usage),
      latencyMs: clock() - stepStartedAt,
    });

    // §14.9.5 — a refusal is never retried, and here it also ends the loop:
    // the model declining is an answer, and running its tools anyway would be
    // spending on a turn that has already finished.
    if (refused) {
      stopped = "refusal";
      break;
    }

    if (pending.size === 0) {
      stopped = "end";
      break;
    }

    for (const [index, tool] of pending) {
      blocks.set(index, {
        type: "tool_use",
        id: tool.id,
        name: tool.name,
        input: parseInput(tool.json),
      });
    }

    messages.push({
      role: "assistant",
      content: [...blocks.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, block]) => block),
    });

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const tool of pending.values()) {
      const known = call.tools.find((candidate) => candidate.name === tool.name);

      if (!known) {
        // A name the registry does not have. Said back to the model rather than
        // thrown, because the model can recover from it in the next step and a
        // learner should never see a turn die over one.
        results.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: `There is no tool called ${tool.name}.`,
          is_error: true,
        });
        continue;
      }

      yield known.shows === undefined
        ? { t: "tool", label: known.label }
        : { t: "tool", label: known.label, shows: known.shows };

      const outcome = await runTool(known, parseInput(tool.json));
      if (outcome.forView) {
        yield {
          t: "widget",
          name: outcome.forView.widget,
          payload: outcome.forView.payload,
        };
      }

      results.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: outcome.forModel,
        is_error: outcome.failed ?? false,
      });
    }

    messages.push({ role: "user", content: results });
  }

  return { text, steps, refused, stopped };
}

/**
 * A tool's arguments, from the JSON the model streamed.
 *
 * Empty for a tool called with no arguments — the API sends no deltas at all
 * for those, not an empty object — and empty again for JSON that did not
 * finish arriving. Both mean the same thing to a tool, which validates its own
 * input anyway: there is nothing usable here.
 */
export function parseInput(json: string): unknown {
  if (json === "") return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
