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
 * **One limit §20.1 lists is deliberately absent:**
 *
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
   * Sessions a month, or `null` for as many as the spend cap allows.
   *
   * A count rather than §20.1's "3/week", because a week is not a period this
   * system meters anything else in and the ledger is keyed by calendar month.
   * More importantly: **§20.1's number was never affordable.** Three a week is
   * thirteen a month, and at §20.2's measured $0.17 that is 221¢ against a free
   * ceiling of 100¢. This is the first version of the free tier whose promise
   * and whose budget agree.
   */
  sessionsPerMonth: number | null;
  /**
   * §14.9.7 limit 4, made a plan feature rather than one flat number.
   *
   * The limit says thirty. Thirty is what a paid learner gets — but §20.2
   * prices a session at 17¢ for "content + **~15 tutor turns**", so permitting
   * thirty on the free tier meant the free budget was quoting a figure that
   * assumed half the conversation. Fifteen on free makes the arithmetic honest
   * and makes the ceiling a real difference between the plans rather than a
   * number nobody reaches.
   */
  tutorTurnsPerSession: number;
  /**
   * Whether a curriculum is authored by a model or taken from the pack.
   *
   * `false` is not a degraded experience so much as a different, honest one:
   * `canonicalCurriculum` is deterministic code over the skill graph, costs
   * **nothing**, and is already what §14.9.5 falls back to when generation
   * fails twice. §19.2 made the same argument about the roadmap tool — "a
   * roadmap for a subject we have is arithmetic".
   *
   * What the $0.55 actually buys is a path shaped around *this* learner's
   * diagnostic rather than the pack's default order, which is a real thing to
   * sell and a true sentence to put on the pricing page.
   */
  aiCurriculum: boolean;
  /**
   * Lessons a learner may be shown on one course, or `null` for as many as the
   * course has.
   *
   * The free tier's shape, and the reason it can offer any subject at all. A
   * free learner gets the whole plan — `canonicalCurriculum` is arithmetic over
   * the skill graph and costs nothing — and the *first* lesson on it. The second
   * is where the product asks to be paid for.
   *
   * Per course rather than per month, deliberately. A monthly allowance says
   * "come back in September"; a per-course one says "this is the course, here is
   * the beginning of it, the rest is behind the till". The second is a decision
   * the learner can act on today, which is the only kind of paywall worth
   * putting in front of somebody who is still deciding whether to trust you.
   *
   * **This is a paywall, not a spend control**, and the difference decides where
   * it is enforced: `lessonForBlock` checks it *before* the cache, unlike
   * §14.9.7's ceiling which deliberately sits after. A cached lesson costs
   * nothing to serve, so a cost control must not refuse it — but a free learner
   * reading a popular pack would otherwise walk through the whole course for
   * nothing, purely because somebody else had paid for those lessons first.
   */
  lessonsPerCourse: number | null;
  /**
   * Packs this account may ever commission, or `null` for no lifetime limit.
   *
   * §7.1's Generated tier costs **~78¢ a pack** — the one place a single click
   * spends more than a free month's whole allowance. The free tier gets exactly
   * one, ever, and that build is *not* charged to the learner (see
   * `subsidisesPackBuilds`).
   *
   * Lifetime rather than monthly, because a monthly allowance compounds: one
   * account, twelve months, twelve subjects nobody else asked for. One is the
   * number that makes "any subject works" true for everyone who signs up while
   * bounding what a free account can ever cost us at a single build.
   *
   * A plan with `null` has no lifetime quota and pays for its own builds; its
   * monthly spend cap is what bounds it. That is the arrangement every paid
   * plan is on.
   */
  packBuildsLifetime: number | null;
  /**
   * Whether this account may throw a goal conversation away and open another.
   *
   * The free tier's second shape, and it is a different question from
   * `packBuildsLifetime` even though both bite on the same screen. That one
   * bounds what a free account can ever cost us; this one bounds how many times
   * it can spend the *conversation* — six model calls to fill in a form — and
   * then decide it would rather answer them again.
   *
   * **What free keeps is the ability to change its mind, not to start again.**
   * The conversation is editable to the last moment: another turn revises what
   * was captured, and a finished one can be reopened to correct an answer. What
   * it cannot do is discard six answers and re-ask six questions, which is the
   * only version of "start over" that costs anything.
   *
   * That distinction is the whole reason this is a boolean rather than a count.
   * A count would be a number of rerolls, and a number of rerolls is a thing to
   * ration; the ability to fix what you said is not.
   */
  restartIntake: boolean;
  /**
   * Whether the deep tier is available at all, independent of spend.
   *
   * `false` degrades Opus to Sonnet on every call, which is the same lever
   * §14.9.7 limit 1 pulls at the cap — so a standard-model plan behaves exactly
   * like a premium one that has run out of budget, and there is one degradation
   * path rather than two.
   */
  premiumModels: boolean;
  /**
   * Questions the Assistant will answer for this account in one day.
   *
   * Daily rather than monthly, and it is the only limit in this interface that
   * is. Every other allowance here bounds a thing the learner *chose* to spend —
   * a session, an evaluation, a pack. The assistant is a button on every screen,
   * so the failure it has to bound is a runaway afternoon rather than a
   * generous month, and a monthly figure would let one bad hour eat all of it.
   *
   * **It is not the cost control, and the first version of this comment was
   * wrong about what is.** `aiAccess` bounds the month, but it does so
   * first-come-first-served against a ledger the sessions share — so a chatty
   * afternoon could spend the budget the learner's session needed.
   * `assistantAllowance` is what actually protects the product: it refuses the
   * assistant against the cap *less* the month's remaining sessions and
   * evaluations, so this surface yields to the one being paid for.
   *
   * That leaves this number one job, which is the one §10 named for it in the
   * first place: bounding a runaway afternoon. It is not sized to the month —
   * the reserve is — so it is set where a limit stops being felt by somebody
   * using the thing reasonably. Measured against §10.1's numbers, a day at each
   * of these costs well under what the reserve would allow anyway; the reserve
   * is what bites first for anybody who keeps it up.
   */
  assistantMessagesPerDay: number;
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
 * §20.2's measured cost of one learning session, in cents.
 *
 * "Learning session (content + ~15 tutor turns, cached prefix) | Sonnet 5 |
 * $0.17". It is here for the same reason the evaluation figure is: the free
 * tier's session allowance is derived from a budget rather than chosen, and a
 * test asserts the budget adds up.
 */
