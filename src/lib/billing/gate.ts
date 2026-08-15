import { spentThisPeriod } from "@/lib/ai/runlog";
import type { Db } from "@/db";
import { sessionsThisPeriod } from "@/lib/session/store";
import { degradesGeneration, PLANS, type PlanId } from "./catalog";
import { nudgeFor, type Nudge, type NudgeReason } from "./nudge";
import { evaluationsUsed } from "./quota";
import { entitlementsForUser } from "./store";

/**
 * §14.9.7 limit 1, applied to every call rather than to three of them.
 *
 * The limit has always read *"checked **before** every call"*. Until this
 * module it was checked before curriculum generation, pack authoring and
 * marking, and before nothing else — so a free learner could run unlimited
 * sessions and unlimited tutor turns, and the free tier's ceiling bound
 * precisely nothing they did day to day. The spend was recorded faithfully the
 * whole time; nothing ever read it.
 *
 * ## Why "degrade" is not always available
 *
 * §14.9.7's ladder is "degrade Opus → Sonnet, then queue, then notify", and
 * that is written for the deep tier. **Most of the spend is not on the deep
 * tier.** §14.9.3 puts the tutor, the lesson generator and the goal interview
 * on `standard`, and `degrade()` maps `deep → standard` — so "degrade the
 * tutor" is a no-op that changes nothing and saves nothing.
 *
 * So the rule has two halves, and which one applies depends on what the call
 * was going to cost:
 *
 * - **A deep-tier call over the cap is degraded.** There is somewhere cheaper
 *   to go, service continues, and this is exactly what shipped before.
 * - **A standard-tier call over the cap is refused.** There is nowhere cheaper
 *   to go, so the only honest options are "spend anyway" or "stop", and
 *   "spend anyway" is what made the cap decorative.
 *
 * Refusing is not the same as breaking. Every caller here has something true to
 * say instead — the lesson still reads without the tutor, the plan still exists
 * without a new session — and §7.2's honesty rule means saying it is better
 * than quietly serving a worse thing.
 */

export type ModelTierNeed = "deep" | "standard";

export interface AiAccess {
  /** Whether the month's ceiling has been reached. */
  overCap: boolean;
  /** Drop `deep` to `standard`. True over the cap, or on a standard-only plan. */
  degraded: boolean;
  /**
   * Whether this particular call must not happen.
   *
   * Only ever true for a `standard` need over the cap: there is no cheaper tier
   * to fall to, so continuing would spend past a ceiling that exists to stop
   * exactly that.
   */
  blocked: boolean;
  /** For the message shown to the learner. */
  spentCents: number;
  capCents: number;
}

/**
 * What this learner may spend on the next call.
 *
 * `need` is what the call *wants*, not what it will get. A caller asking for
 * `deep` and receiving `degraded: true` should run on standard; a caller asking
 * for `standard` and receiving `blocked: true` should not run at all.
 */
export async function aiAccess(
  db: Db,
  userId: string,
  planId: PlanId,
  need: ModelTierNeed,
  now: Date = new Date(),
): Promise<AiAccess> {
  const capCents = PLANS[planId].spendCapCents;
  const spentCents = await spentThisPeriod(db, userId, now);
  const overCap = spentCents >= capCents;

  return {
    overCap,
    // A plan without premium models degrades whatever it has spent — that is
    // `degradesGeneration`, and it is about entitlement rather than budget.
    degraded: overCap || degradesGeneration(planId),
    blocked: overCap && need === "standard",
    spentCents,
    capCents,
  };
}

/**
 * The nudge for a learner who has just hit a wall, with their usage loaded.
 *
 * The deciding is in `nudge.ts` and stays pure; this is the two queries that
 * pure function needs. It lives here rather than in `store.ts` because a nudge
 * is a fact about what somebody may still do, which is what this module is
 * already for.
 *
 * Returns nothing whenever `nudgeFor` does — a plan with no wall in front of it
 * is never sold a way past one — so a caller can render the result without
 * asking whether it should.
 */
export async function nudgeAt(
  db: Db,
  userId: string,
  plan: unknown,
  reason: NudgeReason,
  now: Date = new Date(),
): Promise<Nudge | undefined> {
  const resolved = await entitlementsForUser(db, userId, plan, now);

  const [evaluations, sessions] = await Promise.all([
    evaluationsUsed(db, userId, now),
    sessionsThisPeriod(db, userId, now),
  ]);

  return nudgeFor(reason, {
    planId: resolved.planId,
    entitlements: resolved.entitlements,
    paying: resolved.source !== "plan" || resolved.planId !== "free",
    evaluationsUsed: evaluations,
    sessionsUsed: sessions,
  });
}

/**
 * What to tell somebody whose month is spent.
 *
 * One sentence, no numbers in cents. The memory note about user copy applies
 * with force here: a learner does not care that they are at 151 of 150¢, they
 * care that the tutor stopped and what to do about it. §20.1's meter is the
 * evaluation, so this deliberately does **not** mention AI spend at all — it
 * would be the only place in the product that exposed token economics, and
 * §6 of the brief is explicit about not doing that.
 */
export function overCapMessage(planId: PlanId): string {
  return planId === "free"
    ? "You have used everything this month's free plan includes. It resets on the 1st, or Pro carries on now."
    : "You have used everything included this month. It resets on the 1st.";
}
