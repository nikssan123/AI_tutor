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
 * "1 learning session" / "3 learning sessions", counted correctly.
 *
 * Exported because the billing screen builds the same phrase inside a different
 * sentence, and two places interpolating a number next to a hard-coded plural
 * is exactly how one of them ends up reading "1 learning sessions a month".
 */
export const sessionCount = (n: number): string =>
  `${n} learning ${n === 1 ? "session" : "sessions"}`;

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
  if (n === null) return "As many learning sessions as you want";

  // Pluralised rather than interpolated blind. Free went to one the day the
  // free tier started giving away a whole plan and its first lesson, and the
  // card read "1 learning sessions a month" — the kind of sentence that makes
  // a reader trust the rest of the page slightly less.
  return `${sessionCount(n)} a month`;
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
      // the axis a visitor scans down: 1/3/10 marked, 1/unlimited/unlimited
      // sessions, 15/30/30 questions. Reordering them per card — which this
      // list used to do, leading with sessions here and with marking below —
      // makes three cards that have to be read rather than compared.
      //
      // **The first two are load-bearing beyond this file.** The landing page's
      // price band renders `features.slice(0, 2)`, on the documented promise
      // that they are the bounding quantities; a qualitative line pushed into
      // those slots would break the comparison the band exists to make.
      marked("free"),
      sessions("free"),
      tutor("free"),
      /*
       * What free stopped being, said on the card.
       *
       * It used to be "the seven subjects we happen to have", which is a
       * dispiriting thing to offer and the reason most visitors who wanted
       * something specific bounced. It is now any subject at all: the course
       * gets built, the whole plan is visible, and the first lesson is free.
       * What is given away is the part that proves the product works on *your*
       * subject, which is the only part worth giving away.
       */
      "Any subject — we'll build the course if we don't have it",
      // And immediately, where it stops — both places. A learner who discovers
      // either limit by hitting it has been misled by a list that mentioned
      // only what was included; §4.2 law 3 applies to a price list as much as
      // to a mastery claim, and free now has two boundaries rather than one.
      "Your full plan, and the first lesson of it",
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
    // Currency-neutral, unlike every earlier version of this string. Both
    // renderers build their own label from `formatMoney` because the amount
    // differs by column, and a constant reading "Start for €3" beside a card
    // priced in dollars is the drift this file exists to prevent.
    cta: "Start the trial",
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
      // Not "any subject" any more — free has that. What Learner adds is every
      // lesson on it, and as many subjects as you want to start.
      "Every lesson on every course, and as many courses as you like",
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
 *
 * **Both amounts are placeholders.** The opening figure was typed — "€3 today"
 * — while the renewal was interpolated, so a dollar reader got a euro sum and a
 * dollar sum in the same sentence. It scanned as harmless while both columns
 * read 3, and stopped being harmless the moment the columns diverged. This is
 * the one paragraph on the site that gets read back to us during a chargeback;
 * it does not get to carry a currency it made up.
 *
 * `{trial}` is the trial fee and `{price}` the Pro monthly, both formatted in
 * the currency the page is rendering.
 */
export const TRIAL_TERMS =
  "{trial} today. Full Pro access for 4 days. After 4 days your subscription renews automatically at {price}/month until cancelled. Cancel anytime from your account.";
