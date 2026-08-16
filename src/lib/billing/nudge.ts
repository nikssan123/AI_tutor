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
  /** The second strongest: the course they asked for has just been written. */
  "pack_built",
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
 * What the button says, and where it goes.
 *
 * One helper rather than a `cta`/`href` pair written out four times, for the
 * reason this module exists at all: the four walls used to say "See what Pro
 * includes" three times and "Compare the plans" once, which is not a decision
 * anybody made — it is what happens when copy is written a screen at a time.
 *
 * **The trial is the version of this ask that somebody can say yes to today.**
 * Every nudge here used to point at a €12.99 subscription, and the cheapest yes
 * in the catalogue is four days for €3. Somebody who has just hit a wall is
 * deciding whether this product works *on them*, which is exactly the question
 * a four-day trial answers and a monthly subscription defers.
 *
 * The destination is `/pricing` either way, and deliberately not an anchor into
 * the trial band further down that page: `/pricing`'s single filled button *is*
 * the trial (§8.5.5), so the top of the page is already where the offer is.
 * Scrolling somebody past the button to reach the paragraph explaining the
 * button would be a link that moves them away from what it promised.
 *
 * No price in the label. The amount is localised per currency on the page that
 * charges it, and a nudge quoting "€3" to somebody who checks out in dollars is
 * the drift `/pricing` has its own rule about.
 */
function callToAction(trialEligible: boolean): Pick<Nudge, "cta" | "href"> {
  return {
    cta: trialEligible ? "Try everything for four days" : "See what Pro includes",
    href: PRICING,
  };
}

/**
 * The free tier's lesson allowance, in words, for the one nudge that states the
 * deal before the learner reaches it.
 *
 * Derived rather than written out, because "the first lesson" is only true
 * while `lessonsPerCourse` is 1 — and a nudge that keeps saying it after the
 * number changes is the same class of bug as the sessions copy that promised
 * two when the catalogue allowed one.
 */
function lessonAllowance(lessons: number): string {
  return lessons === 1 ? "the first lesson" : `${lessons} lessons`;
}

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
function evaluationLanded(
  entitlements: Entitlements,
  action: Pick<Nudge, "cta" | "href">,
): Nudge {
  return {
    reason: "evaluation_landed",
    headline: "That was this month's graded project",
    body:
      entitlements.evaluationsPerMonth === 1
        ? `Free includes one. Pro marks ${PRO_EVALUATIONS} a month against the same public rubrics, quoting your own work back the same way.`
        : `Pro marks ${PRO_EVALUATIONS} a month against the same public rubrics.`,
    ...action,
  };
}

export interface NudgeInput {
  planId: PlanId;
  entitlements: Entitlements;
  /** Whether this learner is on a plan they pay for. Grants count as paid. */
  paying: boolean;
  /**
   * Whether the four-day trial is still available to this account.
   *
   * Decides the wording of the ask, never whether there is one: somebody who
   * has already had their four days still meets the same walls and is still
   * shown the same way past them, just without being offered a trial they
   * cannot take a second time.
   */
  trialEligible: boolean;
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
  const action = callToAction(input.trialEligible);

  switch (reason) {
    case "evaluation_landed": {
      // Only on the last one, and only where there is a bigger plan to move to.
      const spent = input.evaluationsUsed >= entitlements.evaluationsPerMonth;
      if (!spent) return undefined;
      if (entitlements.evaluationsPerMonth >= PRO_EVALUATIONS) return undefined;
      return evaluationLanded(entitlements, action);
    }

    /*
     * A course this learner asked for has just been written for them.
     *
     * The only nudge in this file that fires before a wall rather than at one,
     * and it earns that under rule 1's second clause — "or has just been given
     * the thing the product is *for*". A generated pack is the largest single
     * thing this product ever does on request: six answers, three model calls,
     * and a subject that did not exist when they signed up.
     *
     * **It states the deal rather than selling past it**, and that is the whole
     * design. A free learner meets `lessonsPerCourse` at lesson two, in
     * `lessonForBlock`, with no warning — and a limit discovered by walking into
     * it reads as a bait-and-switch even when the free tier is generous. Said
     * here, at the moment the plan appears, the same limit is a price on a thing
     * they can see the whole of. That is the version somebody can decide about.
     *
     * Gated on the lesson wall existing at all, per rule 2: a paying learner who
     * commissions a pack is shown nothing, because there is nothing they would
     * be buying.
     */
    case "pack_built": {
      const lessons = entitlements.lessonsPerCourse;
      if (lessons === null) return undefined;
      return {
        reason,
        headline: "Your course is written",
        body: `The whole plan is yours to read — every skill, in the order they build on each other. Free includes ${lessonAllowance(lessons)} on it and one graded project; a paid plan opens the rest.`,
        ...action,
      };
    }

    case "evaluations_spent": {
      if (entitlements.evaluationsPerMonth >= PRO_EVALUATIONS) return undefined;
      return {
        reason,
        headline: "You've used this month's graded project",
        body: `It comes back on the 1st. Pro marks ${PRO_EVALUATIONS} a month, and everything you have had marked stays yours either way.`,
        ...action,
      };
    }

    case "sessions_spent": {
      // `null` is "as many as the ceiling allows" — no wall, so no nudge.
      const sessions = entitlements.sessionsPerMonth;
      if (sessions === null) return undefined;
      return {
        reason,
        headline: "That's this month's sessions",
        // Counted off the catalogue, not written out. This sentence said "Free
        // includes two" for as long as the free tier had allowed one — the only
        // hard-coded number in this file, wrong, at the exact moment somebody is
        // deciding whether our pricing can be trusted.
        body: `Free includes ${sessions === 1 ? "one a month" : `${sessions} a month`}. On a paid plan you would have carried straight on — sessions are not counted.`,
        ...action,
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
        ...action,
      };
    }
  }
}
