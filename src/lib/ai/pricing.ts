import { MODELS, type ModelId } from "./models";
import type { CallUsage } from "./call";

/**
 * §14.8 — "every `AgentRun` row records the exact version, model and cost."
 *
 * Cost is computed here rather than read back from the API, because the API
 * does not return one: it returns token counts, and the price of a token
 * depends on which of the four buckets it landed in. Getting that arithmetic
 * wrong is silent — the number still looks like money — so it lives in one
 * place with the rates written next to the model they belong to.
 *
 * **Rates are list prices in USD per million tokens.** Any negotiated discount
 * makes real spend lower than what this reports, which is the safe direction
 * for something that gates §14.9.7's spend cap: over-reporting degrades a
 * learner to Sonnet early, under-reporting lets a bug bill until someone
 * notices.
 */

export interface Rate {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

/**
 * Deliberately keyed by `ModelId`, so adding a model to `MODELS` without a
 * price is a type error rather than a silently free model.
 */
export const RATES: Record<ModelId, Rate> = {
  "claude-opus-5": { input: 5, output: 25 },
  // Sonnet 5 carries an introductory $2/$10 through 2026-08-31. The standard
  // rate is used anyway: a discount that expires would otherwise turn into an
  // under-count on the day it lapses, and under-counting spend is the failure
  // mode §14.9.7 exists to prevent.
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Cache reads bill at ~0.1× the input rate — the whole point of §14.9.4. */
export const CACHE_READ_MULTIPLIER = 0.1;

/**
 * The server-side web search tool, in cents per search: $10 per 1,000.
 *
 * It is billed per *request*, not per token, which is why it needs a constant of
 * its own rather than a row in `RATES`. Until the Resource Researcher there was
 * no call site that spent it, and `costCentsFor` counted only the four token
 * buckets — so a step that searched would have recorded its searches as $0.00 in
 * the ledger `shouldDegrade` reads. That is the under-counting this file's
 * header calls the failure mode §14.9.7 exists to prevent, and it is why this
 * lands in the same change as the first call that searches rather than after it.
 *
 * At the researcher's ~8 searches a pack this is ~8¢ against ~7¢ of tokens: the
 * search fee is the larger half of that call, not a rounding error.
 */
export const WEB_SEARCH_CENTS_PER_REQUEST = 1;

/**
 * Cache writes bill at 1.25× input for the 5-minute TTL, which is what
 * `call.ts` requests. A 1-hour TTL would be 2×; if that is ever set, this
 * constant has to move with it.
 */
export const CACHE_WRITE_MULTIPLIER = 1.25;

export function isPricedModel(model: string): model is ModelId {
  return model in RATES;
}

/**
 * Cost of one call, in cents.
 *
 * Returns `null` for a model with no published rate rather than 0. A zero would
 * flow into the spend ledger as "this call was free", which is a lie that
 * accumulates; a null says "not priced" and can be surfaced as such.
 */
export function costCentsFor(model: string, usage: CallUsage): number | null {
  if (!isPricedModel(model)) return null;

  const rate = RATES[model];
  const perToken = (tokens: number, usdPerMTok: number) =>
    (tokens / 1_000_000) * usdPerMTok * 100;

  return (
    perToken(usage.inputTokens, rate.input) +
    perToken(usage.outputTokens, rate.output) +
    perToken(usage.cacheReadInputTokens, rate.input * CACHE_READ_MULTIPLIER) +
    perToken(
      usage.cacheCreationInputTokens,
      rate.input * CACHE_WRITE_MULTIPLIER,
    ) +
    usage.webSearchRequests * WEB_SEARCH_CENTS_PER_REQUEST
  );
}

/**
 * What the same call would have cost with no cache at all.
 *
 * §14.9.4 calls prompt caching "the single largest lever" and asks for the
 * saving to be verified rather than assumed. Reporting the counterfactual next
 * to the actual is what turns that from a belief into a number on a dashboard.
 */
export function uncachedCostCentsFor(
  model: string,
  usage: CallUsage,
): number | null {
  if (!isPricedModel(model)) return null;

  return costCentsFor(model, {
    inputTokens:
      usage.inputTokens +
      usage.cacheReadInputTokens +
      usage.cacheCreationInputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    // Carried rather than zeroed: this is the counterfactual for the *cache*,
    // and searches cost the same whether or not the prefix was cached. Dropping
    // them here would make the "saving" the dashboard reports include money the
    // cache never had anything to do with.
    webSearchRequests: usage.webSearchRequests,
  });
}

/** Every model the router can reach must have a rate. Asserted by test. */
export const PRICED_MODELS = Object.values(MODELS);
