/**
 * The plan catalog — PLAN-MONETIZATION §2, the one place a tier is defined.
 *
 * A plain module on purpose. `pnpm actions:audit` fails the build on a
 * non-async export from a `"use server"` module, and this file is nothing but
 * constants and pure functions over them, read from server components, server
 * actions, the webhook and the pricing page alike.
 *
 * §20.1 launched with two plans ("free", "pro") and the founder chose four on
 * 2026-08-15 (PLAN-MONETIZATION §1 decision 4). `free` and `pro` keep §20.1's
 * and §14.9.7's numbers exactly; `trial` and `learner` are the new rows.
 */

export const PLAN_IDS = ["free", "trial", "learner", "pro"] as const;

export type PlanId = (typeof PLAN_IDS)[number];

export type Interval = "month" | "year";

/**
 * What a plan actually *enforces*, which is deliberately narrower than what a
 * pricing page might like to say.
 *
 * Two fields, and both are checked in code before a model call happens. The
 * rule this type exists to keep is that an entitlement is a thing the system
 * refuses to do, not a thing a marketing table claims. Anything we cannot
 * refuse does not belong here.
 *
 * **Two limits §20.1 lists are deliberately absent**, and the reasons differ:
 *
 * - **Sessions per week** ("3/week" on free). The spend cap already binds
 *   tighter than the counter would: at §20.2's measured $0.17 a session, free's
 *   100¢ ceiling is about five sessions a month against the counter's thirteen.
 *   A second, weaker limiter would be dead code that reads like a guarantee.
 * - **Active goals** ("1 goal" free, "3" on the later tier). The engine is
 *   single-goal by construction — `pauseOthers` in `src/lib/goals/store.ts`
 *   pauses every other course whenever one becomes active, and `activeGoal()`
 *   returns one row to fifteen call sites. Selling "3 goals" or "unlimited
 *   goals" would be selling an engine capability that does not exist and that
 *   the engine actively prevents. Multi-goal is its own epic; until it lands,
 *   no plan may claim it.
 */
export interface Entitlements {
  /** §14.9.7 limit 2 — "the product's meter (§20.1)". */
  evaluationsPerMonth: number;
  /**
   * Whether the deep tier is available at all, independent of spend.
   *
   * `false` degrades Opus to Sonnet on every call, which is the same lever
   * §14.9.7 limit 1 pulls at the cap — so a standard-model plan behaves exactly
   * like a premium one that has run out of budget, and there is one degradation
   * path rather than two.
   */
  premiumModels: boolean;
}

export interface PlanDef {
  readonly id: PlanId;
  /** Whether `/pricing` renders a card for it. */
  readonly listed: boolean;
  readonly entitlements: Entitlements;
  /** §14.9.7 limit 1 — the monthly per-user AI ceiling, in cents. */
  readonly spendCapCents: number;
}

/**
 * §20.2's measured cost of one Tier 1 evaluation, in cents.
 *
 * Measured rather than estimated — "Evaluation — Tier 1 (repo, exec, rubric,
 * verifier) | Opus 5 + Sonnet 5 | $0.45". Tier 2/3 is cheaper at $0.38, so
 * costing every evaluation at the Tier 1 rate is the conservative direction.
 *
 * It lives here because every spend cap in the table below is derived from it,
 * and because it is what makes `spendCapCents` checkable rather than a
 * preference: **a plan whose cap cannot pay for the evaluations it advertises
 * is advertising a number the learner can never reach.** The test asserts that
 * for every plan.
 */
export const EVALUATION_COST_CENTS = 45;

