import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPack } from "@/lib/packs/loader";
import type { DomainPack } from "@/lib/packs/types";

/**
 * The guide substrate: what a guide file is allowed to say, and what happens to
 * the figures inside it.
 *
 * The pack loader is mocked to the same minimal fixture the marketing tests
 * use, because every own-data reference in a guide resolves against real pack
 * content — which is the point of §12.2 dimension 7 and the reason a guide
 * cannot describe a subject the product does not teach.
 */

const minimal = (): DomainPack =>
  loadPack(join("tests/fixtures/packs", "valid-minimal"));

vi.mock("@/lib/packs/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/packs/loader")>();
  return { ...actual, loadAllPacks: () => [minimal()] };
});

const { resetContentCache } = await import("@/lib/content");
const { GuideParseError, loadAllGuides, loadGuide } = await import(
  "@/lib/guides/loader"
);
const { GuideDataError, dataReferences, resolveData } = await import(
  "@/lib/guides/data"
);
const { GuideSchema, wordCount } = await import("@/lib/guides/types");

const FIXTURES = "tests/fixtures/guides";
const BROKEN = "tests/fixtures/guides-broken";

beforeEach(() => {
  resetContentCache();
});

describe("wordCount", () => {
  it("counts words, and calls an empty string zero", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(wordCount("   ")).toBe(0);
    expect(wordCount("")).toBe(0);
  });
});

describe("the schema", () => {
  const valid = () => loadGuide(join(FIXTURES, "a-full.yaml"));

  it("accepts the control fixture", () => {
    expect(valid().slug).toBe("a-full");
  });

  it("refuses an answer outside the 40–60 word snippet window", () => {
    const guide = valid();
    const short = GuideSchema.safeParse({ ...guide, answer: "far too short" });
    expect(short.success).toBe(false);

    const long = GuideSchema.safeParse({
      ...guide,
      answer: Array.from({ length: 61 }, () => "word").join(" "),
    });
    expect(long.success).toBe(false);
  });

  /**
   * The character budgets in §13.3 are about what a searcher sees, so a field
   * whose length moves when a pack is edited cannot be held to one.
   */
  it("refuses a data reference in the title or the description", () => {
    const guide = valid();
    expect(
      GuideSchema.safeParse({ ...guide, title: "{{catalogue.subjects}} things" })
        .success,
    ).toBe(false);
    expect(
      GuideSchema.safeParse({
        ...guide,
        description: guide.description.replace("A short", "{{x.y}} short"),
      }).success,
    ).toBe(false);
  });

  it("refuses an unknown key rather than dropping it silently", () => {
    expect(
      GuideSchema.safeParse({ ...valid(), tone: "chatty" }).success,
    ).toBe(false);
  });

  it("defaults the review block to nobody", () => {
    const guide = loadGuide(join(FIXTURES, "b-thin.yaml"));
    expect(guide.review).toEqual({
      reviewedBy: null,
      reviewKind: null,
      reviewedAt: null,
    });
  });
});

describe("the loader", () => {
  it("reads every guide in a directory, in slug order, ignoring anything else", () => {
    // A README sits beside them precisely so this filter is exercised by a
    // real file rather than by a mocked readdir.
    expect(loadAllGuides(FIXTURES).map((g) => g.slug)).toEqual([
      "a-full",
      "b-thin",
    ]);
  });

  it("returns nothing for a directory that is not there", () => {
    expect(loadAllGuides("tests/fixtures/no-such-place")).toEqual([]);
  });

  it("names the file when it cannot be read", () => {
    expect(() => loadGuide(join(FIXTURES, "absent.yaml"))).toThrow(
      GuideParseError,
    );
    expect(() => loadGuide(join(FIXTURES, "absent.yaml"))).toThrow(
      /file not found/,
    );
  });

  it("names the file when the YAML itself is malformed", () => {
    expect(() => loadGuide(join(BROKEN, "not-yaml.yaml"))).toThrow(
      GuideParseError,
    );
  });

  /** A file with nothing to name a field on still has to say something. */
  it("says (root) when the document is not a guide-shaped thing at all", () => {
    expect(() => loadGuide(join(BROKEN, "not-an-object.yaml"))).toThrow(
      /\(root\): /,
    );
  });

  it("lists every field that failed, not just the first", () => {
    expect(() => loadGuide(join(BROKEN, "short-answer.yaml"))).toThrow(
      /answer.*description|description.*answer/s,
    );
  });

  /** The filename is the URL; a guide you cannot find from its address is the
   *  thing that makes a content directory unmaintainable at fifty pages. */
  it("refuses a slug that disagrees with the filename", () => {
    expect(() => loadGuide(join(BROKEN, "mismatched.yaml"))).toThrow(
      /requires the filename correct-slug\.yaml/,
    );
  });
});

describe("own-data references", () => {
  it("finds every reference in a piece of prose", () => {
    expect(
      dataReferences("a {{catalogue.subjects}} b {{topic:x.hours}} c"),
    ).toEqual(["{{catalogue.subjects}}", "{{topic:x.hours}}"]);
    expect(dataReferences("nothing here")).toEqual([]);
  });

  it("resolves every subject field from the pack itself", () => {
    expect(resolveData("{{topic:valid-minimal.name}}")).toBe("Valid Minimal");
    expect(resolveData("{{topic:valid-minimal.skills}}")).toBe("2");
    expect(resolveData("{{topic:valid-minimal.hours}}")).toBe("3");
    expect(resolveData("{{topic:valid-minimal.projects}}")).toBe("1");
    expect(resolveData("{{topic:valid-minimal.areas}}")).toBe("2");
  });

  it("resolves every project field from the brief itself", () => {
    expect(resolveData("{{project:minimal-project.title}}")).toBe(
      "A minimal project",
    );
    expect(resolveData("{{project:minimal-project.minutes}}")).toBe("30");
    expect(resolveData("{{project:minimal-project.criteria}}")).toBe("4");
    expect(resolveData("{{project:minimal-project.skills}}")).toBe("2");
  });

  it("resolves the catalogue-wide figures", () => {
    expect(resolveData("{{catalogue.subjects}}")).toBe("1");
    expect(resolveData("{{catalogue.skills}}")).toBe("2");
    expect(resolveData("{{catalogue.hours}}")).toBe("3");
    expect(resolveData("{{catalogue.projects}}")).toBe("1");
  });

  it("leaves prose with no references exactly as written", () => {
    expect(resolveData("plain sentence")).toBe("plain sentence");
  });

  /**
   * Every one of these fails the build rather than rendering braces to a
   * reader. A guide quoting a subject we removed should stop a deploy.
   */
  it.each([
    ["{{topic:nope.skills}}", /no subject "nope"/],
    ["{{topic:valid-minimal.colour}}", /no subject field "colour"/],
    ["{{project:nope.minutes}}", /no project "nope"/],
    ["{{project:minimal-project.colour}}", /no project field "colour"/],
    ["{{catalogue.colour}}", /no catalogue field "colour"/],
    ["{{catalogue:x.subjects}}", /catalogue takes no slug/],
    ["{{topic.skills}}", /topic needs a slug/],
    ["{{project.minutes}}", /project needs a slug/],
    ["{{pack.skills}}", /unknown source "pack"/],
  ])("refuses %s", (reference, message) => {
    expect(() => resolveData(reference)).toThrow(GuideDataError);
    expect(() => resolveData(reference)).toThrow(message);
  });
});
