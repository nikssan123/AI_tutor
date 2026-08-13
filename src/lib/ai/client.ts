import Anthropic from "@anthropic-ai/sdk";
import type { EnvLike } from "@/lib/env-types";

/**
 * The Anthropic client, constructed in one place.
 *
 * §14.9.5 sets `max_retries` behaviour for us: the SDK already does exponential
 * backoff on 429/529 and connection errors, so the retry policy that matters at
 * this layer is the *schema* retry in `call.ts`, not the transport one.
 */

export function hasApiKey(env: EnvLike = process.env): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY !== "";
}

export function resolveApiKey(env: EnvLike = process.env): string {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add a key from console.anthropic.com.",
    );
  }
  return key;
}

export function createAnthropic(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 2 });
}

let cached: Anthropic | undefined;

export function getAnthropic(env: EnvLike = process.env): Anthropic {
  cached ??= createAnthropic(resolveApiKey(env));
  return cached;
}

/** Test seam: drops the cached client so a later getAnthropic() rebuilds it. */
export function resetAnthropic(): void {
  cached = undefined;
}
