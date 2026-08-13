import type Anthropic from "@anthropic-ai/sdk";
import {
  modelFor,
  structuredRequest,
  type CallResult,
  type CallUsage,
} from "@/lib/ai/call";
import { costCentsFor, uncachedCostCentsFor } from "@/lib/ai/pricing";
import {
  analyzerCall,
  AnalyzerTurn,
  ANALYZER_PROMPT,
  type AnalyzerInput,
} from "./analyzer";

/**
 * The goal analyzer, streamed, because a person is watching it type.
 *
 * The tutor already streams and gets to be simple about it: its answer is
 * prose, so the bytes off the wire are the bytes on the screen. This one is a
 * tool call, and what arrives is a JSON object being typed out a fragment at a
 * time — `{"reply":"Got it — start`. The sentence the learner is waiting for is
 * one field inside it, and the rest (`captured`, `chips`, `clarity`, `done`)
 * is of no interest until the call is finished.
 *
 * So the reply is read out of the half-written JSON as it lands, and everything
 * else is parsed once at the end, from the same buffer, against the same Zod
 * contract the non-streaming path uses. The model is asked for exactly the same
 * call — `structuredRequest` builds it for both — so streaming changes when the
 * words arrive and nothing about what was asked.
 */

/**
 * The `reply` field, as far as it has arrived.
 *
 * Deliberately not a JSON parser: the buffer is by definition invalid JSON for
 * all but its last moment, so anything that insists on a complete document
 * shows nothing until there is nothing left to wait for. It reads the one
 * string value it needs and tolerates stopping anywhere — including halfway
 * through an escape sequence, which is where a naive slice produces a stray
 * backslash on screen or throws.
 *
 * `reply` is first in the tool schema and Claude fills fields in schema order,
 * so in practice this is showing text within a few hundred milliseconds. If a
 * model ever reorders them the worst case is the old behaviour: nothing to show
 * until the end.
 */
const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

export function partialReply(buffer: string): string {
  const key = buffer.indexOf('"reply"');
  if (key === -1) return "";

  const colon = buffer.indexOf(":", key + '"reply"'.length);
  if (colon === -1) return "";

  const open = buffer.indexOf('"', colon + 1);
  if (open === -1) return "";

  let out = "";

  for (let i = open + 1; i < buffer.length; i += 1) {
    const character = buffer[i]!;

    // The closing quote: the value is complete, and anything after it belongs
    // to the other fields.
    if (character === '"') break;

    if (character !== "\\") {
      out += character;
      continue;
    }

    const escaped = buffer[i + 1];
    // The buffer stops mid-escape. Nothing to show for it yet; the next
    // fragment will carry the rest.
    if (escaped === undefined) break;

    if (escaped === "u") {
      const hex = buffer.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 5;
      continue;
    }

    out += SIMPLE_ESCAPES[escaped] ?? escaped;
    i += 1;
  }

  return out;
}

const NO_USAGE: CallUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

/**
 * Yields the reply as it is written; returns the finished turn.
 *
 * The return value is the same `CallResult` the non-streaming path produces,
 * with the same meta an `AgentRun` row needs (§14.8) — a streamed call costs
 * the same real money as a blocking one, and a ledger that only records the
 * blocking ones is wrong by however much this gets used.
 *
 * One attempt, no schema retry. `callStructured` retries by telling the model
 * what was wrong and asking again, which cannot be done halfway through a
 * sentence that is already on screen. The caller falls back to the blocking
 * path — retries and all — when this comes back unusable.
 */
export async function* analyzerStream(
  client: Anthropic,
  input: AnalyzerInput,
  clock: () => number = Date.now,
): AsyncGenerator<string, CallResult<AnalyzerTurn>, void> {
  const call = analyzerCall(input);
  const model = modelFor(call.step, call.degraded);
  const startedAt = clock();

  const usage: CallUsage = { ...NO_USAGE };
  let json = "";
  let shown = "";
  let refusal: string | undefined;

  const stream = await client.messages.create({
    ...structuredRequest(call, [{ role: "user", content: call.user }]),
    stream: true,
  });

  for await (const event of stream) {
    if (event.type === "message_start") {
      usage.inputTokens = event.message.usage.input_tokens;
      usage.cacheReadInputTokens =
        event.message.usage.cache_read_input_tokens ?? 0;
      usage.cacheCreationInputTokens =
        event.message.usage.cache_creation_input_tokens ?? 0;
      continue;
    }

    if (event.type === "message_delta") {
      usage.outputTokens = event.usage.output_tokens;
      if (event.delta.stop_reason === "refusal") {
        refusal = "The model declined.";
      }
      continue;
    }

    if (
      event.type === "content_block_delta" &&
      event.delta.type === "input_json_delta"
    ) {
      json += event.delta.partial_json;

      // Only ever the part that is new. Re-yielding the whole reply on every
      // fragment would make the client's job "replace" rather than "append",
      // and a dropped fragment would then be invisible rather than obvious.
      const reply = partialReply(json);
      if (reply.length > shown.length) {
        yield reply.slice(shown.length);
        shown = reply;
      }
    }
  }

  const meta = {
    model,
    promptName: ANALYZER_PROMPT.name,
    promptVersion: ANALYZER_PROMPT.version,
    attempts: 1,
    usage,
    costCents: costCentsFor(model, usage),
    uncachedCostCents: uncachedCostCentsFor(model, usage),
    latencyMs: clock() - startedAt,
  };

  if (refusal) return { status: "refused", detail: refusal, ...meta };

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {
      status: "invalid",
      detail: "the tool call was not valid JSON",
      ...meta,
    };
  }

  const parsed = AnalyzerTurn.safeParse(raw);
  if (parsed.success) return { status: "ok", value: parsed.data, ...meta };

  return {
    status: "invalid",
    detail: parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; "),
    ...meta,
  };
}
