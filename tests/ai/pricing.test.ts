import { describe, expect, it } from "vitest";
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  costCentsFor,
  isPricedModel,
  PRICED_MODELS,
  RATES,
  uncachedCostCentsFor,
  WEB_SEARCH_CENTS_PER_REQUEST,
} from "@/lib/ai/pricing";
import type { CallUsage } from "@/lib/ai/call";

/**
 * §14.8 — the cost half of "the exact version, model and cost".
 *
 * The arithmetic is worth testing because getting it wrong is silent: a wrong
 * number still looks like money, and §14.9.7's spend cap believes it.
 */

const usage = (over: Partial<CallUsage> = {}): CallUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 0,
  ...over,
});

describe("rates", () => {
  it("prices every model the router can reach", () => {
    // A model added to MODELS without a rate would otherwise bill as null and
    // vanish from the ledger.
    for (const model of PRICED_MODELS) {
      expect(isPricedModel(model), model).toBe(true);
    }
  });

  it("keeps the tiers in the order the routing assumes", () => {
    // §14.9.3's whole point is "never default everything to Opus". If the deep
    // tier ever stopped being the expensive one, the routing would be pointless.
    expect(RATES["claude-opus-5"].input).toBeGreaterThan(
      RATES["claude-sonnet-5"].input,
    );
    expect(RATES["claude-sonnet-5"].input).toBeGreaterThan(
      RATES["claude-haiku-4-5"].input,
    );
  });
});

describe("costCentsFor", () => {
  it("prices input and output at the model's own rate", () => {
    // 1M input at $5 = $5 = 500c; 1M output at $25 = $25 = 2500c.
    expect(
      costCentsFor("claude-opus-5", usage({ inputTokens: 1_000_000 })),
    ).toBeCloseTo(500, 6);
    expect(
      costCentsFor("claude-opus-5", usage({ outputTokens: 1_000_000 })),
    ).toBeCloseTo(2500, 6);
  });

  it("bills a cache read at a tenth of the input rate", () => {
    const read = costCentsFor(
      "claude-sonnet-5",
      usage({ cacheReadInputTokens: 1_000_000 }),
    )!;
    const fresh = costCentsFor(
      "claude-sonnet-5",
      usage({ inputTokens: 1_000_000 }),
    )!;
    expect(read).toBeCloseTo(fresh * CACHE_READ_MULTIPLIER, 6);
  });

  it("bills a cache write at a premium over the input rate", () => {
    const write = costCentsFor(
      "claude-sonnet-5",
      usage({ cacheCreationInputTokens: 1_000_000 }),
    )!;
    const fresh = costCentsFor(
      "claude-sonnet-5",
      usage({ inputTokens: 1_000_000 }),
    )!;
    expect(write).toBeCloseTo(fresh * CACHE_WRITE_MULTIPLIER, 6);
    expect(write).toBeGreaterThan(fresh);
  });

  it("sums all four buckets", () => {
    const total = costCentsFor(
      "claude-haiku-4-5",
      usage({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
        cacheCreationInputTokens: 1_000_000,
      }),
    )!;
    // $1 + $5 + $0.10 + $1.25 = $7.35
    expect(total).toBeCloseTo(735, 6);
  });

  it("costs nothing when nothing was used", () => {
    expect(costCentsFor("claude-opus-5", usage())).toBe(0);
  });

  it("bills web searches per request rather than per token", () => {
    // $10 per 1,000 searches. The Resource Researcher's eight-search cap is
    // ~8c, which is the larger half of that call — a ledger that counted only
    // tokens would report the expensive part as free.
    expect(
      costCentsFor("claude-sonnet-5", usage({ webSearchRequests: 8 })),
    ).toBeCloseTo(8 * WEB_SEARCH_CENTS_PER_REQUEST, 6);
  });

  it("adds the search fee on top of the token cost, not instead of it", () => {
    const searched = costCentsFor(
      "claude-sonnet-5",
      usage({ inputTokens: 1_000_000, webSearchRequests: 3 }),
    )!;
    const quiet = costCentsFor(
      "claude-sonnet-5",
      usage({ inputTokens: 1_000_000 }),
    )!;
    expect(searched - quiet).toBeCloseTo(3 * WEB_SEARCH_CENTS_PER_REQUEST, 6);
  });

  it("returns null — never zero — for a model with no published rate", () => {
    // Zero would flow into the ledger as "this call was free", which is a lie
    // that accumulates.
    expect(costCentsFor("some-future-model", usage({ inputTokens: 999 }))).toBeNull();
    expect(isPricedModel("some-future-model")).toBe(false);
  });
});

describe("uncachedCostCentsFor", () => {
  it("reprices cached tokens as if they had been sent fresh", () => {
    const real = usage({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 900,
      cacheCreationInputTokens: 0,
    });

    const actual = costCentsFor("claude-sonnet-5", real)!;
    const counterfactual = uncachedCostCentsFor("claude-sonnet-5", real)!;

    // §14.9.4 calls caching "the single largest lever" — this is the number
    // that shows whether the lever is actually connected.
    expect(counterfactual).toBeGreaterThan(actual);
    expect(counterfactual).toBeCloseTo(
      costCentsFor(
        "claude-sonnet-5",
        usage({ inputTokens: 1000, outputTokens: 50 }),
      )!,
      6,
    );
  });

  it("matches the real cost when nothing was cached", () => {
    const plain = usage({ inputTokens: 100, outputTokens: 50 });
    expect(uncachedCostCentsFor("claude-opus-5", plain)).toBeCloseTo(
      costCentsFor("claude-opus-5", plain)!,
      6,
    );
  });

  it("carries search fees into the counterfactual rather than zeroing them", () => {
    // The counterfactual asks what the *cache* saved. Searches cost the same
    // either way, so dropping them here would credit the cache with money it
    // had nothing to do with.
    const searched = usage({ cacheReadInputTokens: 1_000, webSearchRequests: 4 });
    const counterfactual = uncachedCostCentsFor("claude-sonnet-5", searched)!;
    const withoutSearches = uncachedCostCentsFor(
      "claude-sonnet-5",
      usage({ cacheReadInputTokens: 1_000 }),
    )!;
    expect(counterfactual - withoutSearches).toBeCloseTo(
      4 * WEB_SEARCH_CENTS_PER_REQUEST,
      6,
    );
  });

  it("is null for an unpriced model too", () => {
    expect(uncachedCostCentsFor("nope", usage())).toBeNull();
  });
});