export const SESSION_COST_CENTS = 17;

/**
 * The one-off cost of getting a new learner to a plan they can start.
 *
 * §20.2: goal interview $0.04 + adaptive diagnostic $0.12. Curriculum
 * generation is **not** in this number, because free does not get it (see
 * `aiCurriculum`) — which is precisely what makes the free tier affordable.
 * Counted once, in a learner's first month only.
 */
export const ONBOARDING_COST_CENTS = 16;

/**
 * The catalog.
 *
 * Every number here is derived rather than chosen, and the derivations are
 * worth keeping next to them:
 *
 * - **free — 1 evaluation, 1 session, 1 lesson, 1 pack ever, 120¢.** The one
 *   evaluation is what keeps §19.3's activation metric ("first graded submission
 *   within 7 days of signup") reachable without paying, which is what makes
 *   §17.3's day-60 kill criteria mean anything. Everything else is arithmetic:
 *
 *       1 session × 17¢    =  17¢
 *       1 evaluation × 45¢ =  45¢
 *       onboarding, once   =  16¢
 *                            ────
 *                              78¢  ≤ 120¢
 *
 *   **The pack build is not in that sum, and that is the point.** A free learner
 *   may commission one Generated pack, and it costs ~78¢ — six times what is
 *   left of their allowance. Charging it to them would mean the first person to
 *   ask for a subject gets a visibly worse free tier than everyone who takes it
 *   afterwards, for a reason they could never perceive. So the catalogue absorbs
 *   it (`subsidisesPackBuilds`) and the lifetime quota bounds it.
 *
 *   **What free stopped being is "the seven subjects we happen to have".** It
 *   was two sessions on a curated pack or nothing, and "nothing" was most
 *   subjects anyone actually asks for. It is now any subject at all — the whole
 *   plan, and the first lesson on it — which is a far better thing to be given
 *   for free and a far clearer thing to be asked to pay for.
 *
 *   **The cap stayed at 120¢, off §20.1's 100¢, because 100¢ never paid for
 *   what §20.1 promised.** That row read "1 goal · roadmap + full diagnostic ·
 *   3 sessions/week · 1 evaluation/month", which is 71¢ of onboarding — the
 *   curriculum generation alone is 55¢ — plus 221¢ of sessions plus a 45¢
 *   evaluation, against a 100¢ ceiling. It was never a budget, it was two
 *   numbers written in different sections. Free no longer buys the generated
 *   curriculum (`aiCurriculum`), which is what brings it inside a real one.
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
    entitlements: {
      evaluationsPerMonth: 1,
      sessionsPerMonth: 1,
      tutorTurnsPerSession: 15,
      aiCurriculum: false,
      lessonsPerCourse: 1,
      packBuildsLifetime: 1,
      restartIntake: false,
      premiumModels: false,
      assistantMessagesPerDay: 5,
    },
    spendCapCents: 120,
  },
  trial: {
    id: "trial",
    listed: true,
    entitlements: {
      evaluationsPerMonth: 5,
      sessionsPerMonth: null,
      tutorTurnsPerSession: 30,
      aiCurriculum: true,
      lessonsPerCourse: null,
      packBuildsLifetime: null,
      restartIntake: true,
      premiumModels: true,
      assistantMessagesPerDay: 10,
    },
    spendCapCents: 450,
  },
  learner: {
    id: "learner",
    listed: true,
    entitlements: {
      evaluationsPerMonth: 3,
      sessionsPerMonth: null,
      tutorTurnsPerSession: 30,
      aiCurriculum: true,
      lessonsPerCourse: null,
      packBuildsLifetime: null,
      restartIntake: true,
      premiumModels: false,
      assistantMessagesPerDay: 15,
    },
    spendCapCents: 600,
  },
  pro: {
    id: "pro",
    listed: true,
    entitlements: {
      evaluationsPerMonth: 10,
      sessionsPerMonth: null,
      tutorTurnsPerSession: 30,
      aiCurriculum: true,
      lessonsPerCourse: null,
      packBuildsLifetime: null,
      restartIntake: true,
      premiumModels: true,
      assistantMessagesPerDay: 30,
    },
    spendCapCents: 1_500,
  },
};

/**
 * What a plan's own promises cost, at §20.2's measured prices.
 *
 * The number a spend cap has to be able to cover. `null` for a plan with
 * unlimited sessions — there is no budget to compute, and the cap *is* the
 * limit, which is the arrangement every paid plan is on.
 *
 * Exported so the test can assert the invariant rather than restate it: a plan
 * whose cap cannot pay for what its own card advertises is advertising numbers
 * the learner will never reach.
 */
