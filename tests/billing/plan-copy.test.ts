import { describe, expect, it } from "vitest";
import { PLANS, type PlanId } from "@/lib/billing/catalog";
import { PLAN_COPY, TRIAL_TERMS } from "@/lib/billing/plan-copy";

/**
 * The words on the price cards.
 *
 * This file had no suite of its own until now — it was covered incidentally by
 * the two pages that render it, which is coverage without a guard: every
 * assertion there is that some string appeared, and a card can say something
 * wrong at full coverage. What is actually worth protecting is the handful of
 * rules the copy follows, because they are the ones that decay the moment
 * somebody adds a line in a hurry.
 */

/** The three cards `/pricing` shows, left to right. */
const LISTED = ["free", "learner", "pro"] as const;

const card = (id: PlanId) => PLAN_COPY[id].features;

describe("the numbers", () => {
  it.each(Object.keys(PLAN_COPY) as PlanId[])(
    "reads %s's marking allowance from the catalog rather than typing it",
    (id) => {
      // A card that says ten while the meter allows five is not a copy bug, it
      // is a refund.
      expect(card(id)[0]).toContain(
        String(PLANS[id].entitlements.evaluationsPerMonth),
      );
    },
  );

  it("says the tutor limit on every card, including where it is unchanged", () => {
    for (const id of Object.keys(PLAN_COPY) as PlanId[]) {
      expect(card(id)[2]).toContain(
        String(PLANS[id].entitlements.tutorTurnsPerSession),
      );
    }
  });

  it("only writes 'as many as you want' where the meter genuinely has no wall", () => {
    for (const id of Object.keys(PLAN_COPY) as PlanId[]) {
      const capped = PLANS[id].entitlements.sessionsPerMonth !== null;
      expect(/as many/i.test(card(id)[1]!)).toBe(!capped);
    }
  });

  it("puts the same three quantities first, in the same order, on every card", () => {
    // The scan axis. A visitor compares three cards by running their eye down
    // them, and this list used to lead with sessions on Free and with marking
    // on the two below it — three cards that had to be read rather than
    // compared.
    for (const id of Object.keys(PLAN_COPY) as PlanId[]) {
      const [first, second, third] = card(id);
      expect(first).toMatch(/graded project/);
      expect(second).toMatch(/session/i);
      expect(third).toMatch(/tutor/);
    }
  });
});

describe("the roll-up lines", () => {
  const rollUp = (id: PlanId) =>
    card(id).find((line) => line.startsWith("Everything in "));

  it("inherits up the page order — Learner from Free, Pro from Learner", () => {
    expect(rollUp("learner")).toContain("Everything in Free");
    expect(rollUp("pro")).toContain("Everything in Learner");
  });

  it("never leaves a bare 'Everything in X'", () => {
    // The emptiest line a card can carry: the reader has to hold the card to
    // its left in their head and diff it.
    for (const id of LISTED) {
      const line = rollUp(id);
      if (line) expect(line).toMatch(/, including /);
    }
  });

  it("names something the card does not already say", () => {
    // "Everything in Learner" sitting under three lines copied from Learner is
    // how the most expensive card on the page came to spend its bottom half
    // telling the reader nothing.
    for (const id of LISTED) {
      const line = rollUp(id);
      if (!line) continue;

      const named = line.split(", including ")[1]!;
      const others = card(id).filter((other) => other !== line);
      for (const other of others) {
        expect(other.toLowerCase()).not.toContain(named.toLowerCase());
      }
    }
  });

  it("does not put one on Free, which has nothing beneath it", () => {
    expect(rollUp("free")).toBeUndefined();
  });
});

describe("what the cards will not do", () => {
  const everyLine = Object.values(PLAN_COPY).flatMap((copy) => [
    copy.pitch,
    ...copy.features,
    copy.cta,
  ]);

  it("never mentions cents, tokens, models by name or spend", () => {
    // §6 of the brief. "Our most capable models" is the whole of what a card is
    // allowed to say about which model ran.
    for (const line of everyLine) {
      expect(line).not.toMatch(/token|opus|sonnet|¢|cent\b|spend|quota/i);
    }
  });

  it("warns free about the limit it would otherwise discover by hitting it", () => {
    // §4.2 law 3 applies to a price list as much as to a mastery claim.
    expect(card("free").join(" ")).toMatch(/standard path .*not a tailored one/);
  });

  it("keeps a card for the trial even though /pricing no longer draws one", () => {
    // The trial folded into Pro's card on the page. `/account/billing` still
    // renders this entry for somebody currently in their four days, and
    // deleting it would blank that screen rather than tidy this file.
    expect(PLAN_COPY.trial.features.length).toBeGreaterThan(0);
  });

  it("states the renewal in full, in money and in days", () => {
    // §13 risk 3: a renewal nobody expected is a chargeback rather than
    // revenue.
    expect(TRIAL_TERMS).toContain("{price}");
    expect(TRIAL_TERMS).toMatch(/renews automatically/);
    expect(TRIAL_TERMS).toMatch(/Cancel anytime/);
  });
});
