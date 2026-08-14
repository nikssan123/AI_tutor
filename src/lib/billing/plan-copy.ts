import { PLANS, type PlanId } from "./catalog";

/**
 * What `/pricing` says about each plan — PLAN-MONETIZATION §8.
 *
 * Two rules hold this file together, and both exist because a pricing page is
 * the easiest place in a product to tell a lie by accident.
 *
 * **1. Every number comes from the catalog.** The evaluation counts below are
 * read from `PLANS`, never typed. A page that says "10 graded projects" while
 * the meter allows 5 is not a copy bug, it is a refund.
 *
 * **2. Nothing is claimed that nothing enforces.** There is no "3 active goals"
 * line, because the engine is single-goal by construction (`pauseOthers` in
 * `src/lib/goals/store.ts`) and §4.2 law 3 applies to our own price list as much
 * as to a mastery claim. The same goes for session counts: the spend cap binds
 * tighter than any counter would, so a counter would be a promise with nothing
 * behind it.
 */

export interface PlanCopy {
  readonly id: PlanId;
  readonly name: string;
  /** One line under the name. What this plan is *for*. */
  readonly pitch: string;
  readonly features: readonly string[];
  /** The button. Only one plan on the page gets the filled variant (§8.5.5). */
  readonly cta: string;
  readonly emphasis: boolean;
}

const marked = (planId: PlanId): string => {
  const n = PLANS[planId].entitlements.evaluationsPerMonth;
  return `${n} graded ${n === 1 ? "project" : "projects"} a month`;
};

/**
 * The one claim worth repeating on every card, phrased the same way each time.
 *
 * §4.2 law 1 — a mark is only worth anything if it is anchored in the learner's
 * own work — is the product's whole pitch, and the pricing page is where a
 * visitor decides whether they believe it.
 */
export const GRADING_LINE =
  "Marked against a public rubric, with the evidence quoted back from your own work";

export const PLAN_COPY: Record<PlanId, PlanCopy> = {
  free: {
    id: "free",
    name: "Free",
    pitch: "See whether this works on you, without paying to find out.",
    features: [
      "A skill check and a real plan for any subject",
      marked("free"),
      GRADING_LINE,
      "Your mastery ledger, kept as long as you want it",
    ],
    cta: "Start learning",
    emphasis: false,
  },
  trial: {
    id: "trial",
    name: "Try Pro",
    pitch: "Four days of everything, for the price of a coffee.",
    features: [
      `${PLANS.trial.entitlements.evaluationsPerMonth} graded projects across four days`,
      "The full adaptive curriculum and tutor",
      "Our most capable models on the work that needs them",
      "Cancel before it renews and pay nothing more",
    ],
    cta: "Start for €3",
    emphasis: true,
  },
  learner: {
    id: "learner",
    name: "Learner",
    pitch: "For a steady pace rather than an intense one.",
    features: [
      marked("learner"),
      "The full adaptive curriculum and tutor",
      GRADING_LINE,
      "Everything in Free",
    ],
    cta: "Choose Learner",
    emphasis: false,
  },
  pro: {
    id: "pro",
    name: "Pro",
    pitch: "For getting somewhere specific, on a deadline you set.",
    features: [
      marked("pro"),
      "Our most capable models on the work that needs them",
      "Priority marking",
      "Everything in Learner",
    ],
    cta: "Choose Pro",
    emphasis: false,
  },
};

/**
 * The renewal terms, stated in full.
 *
 * The brief fixes this wording and it must not be softened: a trial that
 * renews on somebody who did not expect it is a chargeback and a refund rather
 * than revenue, and §13 risk 3 counts that as the trial's main danger.
 * `{price}` is filled with the formatted Pro monthly price.
 */
export const TRIAL_TERMS =
  "€3 today. Full Pro access for 4 days. After 4 days your subscription renews automatically at {price}/month until cancelled. Cancel anytime from your account.";
