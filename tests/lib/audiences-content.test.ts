import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPack } from "@/lib/packs/loader";
import type { DomainPack } from "@/lib/packs/types";

/**
 * The §10 C substrate: what an audience page is allowed to say, what the skill
 * graph makes of it, and which of the two layers catches which mistake.
 *
 * The pack loader is mocked to the same minimal fixture the guide tests use.
 * That matters more here than there: an audience page is *entirely* arithmetic
 * over a pack, so a test written against the real SQL pack would be asserting
 * on twenty-six skills somebody may reasonably edit. Two skills and one hard
 * edge are enough to exercise every rule, and they cannot drift.
 */

const minimal = (): DomainPack =>
  loadPack(join("tests/fixtures/packs", "valid-minimal"));

vi.mock("@/lib/packs/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/packs/loader")>();
  return { ...actual, loadAllPacks: () => [minimal()] };
});

const { resetContentCache } = await import("@/lib/content");
const { AudienceParseError, loadAllAudiences, loadAudience } = await import(
  "@/lib/audiences/loader"
);
const { AudienceContentError, audiencePath, claimGroups } = await import(
  "@/lib/audiences/path"
);
const { pathReferences, resolveAudience, resolveReferences } = await import(
  "@/lib/audiences/references"
);
const { AudienceSchema, audienceProse, wordCount } = await import(
  "@/lib/audiences/types"
);

type Audience = import("@/lib/audiences/types").Audience;

const FIXTURES = "tests/fixtures/audiences";
const BROKEN = "tests/fixtures/audiences-broken";

const control = (): Audience => loadAudience(join(FIXTURES, "minimal-for-testers.yaml"));

/** The control fixture, cut down to claims the minimal pack can actually resolve. */
const page = (overrides: Partial<Audience> = {}): Audience => ({
  ...control(),
  claims: [
    { claim: "You already know the alpha thing.", verdict: "known", covers: ["alpha"] },
  ],
  ...overrides,
});

beforeEach(() => {
  resetContentCache();
});

describe("wordCount", () => {
  it("counts words, and calls an empty string zero", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(wordCount("   ")).toBe(0);
  });
});

