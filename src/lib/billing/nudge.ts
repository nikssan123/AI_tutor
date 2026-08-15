import type { Entitlements, PlanId } from "./catalog";
import { PLANS } from "./catalog";

/**
 * When to ask somebody to pay, and what to say — one decision, in one place.
 *
 * Scattering upgrade copy across five screens is how a product ends up nagging:
 * each prompt is reasonable on its own and nobody ever sees them together. This
 * module is the whole list, so the tone can be read at once and the total
 * frequency is a thing somebody chose rather than a thing that accumulated.
 *
 * ## Three rules
 *
 * **1. Only at a wall.** A nudge appears when a learner has just been stopped by
 * a limit, or has just been given the thing the product is *for*. Never on a
 * timer, never on a page they merely visited, never twice for one event.
 *
 * **2. Only to somebody who could act on it.** A plan with no ceiling in front
 * of it is not shown a way past one. That is why every branch below checks the
 * entitlement rather than the plan name: a Learner who has spent their three
 * evaluations is in the same position as a free learner who has spent one, and
 * a referral grant holder is in neither.
 *
 * **3. Never trade on our own failure.** There is no nudge for a model that
 * refused, a generation that failed, or a webhook that did not arrive. Selling
 * on the back of a fault is the fastest way to make the paywall feel like the
 * point of the product. `lessonForBlock`'s `capped` and its plain failure are
 * deliberately different outcomes for this reason.
 *
 * The copy states the consequence and the way out, in that order, and never
 * mentions cents or tokens — §6 of the brief, and the standing note about
 * implementation details in user copy.
 */

export const NUDGE_REASONS = [
  /** The strongest moment in the product: their work has just been marked. */
  "evaluation_landed",
  "evaluations_spent",
  "sessions_spent",
  "tutor_turns_spent",
] as const;

export type NudgeReason = (typeof NUDGE_REASONS)[number];

export interface Nudge {
  reason: NudgeReason;
  /** One line. What just happened, from the learner's side. */
  headline: string;
  /** One or two sentences. What a paid plan would have done instead. */
  body: string;
  cta: string;
  href: string;
}

const PRICING = "/pricing";

/** How many graded projects the plan we are selling marks a month. */
const PRO_EVALUATIONS = PLANS.pro.entitlements.evaluationsPerMonth;

/**
 * The one moment worth interrupting: a graded verdict has just landed.
 *
 * §19.3 calls the first graded submission the activation event and everything
 * before it "preamble". It is also the only moment at which a learner has
 * first-hand evidence of the thing no competitor does — so it is both the most
 * persuasive place to ask and the most honest one, because the ask is "more of
 * what you just had" rather than "trust us".
 *
 * Shown only when it was their **last** one. Somebody with allowance left is
 * being told to carry on, not to buy.
 */
function evaluationLanded(entitlements: Entitlements): Nudge {
  return {
    reason: "evaluation_landed",
    headline: "That was this month's graded project",
    body:
      entitlements.evaluationsPerMonth === 1
        ? `Free includes one. Pro marks ${PRO_EVALUATIONS} a month against the same public rubrics, quoting your own work back the same way.`
        : `Pro marks ${PRO_EVALUATIONS} a month against the same public rubrics.`,
    cta: "See what Pro includes",
    href: PRICING,
  };
}

export interface NudgeInput {
  planId: PlanId;
  entitlements: Entitlements;
  /** Whether this learner is on a plan they pay for. Grants count as paid. */
  paying: boolean;
  evaluationsUsed: number;
  sessionsUsed: number;
}

/**
 * Whether a wall a learner just hit is worth an upgrade prompt.
 *
 * Returns nothing when the plan has no such wall, which is the common case for
 * everybody paying — and returning nothing is what keeps rule 2 true without
 * every caller having to remember it.
 */
export function nudgeFor(
  reason: NudgeReason,
  input: NudgeInput,
): Nudge | undefined {
  const { entitlements } = input;

  switch (reason) {
    case "evaluation_landed": {
      // Only on the last one, and only where there is a bigger plan to move to.
      const spent = input.evaluationsUsed >= entitlements.evaluationsPerMonth;
      if (!spent) return undefined;
      if (entitlements.evaluationsPerMonth >= PRO_EVALUATIONS) return undefined;
      return evaluationLanded(entitlements);
    }

    case "evaluations_spent": {
      if (entitlements.evaluationsPerMonth >= PRO_EVALUATIONS) return undefined;
      return {
        reason,
        headline: "You've used this month's graded project",
        body: `It comes back on the 1st. Pro marks ${PRO_EVALUATIONS} a month, and everything you have had marked stays yours either way.`,
        cta: "See what Pro includes",
        href: PRICING,
      };
    }

    case "sessions_spent": {
      // `null` is "as many as the ceiling allows" — no wall, so no nudge.
      if (entitlements.sessionsPerMonth === null) return undefined;
      return {
        reason,
        headline: "That's this month's sessions",
        body: "Free includes two. On a paid plan you would have carried straight on — sessions are not counted.",
        cta: "Compare the plans",
        href: PRICING,
      };
    }

    case "tutor_turns_spent": {
      // Everybody has this wall — it is a quality rule, not a paid feature
      // (§17.2's "DON'T BUILD: a general chatbot"). So the prompt only appears
      // where a bigger allowance actually exists to move to.
      const best = PLANS.pro.entitlements.tutorTurnsPerSession;
      if (entitlements.tutorTurnsPerSession >= best) return undefined;
      return {
        reason,
        headline: "That's this session's questions",
        body: `Free allows ${entitlements.tutorTurnsPerSession} a session; a paid plan allows ${best}. Either way the next session starts fresh.`,
        cta: "See what Pro includes",
        href: PRICING,
      };
    }
  }
}
