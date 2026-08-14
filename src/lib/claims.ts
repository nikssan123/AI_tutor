import type { StatusTone } from "@/components/ui";
import type { ReviewKind } from "@/lib/packs/types";

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
 * What a model review is allowed to say, which is the thing it actually did:
 * every pack was read against the tutorials, university courses and standard
 * texts that teach the subject, and the divergences written down in
 * `CURRICULUM-SOURCES.md`. That is a real check and it is not a person, so it
 * gets its own label rather than borrowing either neighbour's.
 *
 * `neutral`, not `verified`. Tone is the at-a-glance signal and the label is
 * the detail nobody reads on a share card, so the tone is where an overclaim
 * actually lands. A product whose whole argument is that a model's opinion is
 * not proof cannot put a model's opinion in the same green as a person's —
 * that is the same reasoning §7.2 uses to give tier 3 `attention` instead.
 */
const CHECKED_AGAINST_SOURCES: Claim = {
  tone: "neutral",
  label: "Checked against published curricula",
};

/** A person read it, but it is not one of the deeply-authored packs. */
const CHECKED_BY_HAND: Claim = { tone: "verified", label: "Checked by hand" };

/**
 * §7.1 — the claim a pack is allowed to make about itself, from *both* facts
 * that decide it: how deep the material is, and who checked it.
 *
 * Keying on `maturity` alone is what let three indexed pages say "Written and
 * checked by hand" about packs no hand had touched. The rules, in order:
 *
 * - **Generated wins outright.** A pack a model wrote cannot be promoted by a
 *   model reviewing it; "Experimental" is the whole truth about it.
 * - **"By hand" needs a hand**, and only the Curated tier gets the "written"
 *   half — a promoted Standard pack was read by a person but authored by a
 *   model, so it claims the check and not the authorship.
 * - **A model review says what it is**, at any depth.
 * - **An unreviewed pack claims no check at all**, whatever its depth. This is
 *   the case the first draft of this function got wrong: it fell through to
 *   `MATURITY_CLAIM[maturity]`, so a Curated pack nobody had opened went
 *   straight back to "Written and checked by hand" — the very sentence this
 *   function exists to stop. Caught by its own test rather than in review.
 *
 * Omitting `review` therefore *understates* — the badge can only get weaker,
 * never stronger, which is the direction a forgotten argument should fail in.
 */
export function maturityClaim(
  maturity: Maturity,
  review: ReviewKind | null = null,
): Claim {
  if (maturity === "generated") return MATURITY_CLAIM.generated;
  if (review === "human") {
    return maturity === "curated" ? MATURITY_CLAIM.curated : CHECKED_BY_HAND;
  }
  if (review === "model") return CHECKED_AGAINST_SOURCES;
  return MATURITY_CLAIM.standard;
}

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
