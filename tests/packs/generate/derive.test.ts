import { describe, expect, it } from "vitest";
import {
  MAX_GENERATED_TIER,
  PRIORS_BY_LEVEL,
  SELF_REPORT_TIER,
  nameResolver,
  normaliseWeights,
  skillRef,
  slugify,
  tierFor,
  uniqueSlugs,
} from "@/lib/packs/generate/derive";
import type { DraftCriterion } from "@/lib/contracts/pack";
import { Workspace } from "@/lib/packs/types";

describe("slugify", () => {
  it("produces a slug the pack schema accepts", () => {
    expect(slugify("Ownership and Moves")).toBe("ownership-and-moves");
    expect(slugify("Handle errors with Result, Option, and ?")).toBe(
      "handle-errors-with-result-option-and",
    );
  });

  it("folds diacritics rather than dropping the letters", () => {
    // "Séparation" losing its accent must not become "sparation".
    expect(slugify("Séparation des préoccupations")).toBe(
      "separation-des-preoccupations",
    );
  });

  it("never leaves a leading or trailing hyphen", () => {
    expect(slugify("  !!! Async / Await !!!  ")).toBe("async-await");
  });

  it("stays inside the schema's 64-character bound", () => {
    const slug = slugify("a".repeat(200));
    expect(slug.length).toBeLessThanOrEqual(64);
  });

  it("does not end in a hyphen after being truncated", () => {
    // A name that happens to put a word boundary at character 64 would
    // otherwise produce a trailing hyphen, which the schema rejects.
    const slug = slugify(`${"ab ".repeat(30)}`);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns something usable for a name made only of punctuation", () => {
    expect(slugify("!!!")).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("uniqueSlugs", () => {
  it("disambiguates two names that slugify the same", () => {
    const slugs = uniqueSlugs(["Joins", "JOINs"]);
    expect(slugs.get("Joins")).toBe("joins");
    expect(slugs.get("JOINs")).toBe("joins-2");
  });

  it("maps a repeated name to the slug it already has", () => {
    const slugs = uniqueSlugs(["Joins", "Joins"]);
    expect(slugs.size).toBe(1);
    expect(slugs.get("Joins")).toBe("joins");
  });

  it("keeps disambiguating past the second collision", () => {
    const slugs = uniqueSlugs(["Joins", "JOINs", "joins", "JoInS"]);
    expect([...new Set(slugs.values())]).toHaveLength(4);
  });
});

describe("nameResolver", () => {
  const slugOf = uniqueSlugs(["Ownership and `Copy`", "Borrowing"]);

  it("resolves an exact name", () => {
    expect(nameResolver(slugOf)("Borrowing")).toBe("borrowing");
  });

  it("resolves a name whose punctuation the model tidied", () => {
    // The failure that cost two whole generations: the item author returns the
    // skill without its backticks and every item for it was dropped.
    expect(nameResolver(slugOf)("Ownership and Copy")).toBe(
      "ownership-and-copy",
    );
  });

  it("prefers a reference over a name", () => {
    const refs = new Map([["s0", "borrowing"]]);
    expect(nameResolver(slugOf, refs)("s0")).toBe("borrowing");
  });

  it("tolerates whitespace around a reference", () => {
    const refs = new Map([["s1", "ownership-and-copy"]]);
    expect(nameResolver(slugOf, refs)(" s1 ")).toBe("ownership-and-copy");
  });

  it("gives a colliding loose form to the name declared first", () => {
    // Two distinct skills whose names slugify identically: the first keeps the
    // loose mapping so a later one cannot silently steal it.
    const collide = uniqueSlugs(["Joins", "JOINs"]);
    expect(nameResolver(collide)("joins")).toBe("joins");
  });

  it("still refuses a name that is genuinely not in the graph", () => {
    expect(nameResolver(slugOf)("Async runtimes")).toBeUndefined();
  });
});

describe("skillRef", () => {
  it("is short and has nothing a model could tidy", () => {
    expect(skillRef(0)).toBe("s0");
    expect(skillRef(13)).toBe("s13");
  });
});

describe("BKT priors", () => {
  it("covers every level the contract allows", () => {
    expect(Object.keys(PRIORS_BY_LEVEL).sort()).toEqual([
      "advanced",
      "core",
      "foundational",
      "specialist",
    ]);
  });

  it("makes a foundational skill likelier to be already known than a specialist one", () => {
    // The monotonicity is the whole reason these are seeded rather than guessed.
    expect(PRIORS_BY_LEVEL.foundational.pInit).toBeGreaterThan(
      PRIORS_BY_LEVEL.core.pInit,
    );
    expect(PRIORS_BY_LEVEL.core.pInit).toBeGreaterThan(
      PRIORS_BY_LEVEL.advanced.pInit,
    );
    expect(PRIORS_BY_LEVEL.advanced.pInit).toBeGreaterThan(
      PRIORS_BY_LEVEL.specialist.pInit,
    );
  });

  it("keeps every prior a probability", () => {
    for (const priors of Object.values(PRIORS_BY_LEVEL)) {
      for (const value of Object.values(priors)) {
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThan(1);
      }
    }
  });
});

describe("tierFor", () => {
  it("never lets a generated pack claim tier 1", () => {
    /*
     * §7.2 tier 1 licenses the claim "Verified: this works", and it is earned by
     * executing the artefact. A generated pack has no evaluator and no review,
     * so the claim is one it cannot honour in any workspace.
     */
    for (const workspace of Workspace.options) {
      expect(tierFor(workspace, false)).toBeGreaterThan(1);
    }
    expect(Math.min(...Object.values(MAX_GENERATED_TIER))).toBe(2);
  });

  it("puts a self-report skill at tier 5 whatever the workspace", () => {
    for (const workspace of Workspace.options) {
      expect(tierFor(workspace, true)).toBe(SELF_REPORT_TIER);
    }
  });

  it("weakens the claim for workspaces whose evidence is harder to judge", () => {
    expect(tierFor("code", false)).toBeLessThan(tierFor("media", false));
    expect(tierFor("media", false)).toBeLessThan(tierFor("audio", false));
  });
});

describe("normaliseWeights", () => {
  const criterion = (weight: number): DraftCriterion => ({
    name: `c${weight}`,
    description: "long enough to pass",
    weight,
    bands: {
      absent: "a",
      developing: "d",
      competent: "c",
      strong: "s",
    },
  });

  it("turns relative importance into weights summing to exactly 1", () => {
    const weights = normaliseWeights([1, 1, 1, 1].map(criterion));
    expect(weights.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("sums to exactly 1 for a division that does not terminate", () => {
    // Three equal criteria are 0.333… each; the validator blocks anything more
    // than 0.001 from 1, and floating point — not the model — is the risk here.
    const weights = normaliseWeights([1, 1, 1].map(criterion));
    expect(weights.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("preserves the ordering of importance", () => {
    const weights = normaliseWeights([3, 1, 1, 1].map(criterion));
    expect(weights[0]).toBeGreaterThan(weights[1]!);
  });

  it("sums to 1 across a range of awkward shapes", () => {
    for (const shape of [
      [7, 3],
      [1, 2, 3, 4, 5, 6, 7],
      [0.1, 0.2, 0.7],
      [99, 1, 1, 1],
    ]) {
      const weights = normaliseWeights(shape.map(criterion));
      expect(Math.abs(weights.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(
        0.0001,
      );
    }
  });
});
