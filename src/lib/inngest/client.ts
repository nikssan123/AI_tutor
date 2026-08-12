import { Inngest } from "inngest";

/**
 * §18.1 — Inngest for durable multi-step functions with retries. That is exactly
 * the shape of the evaluation and curriculum pipelines (§14.9.1), and the
 * property that matters is in §14.9.5: "Inngest step fails mid-chain → durable
 * resume from the last completed step." Steps survive deploys.
 *
 * Local development needs no account: `pnpm inngest:dev` runs the dev server.
 */
export const inngest = new Inngest({ id: "online-uni" });

/** Event names, typed so a producer and a consumer cannot drift apart. */
export const EVENTS = {
  /** Wiring proof for E1; removed once a real pipeline lands. */
  ping: "system/ping",
  /** E4 → E6: the durable buildPath chain from §14.9.1. */
  buildPath: "goal/path.requested",
  /** E8: the durable evaluate chain — the product's crown jewel. */
  evaluate: "submission/evaluate.requested",
  /** §16.1: the nightly planner run. Pure code, no LLM. */
  planNightly: "planner/nightly.requested",
} as const;