/**
 * §7.1's Generated tier, at what it costs since the Resource Researcher.
 *
 * 61¢ of authoring — graph, items, rubrics — plus ~17¢ of research: ~8¢ of
 * searches at $10 per 1,000 and the tokens to read the results. Here rather
 * than in `packs/generate` because it is a *budgeting* fact: it is what makes
 * "one build is six times what a free learner has left" a number rather than
 * an impression, and the test asserts free cannot pay for one.
 */
export const PACK_BUILD_COST_CENTS = 78;

/**
 * Whether this plan's pack builds are charged to the catalogue rather than to
 * the learner who asked.
 *
 * Derived from the lifetime quota rather than being a flag of its own, because
 * the two always travel together and a plan where they disagreed would make no
 * sense in either direction. A plan with a hard lifetime quota does not also
 * pay per build — the quota is already the bound, and its spend cap has no room
 * for one anyway. A plan without a quota pays for its builds out of the monthly
 * cap that bounds everything else it does.
 *
 * "The catalogue pays" means `logCall` is passed no user: the run is written to
 * `agent_run` in full, with its cost, model and prompt version, so nothing
 * becomes invisible — it simply lands on no learner's ledger and consumes no
 * learner's ceiling. That is the same treatment a seed script or a probe gets,
 * and for the same reason: what is being paid for is not that learner's
 * consumption, it is a pack every future learner on that subject reads for
 * free.
 */
export function subsidisesPackBuilds(planId: PlanId): boolean {
  return PLANS[planId].entitlements.packBuildsLifetime !== null;
}

export function promisedCostCents(planId: PlanId): number | null {
  const { evaluationsPerMonth, sessionsPerMonth } = PLANS[planId].entitlements;
  if (sessionsPerMonth === null) return null;

  return (
    sessionsPerMonth * SESSION_COST_CENTS +
    evaluationsPerMonth * EVALUATION_COST_CENTS +
    ONBOARDING_COST_CENTS
  );
}

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
