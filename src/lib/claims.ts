import type { StatusTone } from "@/components/ui";

/**
 * The two claims the product makes *about itself* on a subject or a project:
 * how the material got written (§7.1), and what "marked" is going to mean when
 * the work is handed in (§7.2).
 *
 * They live here rather than inside the components that draw them because they
 * are now drawn in two places that a reviewer cannot see at the same time — the
 * page, and the share card the page generates. A card is exactly where a claim
 * gets quietly upgraded: nobody scrolls a feed with the rubric open, and
 * "Experimental" is the least shareable true thing we could put on one. One
 * table means the card cannot say a kinder thing than the page it links to.
 */

export type Maturity = "curated" | "standard" | "generated";

export interface Claim {
  tone: StatusTone;
  label: string;
}

/** §7.1 — depth is declared, never faked. */
export const MATURITY_CLAIM: Record<Maturity, Claim> = {
  curated: { tone: "verified", label: "Written and checked by hand" },
  standard: { tone: "neutral", label: "Covers the subject well" },
  generated: { tone: "attention", label: "Experimental — help us improve it" },
};

/**
 * §7.2 — what the evaluator can actually honour at each tier, in the words a
 * learner reads before they commit, not after they are disappointed.
 */
export const EVAL_TIER_CLAIM: Record<number, Claim> = {
  1: { tone: "verified", label: "We run your work and check the answer is right" },
  2: { tone: "verified", label: "We mark it against a checklist you can read first" },
  3: {
    tone: "attention",
    label: "We check the technical side. Whether it's any good is your call",
  },
  4: { tone: "attention", label: "We score the parts that can be measured" },
  5: { tone: "neutral", label: "You log this one yourself. It doesn't count as proof" },
};

/**
 * An unknown tier falls to 5, which is the *weakest* claim in the table rather
 * than a neutral-looking middle one. A pack that arrives with a tier we do not
 * recognise is a pack we know nothing about, and the only safe thing to say
 * about work we cannot grade is that it does not count as proof.
 */
export function evalTierClaim(tier: number): Claim {
  return EVAL_TIER_CLAIM[tier] ?? EVAL_TIER_CLAIM[5]!;
}
