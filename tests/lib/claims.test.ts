import { describe, expect, it } from "vitest";
import { EVAL_TIER_CLAIM, evalTierClaim, MATURITY_CLAIM } from "@/lib/claims";

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
