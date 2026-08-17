import { describe, expect, it } from "vitest";
import { framesCited, handInLabel } from "@/lib/content/evidence";
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

/**
 * The other end of the same loop: the frames a verdict says it read.
 *
 * A list rather than one number because most criteria that read a photograph
 * read a *set* — and because the first real run of §24 E8.5 phase 2 showed the
 * grader writing the extra frame numbers into unchecked prose when the field
 * could only hold one.
 */
describe("framesCited", () => {
  it("names one frame in the singular", () => {
    expect(framesCited([3])).toBe("Photograph 3");
  });

  it("joins two with an and", () => {
    expect(framesCited([1, 4])).toBe("Photographs 1 and 4");
  });

  it("puts the and before the last of several", () => {
    expect(framesCited([1, 2, 4])).toBe("Photographs 1, 2 and 4");
  });

  it("sorts them, because the learner is being asked to go and look", () => {
    // The numbers come from a model and arrive in whatever order it compared
    // them in. "Photographs 3, 1 and 4" makes a reader doubt the frames rather
    // than the judgement.
    expect(framesCited([3, 1, 4])).toBe("Photographs 1, 3 and 4");
  });

  it("says a frame once however often it was cited", () => {
    expect(framesCited([2, 2])).toBe("Photograph 2");
    expect(framesCited([4, 1, 4])).toBe("Photographs 1 and 4");
  });
});
