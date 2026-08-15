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
 * The tutor line, in the learner's unit rather than ours.
 *
 * A "turn" is our word — `turnsTaken` counts `role = "user"` rows, which is
 * literally one thing the learner asked — and nobody counts their own turns.
 * So the card says questions.
 *
 * On every card, including the ones where the number is the same, because a
 * conversation limit somebody was never told about produces exactly the
 * "found out on my fourth session" experience the free card's own line exists
 * to prevent.
 */
const tutor = (planId: PlanId): string =>
  `${PLANS[planId].entitlements.tutorTurnsPerSession} questions to the tutor in a session`;

/**
 * The roll-up line — "Everything in Free" — with the thing it rolls up named.
 *
 * A bare "Everything in X" is the emptiest line a pricing card can carry: the
 * reader has to hold the card to its left in their head and diff it. Worse, on
 * these three cards it was very nearly false. Free's list is mostly *smaller
 * numbers*, all of which the card above already restates, so "Everything in
 * Free" on Learner resolved to exactly one item — the ledger — and said none of
 * it.
 *
 * So each roll-up names the one thing from the tier below that this card does
 * not otherwise state. It still signals inheritance, and it also carries news.
 */
const inherits = (tier: string, item: string): string =>
  `Everything in ${tier}, including ${item}`;

export const PLAN_COPY: Record<PlanId, PlanCopy> = {
  free: {
    id: "free",
    name: "Free",
    pitch: "See whether this works on you, without paying to find out.",
    features: [
      // The same three quantities, in the same order, on every card. They are
      // the axis a visitor scans down: 1/3/10 marked, 2/unlimited/unlimited
      // sessions, 15/30/30 questions. Reordering them per card — which this
      // list used to do, leading with sessions here and with marking below —
      // makes three cards that have to be read rather than compared.
      marked("free"),
      sessions("free"),
      tutor("free"),
      // Said plainly rather than omitted. A learner who finds out on their
      // third session that free stops at two has been misled by a list that
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
      tutor("trial"),
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
      tutor("learner"),
      "A path built around your diagnostic, not the default order",
      "Any subject — we'll build the course if we don't have it",
      inherits("Free", "your mastery ledger"),
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
      tutor("pro"),
      // Pro's own two lines. Everything else it shares with Learner is carried
      // by the roll-up below rather than restated: this card used to spend
      // three of its six lines repeating Learner's sessions, Learner's tutor
      // limit and Learner's tailored path, and then say "Everything in
      // Learner" underneath — the reader learned nothing from the bottom half
      // of the most expensive card on the page.
      "Our most capable models on the work that needs them",
      "Priority marking",
      inherits("Learner", "a path built around your diagnostic"),
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