/**
 * The catalog.
 *
 * Every number here is derived rather than chosen, and the derivations are
 * worth keeping next to them:
 *
 * - **free — 1 evaluation, 100¢.** §20.1 and §14.9.7, unchanged. The one
 *   evaluation is what keeps §19.3's activation metric ("first graded
 *   submission within 7 days of signup") reachable without paying, which is
 *   what makes §17.3's day-60 kill criteria mean anything.
 * - **trial — 5 evaluations, 450¢.** Four days of Pro capability against €3
 *   (≈$2.60 net of VAT and Stripe fees). Five graded projects is more than any
 *   human does in four days, so it is "full Pro" in practice while costing
 *   $2.25 at §20.2's measured $0.45; with a curriculum, a diagnostic and a few
 *   sessions the expected case is ~$2.70 and the capped worst case is $4.50.
 *   Pro's own ten-a-month quota is *not* what a four-day window should carry —
 *   it would let the trial cost more than the first paid month it is selling.
 * - **learner — 3 evaluations, 600¢.** ~$1.35 of marking against €12.99 gross
 *   (≈€10 net), so ~88% margin. This is the answer to §20.1's rejection of
 *   anything "under $15 — attracts the churning casual segment and can't cover
 *   heavy users": the quota covers heavy users, not the price floor. That
 *   objection named the right risk and the wrong instrument.
 * - **pro — 10 evaluations, 1500¢.** §20.1 and §14.9.7, unchanged.
 */
export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    listed: true,
    entitlements: { evaluationsPerMonth: 1, premiumModels: false },
    spendCapCents: 100,
  },
  trial: {
    id: "trial",
    listed: true,
    entitlements: { evaluationsPerMonth: 5, premiumModels: true },
    spendCapCents: 450,
  },
  learner: {
    id: "learner",
    listed: true,
    entitlements: { evaluationsPerMonth: 3, premiumModels: false },
    spendCapCents: 600,
  },
  pro: {
    id: "pro",
    listed: true,
    entitlements: { evaluationsPerMonth: 10, premiumModels: true },
    spendCapCents: 1_500,
  },
};

/**
 * Whether this plan runs generation on the standard tier regardless of spend.
 *
 * **It never applies to marking, and that is the important half.** The brief
 * sells "standard models" on Learner and "premium models" on Pro, and applied
 * bluntly that would put a Learner's rubric grading on Sonnet instead of Opus —
 * which sells a *worse verdict* to a cheaper customer. Three reasons not to:
 *
 * - §14.5 calls the Evaluation Agent the most important component in the
 *   system, and §4.2 law 1 makes the graded verdict the product's whole claim.
 *   A claim that varies by price is not a claim.
 * - §21 identifies the calibration corpus as the only real moat. Grading half
 *   the submissions on a different model forks that corpus by plan and makes
 *   the κ measurement meaningless.
 * - §7.2's tiers already describe what evidence we can honestly produce. Money
 *   is not one of the inputs.
 *
 * So a cheaper plan buys *fewer* evaluations, never worse ones. What it does
 * degrade is generation — curriculum validation and pack authoring — where the
 * output is a plan the learner can see, reject and regenerate.
 */
export function degradesGeneration(planId: PlanId): boolean {
  return !PLANS[planId].entitlements.premiumModels;
}

/** The order `/pricing` renders them in — cheapest first, ending on Pro. */
export const LISTED_PLAN_IDS: readonly PlanId[] = PLAN_IDS.filter(
  (id) => PLANS[id].listed,
);

export function isPlanId(value: unknown): value is PlanId {
  return (
    typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value)
  );
}

/**
 * Whatever the `user.plan` column holds → a plan we can actually serve.
 *
 * Lenient for the same reason `resolveLocale` is: the column is plain `text`
 * with a default, rows predate this catalog, and an operator can type into it
 * through the admin console. An unrecognised value resolves to `free` — the
 * safe direction, because the failure mode is "someone is under-served and
 * complains" rather than "someone is silently given premium models".
 */
export function resolvePlanId(value: unknown): PlanId {
  return isPlanId(value) ? value : "free";
}

export function planFor(value: unknown): PlanDef {
  return PLANS[resolvePlanId(value)];
}

/**
 * §14.9.7 limit 1's table, derived from the catalog rather than restated.
 *
 * This lived in `src/lib/ai/runlog.ts` as a two-key literal until the catalog
 * existed. It is re-exported from there so the four AI call sites that already
 * import it do not all have to move at once, but this is the definition.
 */
export const SPEND_CAP_CENTS: Record<PlanId, number> = {
  free: PLANS.free.spendCapCents,
  trial: PLANS.trial.spendCapCents,
  learner: PLANS.learner.spendCapCents,
  pro: PLANS.pro.spendCapCents,
};
