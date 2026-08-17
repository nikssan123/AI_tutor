import { spentThisPeriod } from "@/lib/ai/runlog";
import type { Db } from "@/db";
import { sessionsThisPeriod } from "@/lib/session/store";
import {
  degradesGeneration,
  EVALUATION_COST_CENTS,
  PLANS,
  SESSION_COST_CENTS,
  type PlanId,
} from "./catalog";
import { nudgeFor, type Nudge, type NudgeReason } from "./nudge";
import { evaluationsUsed } from "./quota";
import { entitlementsForUser, hasUsedTrial } from "./store";

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
/**
 * Whether starting a new session would be refused right now.
 *
 * Asked by the screens that offer the button, so the wall is *drawn* rather
 * than walked into: `startSessionAction` has always refused past the month's
 * allowance and redirected with `?error=sessions`, which meant the only way to
 * find out was to press the product's biggest button and be bounced back.
 *
 * `null` is "as many as the spend ceiling allows" — no wall to draw. Resuming
 * an unfinished session is not a new one and is never locked; that exception
 * belongs to the caller, which is the only thing that knows whether one is
 * open.
 */
export async function sessionsLocked(
  db: Db,
  userId: string,
  plan: unknown,
  now: Date = new Date(),
): Promise<boolean> {
  const { entitlements } = await entitlementsForUser(db, userId, plan, now);
  const limit = entitlements.sessionsPerMonth;
  if (limit === null) return false;

  return (await sessionsThisPeriod(db, userId, now)) >= limit;
}

export async function nudgeAt(
  db: Db,
  userId: string,
  plan: unknown,
  reason: NudgeReason,
  now: Date = new Date(),
): Promise<Nudge | undefined> {
  const resolved = await entitlementsForUser(db, userId, plan, now);
  const paying = resolved.source !== "plan" || resolved.planId !== "free";

  const [evaluations, sessions, trialUsed] = await Promise.all([
    evaluationsUsed(db, userId, now),
    sessionsThisPeriod(db, userId, now),
    /*
     * Asked of everybody rather than only of free accounts, because the answer
     * is cheap (one indexed row) and the alternative is a conditional await
     * whose false branch nothing would ever exercise. `hasUsedTrial` reads the
     * whole subscription history, so a cancelled or refunded trial still counts
     * — offering a second four days to somebody who already had them is an offer
     * `startCheckoutAction` would refuse at the till.
     */
    hasUsedTrial(db, userId),
  ]);

  return nudgeFor(reason, {
    planId: resolved.planId,
    entitlements: resolved.entitlements,
    paying,
    // Somebody already paying is not sold the way in. The walls below mostly
    // return nothing for them anyway; this keeps the copy right in the cases
    // where a paid plan still has a ceiling above it.
    trialEligible: !paying && !trialUsed,
    evaluationsUsed: evaluations,
    sessionsUsed: sessions,
  });
}

/**
 * Sessions reserved for a plan with no monthly session count.
 *
 * `sessionsPerMonth: null` means "as many as the spend cap allows", which is a
 * fine entitlement and a useless number to reserve against — reserving infinity
 * would refuse the assistant to everybody on a paid plan. Twelve is the figure
 * `ASSISTANT-PLAN.md` §10.1 priced those plans at: three a week, which is what
 * somebody keeping their commitment actually runs.
 */
export const SESSIONS_RESERVED = 12;

export interface AssistantAllowance {
  /** Whether this message must not happen. */
  blocked: boolean;
  /** The month's ceiling, less what the rest of the month is owed. */
  allowanceCents: number;
  reserveCents: number;
  spentCents: number;
}

/**
 * What the Assistant may spend, which is **not** what is left of the cap.
 *
 * `aiAccess` asks one question — is there budget — and answers it
 * first-come-first-served. That is right for a session and wrong here, because
 * the assistant and the session draw from the same `spendLedger`: a chatty
 * afternoon would otherwise leave a learner unable to start the session they
 * are paying for, which is the support surface starving the product.
 *
 * So the assistant is refused early, against a ceiling with the month's
 * remaining sessions and evaluations already subtracted at §20.2's measured
 * rates. It yields to the product rather than racing it.
 *
 * **Dynamic rather than a static allowance**, and that is the whole point: the
 * reserve shrinks as the month is actually used, so a learner who has taken
 * their sessions gets the rest of the budget for questions, while one who has
 * taken none keeps every penny those sessions will need. A per-plan message cap
 * cannot express that — it bounds the assistant against itself, not against
 * what the month still owes.
 *
 * `aiAccess` is deliberately left alone. Sessions and evaluations behave exactly
 * as before; this is a narrower gate in front of one caller.
 */
export async function assistantAllowance(
  db: Db,
  userId: string,
  planId: PlanId,
  now: Date = new Date(),
): Promise<AssistantAllowance> {
  const plan = PLANS[planId];
  const capCents = plan.spendCapCents;

  const [spentCents, evaluations, sessions] = await Promise.all([
    spentThisPeriod(db, userId, now),
    evaluationsUsed(db, userId, now),
    sessionsThisPeriod(db, userId, now),
  ]);

  // Floored at zero on both counts: somebody who has been granted extra
  // evaluations, or who ran more sessions than a nominal twelve, is owed
  // nothing further — and a negative reserve would hand the assistant a
  // ceiling *above* the cap.
  const evaluationsLeft = Math.max(
    0,
    plan.entitlements.evaluationsPerMonth - evaluations,
  );
  const sessionsLeft = Math.max(
    0,
    (plan.entitlements.sessionsPerMonth ?? SESSIONS_RESERVED) - sessions,
  );

  const reserveCents =
    evaluationsLeft * EVALUATION_COST_CENTS + sessionsLeft * SESSION_COST_CENTS;

  // Never below zero: a plan whose promises already exceed its ceiling would
  // otherwise produce a negative allowance, which reads as "spend anything".
  const allowanceCents = Math.max(0, capCents - reserveCents);

  return {
    blocked: spentCents >= allowanceCents,
    allowanceCents,
    reserveCents,
    spentCents,
  };
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
