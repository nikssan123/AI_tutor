import { describe, expect, it } from "vitest";
import { subjectInProse } from "@/lib/subject-name";
import { allPacks } from "@/lib/content";

describe("subjectInProse", () => {
  it("brings an ordinary title down into the sentence", () => {
    expect(subjectInProse("Photography")).toBe("photography");
    expect(subjectInProse("Business Writing & Communication")).toBe(
      "business writing & communication",
    );
  });

  it("leaves an acronym exactly as the pack author wrote it", () => {
    // The bug this exists for: "sql & data analysis", in a search result, in
    // structured data, and in the learner's own goal title.
    expect(subjectInProse("SQL & Data Analysis")).toBe("SQL & data analysis");
    expect(subjectInProse("Intro to HTML and CSS")).toBe("intro to HTML and CSS");
  });

  it("does not treat a single capital letter as an acronym", () => {
    // "A" and "&" carry no signal about deliberate capitalisation.
    expect(subjectInProse("A Guide To Bread")).toBe("a guide to bread");
  });

  it("keeps punctuation attached to an acronym", () => {
    expect(subjectInProse("Using SQL, Properly")).toBe("using SQL, properly");
  });

  it("survives every name the real packs carry", () => {
    for (const pack of allPacks()) {
      const prose = subjectInProse(pack.name);
      // Same words, same order, same length — only case may move.
      expect(prose.toLowerCase()).toBe(pack.name.toLowerCase());
    }
  });
});
