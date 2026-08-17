import { describe, expect, it } from "vitest";
import {
  MAX_GENERATED_TIER,
  PRIORS_BY_LEVEL,
  SELF_REPORT_TIER,
  nameResolver,
  normaliseWeights,
  numberedSlug,
  reconcileEvidence,
  skillRef,
  slugify,
  tierFor,
  uniqueSlugs,
} from "@/lib/packs/generate/derive";
import type { DraftCriterion } from "@/lib/contracts/pack";
import { MAX_PROJECT_IMAGES, MAX_SLUG_LENGTH, Workspace } from "@/lib/packs/types";

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

describe("numberedSlug", () => {
  /**
   * The 297¢ regression, in one assertion.
   *
   * Item slugs were `${skill}-${n}`. `slugify` caps a skill at exactly
   * `MAX_SLUG_LENGTH`, so a long skill name overflowed the moment the counter
   * was appended, the pack failed its own schema, and four paid-for model calls
   * were thrown away — three times, because the throw read as transient to the
   * queue.
   */
  const LONG = "a".repeat(MAX_SLUG_LENGTH);

  it("never exceeds the cap, however long the base is", () => {
    for (const n of [1, 9, 10, 99, 100]) {
      const slug = numberedSlug(LONG, n, new Set());
      expect(slug.length, `n=${n}`).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    }
  });

  it("keeps the number, because that is what makes it an item", () => {
    expect(numberedSlug(LONG, 7, new Set()).endsWith("-7")).toBe(true);
  });

  it("leaves a short base exactly as it was", () => {
    // The overwhelming case. Trimming must not touch a slug that fits.
    expect(numberedSlug("join-grain", 3, new Set())).toBe("join-grain-3");
  });

  it("disambiguates two bases that trim to the same stem", () => {
    // Trimming is what creates this: these differ only past the cap.
    const used = new Set<string>();
    const first = numberedSlug(`${LONG}xx`, 1, used);
    const second = numberedSlug(`${LONG}yy`, 1, used);

    expect(second).not.toBe(first);
    expect(second.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
  });

  it("never leaves a trailing hyphen for the schema to reject", () => {
    // Trimming can land mid-word and cut just after a hyphen, which is the one
    // shape the slug rule explicitly forbids.
    const base = `${"ab-".repeat(30)}`.slice(0, MAX_SLUG_LENGTH);
    expect(numberedSlug(base, 1, new Set())).not.toMatch(/--/);
    expect(numberedSlug(base, 1, new Set())).toMatch(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
    );
  });
});

describe("uniqueSlugs", () => {
  it("stays inside the cap when it disambiguates a maximum-length name", () => {
    // Same bug, the other slug builder: this reserved room with a hard-coded
    // 60 rather than deriving it from the cap.
    const long = "z".repeat(MAX_SLUG_LENGTH);
    const slugs = uniqueSlugs([long, `${long}!`]);
    for (const slug of slugs.values()) {
      expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    }
    expect(new Set(slugs.values()).size).toBe(2);
  });

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
    marks: "text",
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

/**
 * §24 E8.5's three rules, settled before a draft becomes a pack.
 *
 * The same division as `normaliseWeights` above: the model is asked what it
 * knows — does this work need a photograph, does this criterion judge one — and
 * the answer is then made consistent here, because a model asked what it may
 * judge from will over-claim. Every repair is recorded, because a brief that
 * quietly stopped asking for the photograph its rubric was written around is a
 * change nobody could trace to a pass.
 */
describe("reconcileEvidence", () => {
  const criterion = (
    name: string,
    marks: DraftCriterion["marks"],
    weight = 1,
  ) => ({ name, weight, marks });

  const draft = (
    marks: DraftCriterion["marks"][],
    image: "required" | "optional" | "none",
    images = 1,
  ) => ({
    rubrics: [
      {
        name: "The rubric",
        criteria: marks.map((m, i) => criterion(`c${i}`, m)),
      },
    ],
    projects: [
      { title: "The project", rubric: "The rubric", evidence: { image, images } },
    ],
  });

  it("leaves a consistent draft exactly as it found it", () => {
    const result = reconcileEvidence(
      draft(["text", "both", "image", "text"], "required", 2),
      MAX_PROJECT_IMAGES,
    );

    expect(result.marks[0]).toEqual(["text", "both", "image", "text"]);
    expect(result.evidence[0]).toEqual({ image: "required", images: 2 });
    expect(result.notes).toEqual([]);
  });

  describe("rule 1 — nothing may claim to have looked at what was not asked for", () => {
    it("demotes image criteria on a written-only project", () => {
      const result = reconcileEvidence(
        draft(["image", "both", "text", "text"], "none"),
        MAX_PROJECT_IMAGES,
      );

      expect(result.marks[0]).toEqual(["text", "text", "text", "text"]);
      expect(result.notes).toHaveLength(2);
      expect(result.notes[0]).toContain("does not ask for");
    });

    it("demotes a rubric no project hands work in against", () => {
      // Nothing will ever be submitted against it, so it judges no photograph.
      const result = reconcileEvidence(
        {
          rubrics: [{ name: "Orphan", criteria: [criterion("c0", "image")] }],
          projects: [],
        },
        MAX_PROJECT_IMAGES,
      );

      // Rule 1 demotes it to `text`, and rule 2 then finds it already
      // anchored — the repair rule 2 exists for never fires.
      expect(result.marks[0]).toEqual(["text"]);
    });

    it("takes the strict reading when two projects share a rubric", () => {
      // One of them takes no photographs, so a criterion judging one would be
      // judging something half its submissions cannot contain.
      const result = reconcileEvidence(
        {
          rubrics: [
            { name: "Shared", criteria: [criterion("c0", "image"), criterion("c1", "text")] },
          ],
          projects: [
            { title: "With", rubric: "Shared", evidence: { image: "required", images: 1 } },
            { title: "Without", rubric: "Shared", evidence: { image: "none", images: 1 } },
          ],
        },
        MAX_PROJECT_IMAGES,
      );

      expect(result.marks[0]).toEqual(["text", "text"]);
    });
  });

  describe("rule 2 — every rubric keeps something the verifier can anchor to", () => {
    it("promotes the heaviest criterion when nothing reads the write-up", () => {
      const result = reconcileEvidence(
        {
          rubrics: [
            {
              name: "All pictures",
              criteria: [
                criterion("light", "image", 1),
                criterion("focus", "image", 5),
                criterion("edges", "image", 2),
              ],
            },
          ],
          projects: [
            { title: "P", rubric: "All pictures", evidence: { image: "required", images: 1 } },
          ],
        },
        MAX_PROJECT_IMAGES,
      );

      expect(result.marks[0]).toEqual(["image", "both", "image"]);
      expect(result.notes[0]).toContain("no quote to check");
    });

    it("counts `both` as anchored, because it quotes the write-up too", () => {
      const result = reconcileEvidence(
        draft(["image", "both"], "required"),
        MAX_PROJECT_IMAGES,
      );

      expect(result.marks[0]).toEqual(["image", "both"]);
      expect(result.notes).toEqual([]);
    });

    it("has nothing to repair in an empty rubric", () => {
      const result = reconcileEvidence(
        {
          rubrics: [{ name: "Empty", criteria: [] }],
          projects: [
            { title: "P", rubric: "Empty", evidence: { image: "required", images: 1 } },
          ],
        },
        MAX_PROJECT_IMAGES,
      );

      expect(result.marks[0]).toEqual([]);
    });
  });

  describe("rule 3 — a brief may not demand a photograph that changes no band", () => {
    it("asks for it as optional instead", () => {
      const result = reconcileEvidence(
        draft(["text", "text", "text", "text"], "required", 3),
        MAX_PROJECT_IMAGES,
      );

      expect(result.evidence[0]).toEqual({ image: "optional", images: 3 });
      expect(result.notes[0]).toContain("no criterion");
    });

    it("leaves an optional photograph optional", () => {
      const result = reconcileEvidence(
        draft(["text", "text"], "optional"),
        MAX_PROJECT_IMAGES,
      );

      expect(result.evidence[0]!.image).toBe("optional");
      expect(result.notes).toEqual([]);
    });

    it("says nothing about a project whose rubric was never written", () => {
      const result = reconcileEvidence(
        {
          rubrics: [],
          projects: [
            { title: "P", rubric: "Missing", evidence: { image: "required", images: 1 } },
          ],
        },
        MAX_PROJECT_IMAGES,
      );

      // Demoted, because nothing judges the photograph. Assembly drops the
      // project outright a few lines later; this must not throw before it does.
      expect(result.evidence[0]!.image).toBe("optional");
    });
  });

  it("clamps a count past what the ingest step will take", () => {
    const result = reconcileEvidence(
      draft(["image", "text"], "required", 40),
      MAX_PROJECT_IMAGES,
    );

    expect(result.evidence[0]!.images).toBe(MAX_PROJECT_IMAGES);
    expect(result.notes[0]).toContain("capped at");
  });

  it("settles rubrics and projects by position, not by name", () => {
    // Two rubrics can share a display name in one draft — `uniqueSlugs` exists
    // for exactly that — and a map keyed by name would settle both from
    // whichever came last.
    const result = reconcileEvidence(
      {
        rubrics: [
          { name: "Same", criteria: [criterion("c0", "image")] },
          { name: "Same", criteria: [criterion("c0", "text")] },
        ],
        projects: [
          { title: "P", rubric: "Same", evidence: { image: "required", images: 1 } },
        ],
      },
      MAX_PROJECT_IMAGES,
    );

    expect(result.marks).toHaveLength(2);
    expect(result.marks[1]).toEqual(["text"]);
  });
});
