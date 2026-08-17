import { describe, expect, it } from "vitest";
import { handInLabel } from "@/lib/content/evidence";
import { allPacks } from "@/lib/content";

/**
 * "Hand in: …", on the landing page, the brief page and every brief card.
 *
 * What this replaced was `evidenceType`, a single word chosen by whoever wrote
 * the pack — and on every media brief it named the photograph and never
 * mentioned the write-up, which is the half that is always required and the
 * half most of the rubric is marked from. So the property worth asserting is
 * not the wording: it is that the written half is in every sentence.
 */
describe("handInLabel", () => {
  it("names the write-up alone when the brief takes nothing else", () => {
    expect(handInLabel({ image: "none", images: 1 })).toBe("a write-up");
  });

  it("names both when a photograph is required", () => {
    expect(handInLabel({ image: "required", images: 1 })).toBe(
      "a write-up and a photograph",
    );
  });

  it("counts the frames when a brief wants a set", () => {
    expect(handInLabel({ image: "required", images: 6 })).toBe(
      "a write-up and up to 6 photographs",
    );
  });

  it("says a photograph is welcome rather than expected when it is optional", () => {
    expect(handInLabel({ image: "optional", images: 1 })).toBe(
      "a write-up, and a photograph if it helps",
    );
    expect(handInLabel({ image: "optional", images: 3 })).toBe(
      "a write-up, and up to 3 photographs if they help",
    );
  });

  it("never describes a hand-in that is not written", () => {
    for (const pack of allPacks()) {
      for (const project of pack.projects) {
        expect(handInLabel(project.evidence), `${pack.slug}/${project.slug}`).toContain(
          "write-up",
        );
      }
    }
  });
});
