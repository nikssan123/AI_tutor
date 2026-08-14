import { describe, expect, it } from "vitest";
import {
  EVAL_TIER_CLAIM,
  evalTierClaim,
  GUIDE_CLAIM,
  guideClaim,
  maturityClaim,
  MATURITY_CLAIM,
} from "@/lib/claims";

/**
 * The two tables exist to stop the page and its share card claiming different
 * things, so what is worth pinning is the *shape* of the claims rather than
 * their wording: which direction the honesty runs in.
 */

describe("MATURITY_CLAIM", () => {
  it("never dresses a generated pack up as a checked one", () => {
    expect(MATURITY_CLAIM.curated.tone).toBe("verified");
    expect(MATURITY_CLAIM.generated.tone).toBe("attention");
    expect(MATURITY_CLAIM.generated.label).toMatch(/experimental/i);
  });

  it("reserves 'by hand' for the tier that was written by hand", () => {
    const byHand = Object.entries(MATURITY_CLAIM).filter(([, c]) =>
      /by hand/i.test(c.label),
    );
    expect(byHand.map(([k]) => k)).toEqual(["curated"]);
  });
});

/**
 * **The claim three live pages were making falsely.**
 *
 * `MATURITY_CLAIM.curated` says "Written and checked by hand", and the badge
 * used to be keyed on maturity alone — so SQL, business writing and photography
 * all wore it while carrying `reviewedBy: "Claude Opus 5 (model review)"`. No
 * hand had touched any of them. These tests are the thing that stops it coming
 * back, because the wording is easy to restore by accident and the packs cannot
 * see what the badge says about them.
 */
describe("maturityClaim", () => {
  it("only says 'by hand' when a human actually reviewed it", () => {
    expect(maturityClaim("curated", "human").label).toMatch(/by hand/i);
    for (const review of ["model", null] as const) {
      expect(maturityClaim("curated", review).label, String(review)).not.toMatch(
        /by hand/i,
      );
    }
  });

  /**
   * The tone is the at-a-glance signal and the label is the detail nobody reads
   * on a share card, so `verified` is where an overclaim actually lands. Only a
   * human sign-off earns it — at any depth, but never without one.
   */
  it("reserves the verified tone for a human sign-off", () => {
    const everyCombination = (["curated", "standard", "generated"] as const).flatMap(
      (m) => (["human", "model", null] as const).map((r) => [m, r] as const),
    );
    for (const [maturity, review] of everyCombination) {
      if (maturityClaim(maturity, review).tone === "verified") {
        expect(review, `${maturity}/${review}`).toBe("human");
      }
    }
  });

  /**
   * The bug this function was written to remove, re-entering through its own
   * fallback: a Curated pack with no reviewer fell through to the depth table
   * and printed "Written and checked by hand" again. An unreviewed pack claims
   * no check at any depth.
   */
  it("claims no check for a curated pack nobody has reviewed", () => {
    expect(maturityClaim("curated", null)).toEqual(MATURITY_CLAIM.standard);
    expect(maturityClaim("curated", null).label).not.toMatch(/checked/i);
  });

  /**
   * A promoted Generated pack is Standard: a person read it, but a model wrote
   * it. It claims the check and not the authorship.
   */
  it("does not credit a human reviewer with writing the pack", () => {
    expect(maturityClaim("standard", "human").label).toMatch(/checked by hand/i);
    expect(maturityClaim("standard", "human").label).not.toMatch(/written/i);
  });

  it("says what a model review actually was", () => {
    expect(maturityClaim("curated", "model").label).toMatch(/published curricula/i);
    expect(maturityClaim("standard", "model").label).toMatch(/published curricula/i);
  });

  /**
   * A model wrote it, so a model reviewing it is not a second opinion —
   * "Experimental" survives any review kind. Without this, promoting a
   * generated pack by model review would launder it into a stronger claim.
   */
  it("never lets a review upgrade a generated pack", () => {
    for (const review of ["human", "model", null] as const) {
      expect(maturityClaim("generated", review), String(review)).toEqual(
        MATURITY_CLAIM.generated,
      );
    }
  });

  /**
   * `MaturityBadge` takes `review` as an optional prop, so a call site that
   * forgets it must land on a *weaker* claim, never a stronger one. This is the
   * property that makes the default safe.
   */
  it("understates rather than overstates when the reviewer is omitted", () => {
    for (const maturity of ["curated", "standard", "generated"] as const) {
      expect(maturityClaim(maturity)).toEqual(maturityClaim(maturity, null));
      expect(maturityClaim(maturity).tone).not.toBe("verified");
    }
  });
});

describe("guideClaim", () => {
  it("gives a hand-read guide the strong claim, and only that one", () => {
    expect(guideClaim("human")).toEqual(GUIDE_CLAIM.human);
    expect(guideClaim("human").tone).toBe("verified");
    for (const review of ["model", null] as const) {
      expect(guideClaim(review).tone, String(review)).not.toBe("verified");
    }
  });

  /**
   * The property that matters, and the same one `maturityClaim` is held to: a
   * product arguing that a model's opinion is not proof cannot render a model's
   * opinion in the same green as a person's.
   */
  it("only ever says 'by hand' when a hand was involved", () => {
    for (const review of ["model", null] as const) {
      expect(guideClaim(review).label, String(review)).not.toMatch(/by hand/i);
    }
  });

  /** A model review is real work, and it is not a subject expert reading it. */
  it("says what a model review actually was, in both halves", () => {
    expect(guideClaim("model").label).toMatch(/sources checked/i);
    expect(guideClaim("model").label).toMatch(/not expert-reviewed/i);
  });

  it("calls an unreviewed guide a draft rather than staying silent", () => {
    expect(guideClaim(null)).toEqual(GUIDE_CLAIM.none);
    expect(guideClaim(null).tone).toBe("attention");
  });
});

describe("evalTierClaim", () => {
  it("promises running the work only at tier 1", () => {
    expect(evalTierClaim(1).label).toMatch(/run your work/i);
    expect(evalTierClaim(2).label).not.toMatch(/run your work/i);
  });

  it("says outright that tier 5 does not count as proof", () => {
    expect(evalTierClaim(5).label).toMatch(/doesn't count as proof/i);
    expect(evalTierClaim(5).tone).toBe("neutral");
  });

  it("falls to the weakest claim for a tier it does not recognise", () => {
    // Not the middle of the table: a pack carrying an unknown tier is one we
    // know nothing about, and the safe thing to say about work we cannot grade
    // is that it is not proof.
    expect(evalTierClaim(9)).toEqual(EVAL_TIER_CLAIM[5]);
    expect(evalTierClaim(0)).toEqual(EVAL_TIER_CLAIM[5]);
  });

  it("only claims 'verified' where the evaluator can actually check something", () => {
    for (const [tier, claim] of Object.entries(EVAL_TIER_CLAIM)) {
      if (claim.tone === "verified") expect(Number(tier)).toBeLessThanOrEqual(2);
    }
  });
});