describe("the schema", () => {
  it("accepts the control fixture", () => {
    expect(control().slug).toBe("minimal-for-testers");
  });

  it("refuses a slug that does not read {subject}-for-{audience}", () => {
    const result = AudienceSchema.safeParse({ ...control(), slug: "just-a-page" });
    expect(result.success).toBe(false);
  });

  it("refuses an answer outside the 40–60 word snippet window", () => {
    expect(
      AudienceSchema.safeParse({ ...control(), answer: "far too short" }).success,
    ).toBe(false);
    expect(
      AudienceSchema.safeParse({
        ...control(),
        answer: Array.from({ length: 61 }, () => "word").join(" "),
      }).success,
    ).toBe(false);
  });

  /**
   * The rule the page type turns on: every figure is arithmetic over the claims
   * in the same file, so one typed by hand is wrong as soon as a claim moves.
   */
  it("refuses a digit in any authored string", () => {
    const fixture = control();
    const cases: Array<Partial<Audience>> = [
      { title: "Minimal for 2 testers" },
      { description: `${fixture.description.slice(0, -1)}1` },
      { h1: "Minimal for 2 testers" },
      { answer: `${fixture.answer} It covers 3 skills.` },
      { ifYou: ["You are 1 test, and you would like to be parsed."] },
      {
        claims: [
          { claim: "You already know 2 of the things.", verdict: "known", covers: ["alpha"] },
        ],
      },
      {
        claims: [
          {
            claim: "You already know the alpha thing.",
            verdict: "transfers",
            note: "It stops resembling it after about 2 steps of the process.",
            covers: ["alpha"],
          },
        ],
      },
      { faqs: [{ question: "How many are there?", answer: "There are 3 of them, at least." }] },
    ];

    for (const patch of cases) {
      expect(AudienceSchema.safeParse({ ...fixture, ...patch }).success).toBe(false);
    }
  });

  it("requires a transfers claim to say where the resemblance stops", () => {
    const result = AudienceSchema.safeParse({
      ...control(),
      claims: [
        { claim: "You have done something like the beta thing.", verdict: "transfers", covers: ["beta"] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("refuses a caveat on something it is skipping outright", () => {
    const result = AudienceSchema.safeParse({
      ...control(),
      claims: [
        {
          claim: "You already know the alpha thing.",
          verdict: "known",
          note: "Except for the parts of it that are hard.",
          covers: ["alpha"],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("requires at least two admission conditions and three claims", () => {
    expect(AudienceSchema.safeParse({ ...control(), ifYou: ["Only one."] }).success).toBe(
      false,
    );
    expect(
      AudienceSchema.safeParse({ ...control(), claims: control().claims.slice(0, 2) })
        .success,
    ).toBe(false);
  });

  it("defaults the review block to nobody having read it", () => {
    const parsed = AudienceSchema.parse({
      ...control(),
      review: undefined,
      sources: undefined,
      faqs: undefined,
    });
    expect(parsed.review.reviewKind).toBeNull();
    expect(parsed.sources).toEqual([]);
    expect(parsed.faqs).toEqual([]);
  });
});

describe("audienceProse", () => {
  it("is every authored sentence and nothing derived", () => {
    const text = audienceProse(control());
    expect(text).toContain("control fixture for the audience page schema");
    expect(text).toContain("You are a test");
    expect(text).toContain("The resemblance stops");
    expect(text).toContain("Is this a real page?");
    // The title and description are held to a character budget rather than a
    // word count, and neither is on the page.
    expect(text).not.toContain("Minimal for testers");
  });
});

describe("the loader", () => {
  it("skips anything that is not a yaml file", () => {
    expect(loadAllAudiences(FIXTURES).map((a) => a.slug)).toEqual([
      "minimal-for-testers",
    ]);
  });

  it("returns nothing when the directory does not exist", () => {
    expect(loadAllAudiences("tests/fixtures/no-such-directory")).toEqual([]);
  });

  it("names the file it could not read", () => {
    expect(() => loadAudience(join(FIXTURES, "absent.yaml"))).toThrow(
      AudienceParseError,
    );
  });

  it("rejects a file that is not yaml, and one that is not an object", () => {
    expect(() => loadAudience(join(BROKEN, "not-yaml.yaml"))).toThrow(
      AudienceParseError,
    );
    expect(() => loadAudience(join(BROKEN, "not-an-object.yaml"))).toThrow(
      AudienceParseError,
    );
  });

  it("insists the filename is the URL", () => {
    expect(() => loadAudience(join(BROKEN, "mismatched.yaml"))).toThrow(
      /slug requires the filename renamed-for-nobody\.yaml/,
    );
  });
});

describe("audiencePath", () => {
  it("classifies every skill in the pack, claimed or not", () => {
    const path = audiencePath(page());
    expect(path.skills.map((s) => [s.slug, s.verdict])).toEqual([
      ["alpha", "known"],
      ["beta", "new"],
    ]);
    expect(path.known.map((s) => s.slug)).toEqual(["alpha"]);
    expect(path.fresh.map((s) => s.slug)).toEqual(["beta"]);
  });

  /**
   * The hours are the page's headline and the reason none of them can be typed
   * by hand: `known` comes off, `transfers` stays on, and the range brackets
   * the one assumption the page is making about a reader it has never met.
   */
  it("takes the known hours off and brackets the transferring ones", () => {
    const path = audiencePath(
      page({
        claims: [
          { claim: "You already know the alpha thing.", verdict: "known", covers: ["alpha"] },
          {
            claim: "The beta thing is familiar from elsewhere.",
            verdict: "transfers",
            note: "The resemblance stops where it has to be correct.",
            covers: ["beta"],
          },
        ],
      }),
    );

    expect(path.hours).toEqual({
      total: 3,
      known: 1,
      transfers: 2,
      fresh: 0,
      low: 0,
      high: 2,
    });
  });

  it("opens the frontier to whatever the known set unlocks", () => {
    // `beta` needs `alpha`, so crediting alpha is what makes beta startable.
    expect(audiencePath(page()).frontier.map((s) => s.slug)).toEqual(["beta"]);

    // Crediting nothing leaves the graph's roots, which is the right answer for
    // somebody arriving with nothing.
    const cold = audiencePath(
      page({
        claims: [
          {
            claim: "The alpha thing is familiar from elsewhere.",
            verdict: "transfers",
            note: "The resemblance stops where it has to be correct.",
            covers: ["alpha"],
          },
        ],
      }),
    );
    expect(cold.frontier.map((s) => s.slug)).toEqual(["alpha"]);
  });

  /**
   * The check no proof-reader can perform, because it needs the transitive
   * shape of the graph rather than an opinion about the prose.
   */
  it("names the prerequisites a known claim assumes but does not cover", () => {
    const path = audiencePath(
      page({
        claims: [
          { claim: "You already know the beta thing.", verdict: "known", covers: ["beta"] },
        ],
      }),
    );
    expect(path.assumed.map((s) => s.slug)).toEqual(["alpha"]);
    expect(audiencePath(page()).assumed).toEqual([]);
  });

  it("keeps only the briefs this reader could not already hand in", () => {
    const all = audiencePath(page()).projects.length;
    const everything = audiencePath(
      page({
        claims: [
          {
            claim: "You already know both of the things.",
            verdict: "known",
            covers: ["alpha", "beta"],
          },
        ],
      }),
    );
    expect(all).toBeGreaterThan(0);
    expect(everything.projects).toEqual([]);
  });

  it("groups the claims of one verdict with the skills they cover", () => {
    const path = audiencePath(
      page({
        claims: [
          { claim: "You already know the alpha thing.", verdict: "known", covers: ["alpha"] },
          {
            claim: "The beta thing is familiar from elsewhere.",
            verdict: "transfers",
            note: "The resemblance stops where it has to be correct.",
            covers: ["beta"],
          },
        ],
      }),
    );

    expect(claimGroups(path, "known").map((g) => g.skills.map((s) => s.slug))).toEqual([
      ["alpha"],
    ]);
    expect(claimGroups(path, "transfers").map((g) => g.skills.map((s) => s.slug))).toEqual(
      [["beta"]],
    );
  });

  it("refuses a page about a subject that does not exist", () => {
    expect(() => audiencePath(page({ topic: "nothing-here" }))).toThrow(
      AudienceContentError,
    );
  });

  it("refuses a claim about a skill the pack does not teach", () => {
    // The control fixture's third claim covers `gamma`, which the schema was
    // never in a position to check.
    expect(() => audiencePath(control())).toThrow(/no skill "gamma"/);
  });

  it("refuses two claims over one skill", () => {
    expect(() =>
      audiencePath(
        page({
          claims: [
            { claim: "You already know the alpha thing.", verdict: "known", covers: ["alpha"] },
            {
              claim: "You have also met the alpha thing elsewhere.",
              verdict: "transfers",
              note: "Which is a second opinion about the same skill.",
              covers: ["alpha"],
            },
          ],
        }),
      ),
    ).toThrow(/two claims both cover "alpha"/);
  });

  it("refuses a slug a subject already serves", () => {
    // Unreachable through the schema, which requires `-for-`; checked because
    // the route resolves an audience first, so the subject page would vanish.
    expect(() => audiencePath(page({ slug: "valid-minimal" }))).toThrow(
      /a subject already serves that URL/,
    );
  });
});

describe("the reference vocabulary", () => {
  const path = () =>
    audiencePath(
      page({
        claims: [
          { claim: "You already know the alpha thing.", verdict: "known", covers: ["alpha"] },
        ],
      }),
    );

  it("finds every reference, duplicates included", () => {
    expect(pathReferences("{{known}} of {{skills}}, and {{known}} again")).toEqual([
      "{{known}}",
      "{{skills}}",
      "{{known}}",
    ]);
    expect(pathReferences("nothing here")).toEqual([]);
  });

  it("resolves the whole vocabulary from the page's own arithmetic", () => {
    expect(
      resolveReferences(
        path(),
        "{{subject}}/{{audience}}/{{skills}}/{{known}}/{{transfers}}/{{new}}/{{frontier}}/{{projects}}",
      ),
    ).toBe("Valid Minimal/testers/2/1/0/1/1/1");

    expect(
      resolveReferences(path(), "{{hours.total}}/{{hours.known}}/{{hours.low}}/{{hours.high}}"),
    ).toBe("3/1/2/2");
  });

  it("throws rather than printing braces to a reader", () => {
    expect(() => resolveReferences(path(), "{{unknown}}")).toThrow(
      /unknown reference/,
    );
    expect(() => resolveReferences(path(), "{{known.count}}")).toThrow(
      /takes no field/,
    );
    expect(() => resolveReferences(path(), "{{hours.median}}")).toThrow(
      /no hours field "median"/,
    );
    expect(() => resolveReferences(path(), "{{hours}}")).toThrow(
      /no hours field "\(none\)"/,
    );
  });

  it("resolves every authored string on the page and leaves the rest alone", () => {
    const resolved = resolveAudience(
      audiencePath(
        page({
          h1: "Minimal for {{audience}}",
          answer: control().answer.replace("This is", "This {{skills}} is"),
          ifYou: ["You have {{known}} of them already.", "You would like to be parsed."],
          claims: [
            {
              claim: "You already know {{known}} of the things.",
              verdict: "transfers",
              note: "Which leaves {{new}} that you do not, and that is the page.",
              covers: ["alpha"],
            },
          ],
          faqs: [{ question: "How many?", answer: "About {{hours.total}} hours of it." }],
        }),
      ),
    );

    const { audience } = resolved;
    expect(audience.h1).toBe("Minimal for testers");
    expect(audience.answer).toContain("This 2 is");
    expect(audience.ifYou[0]).toBe("You have 0 of them already.");
    expect(audience.faqs[0]!.answer).toBe("About 3 hours of it.");

    const transferred = claimGroups(resolved, "transfers")[0]!.claim;
    expect(transferred.claim).toBe("You already know 0 of the things.");
    expect(transferred.note).toContain("leaves 1 that you do not");

    // A claim we are skipping outright has nowhere to put a caveat at all.
    const skipped = claimGroups(resolveAudience(audiencePath(page())), "known");
    expect(skipped[0]!.claim).not.toHaveProperty("note");
  });
});
