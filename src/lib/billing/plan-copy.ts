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
 * `src/lib/goals/store.ts`) and §4.2 law 3 applies to our own price list as
 * much as to a mastery claim.
 *
 * **3. And nothing is left out that a learner would want warned about.** The
 * free card says what it does *not* include — the standard path rather than a
 * tailored one — because a list that mentions only what is included is how
 * somebody discovers a limit by hitting it. Every such line is enforced: the
 * session count in `startSessionAction`, the curriculum in
 * `generateValidatedCurriculum`, generated packs in `/start`.
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
 * The session line, read from the catalog like every other number here.
 *
 * "Unlimited" is only ever written for a plan whose `sessionsPerMonth` is
 * genuinely `null`. The spend cap still bounds it — §14.9.7 limit 1 has not
 * gone anywhere — but a paid learner reaching that ceiling is a support
 * conversation about an unusual month, not a limit anybody should be sold.
 */
const sessions = (planId: PlanId): string => {
  const n = PLANS[planId].entitlements.sessionsPerMonth;
  return n === null
    ? "As many learning sessions as you want"
    : `${n} learning sessions a month`;
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
      sessions("free"),
      marked("free"),
      GRADING_LINE,
      // Said plainly rather than omitted. A learner who finds out on their
      // fourth session that free stops at three has been misled by a list that
      // only mentioned what was included — §4.2 law 3 applies to a price list
      // as much as to a mastery claim.
      "The standard path for your subject, not a tailored one",
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
      sessions("trial"),
      "A path built around your diagnostic, not the default order",
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
      sessions("learner"),
      "A path built around your diagnostic, not the default order",
      "Any subject — we'll build the course if we don't have it",
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
      sessions("pro"),
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
