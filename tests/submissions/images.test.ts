import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, MAX_IMAGE_MB } from "@/lib/ai/images";
import {
  acceptImages,
  isRefusal,
  MAX_SUBMISSION_IMAGE_BYTES,
  refusalCopy,
  type ImageRefusal,
  type UploadedFile,
} from "@/lib/submissions/images";
import type { ProjectEvidence } from "@/lib/packs/types";

/**
 * §24 E8.5's ingest step — the four ways a photograph can be too much.
 *
 * Every case here ends in a refusal the learner is shown a sentence for, and
 * the shape of the answer matters as much as the answer: a refusal returns *no*
 * images, so there is never a half-accepted hand-in that gets marked on the two
 * frames that fitted.
 */

const evidence = (over: Partial<ProjectEvidence> = {}): ProjectEvidence => ({
  image: "none",
  images: 1,
  ...over,
});

const file = (over: Partial<UploadedFile> = {}): UploadedFile => ({
  type: "image/jpeg",
  size: 1_000,
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  ...over,
});

describe("acceptImages", () => {
  it("takes what the brief asked for, base64 with its type", async () => {
    const { images, refused } = await acceptImages(
      [file()],
      evidence({ image: "required" }),
    );

    expect(refused).toBeNull();
    expect(images).toHaveLength(1);
    expect(images[0]!.mediaType).toBe("image/jpeg");
    expect(images[0]!.bytes).toBe(1_000);
    // No data-URL prefix: it is what both the API and `storageRef` take.
    expect(images[0]!.data).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });

  it("takes none when none were sent and none were required", async () => {
    const { images, refused } = await acceptImages([], evidence({ image: "optional" }));
    expect(refused).toBeNull();
    expect(images).toEqual([]);
  });

  it("refuses a required photograph that did not arrive", async () => {
    const { images, refused } = await acceptImages([], evidence({ image: "required" }));
    expect(refused).toBe("missing");
    expect(images).toEqual([]);
  });

  /*
   * The case the peer review flagged, and the one worth a test of its own: a
   * brief that never asked for a photograph must not become unsubmittable
   * because none arrived. The refusal reads off the *declaration*, never off
   * the count.
   */
  it("does not refuse a written-only brief for having no photograph", async () => {
    const { refused } = await acceptImages([], evidence({ image: "none" }));
    expect(refused).toBeNull();
  });

  it("drops files a written-only brief has no criterion for", async () => {
    // Dropped rather than refused: nothing about the work is wrong, and losing
    // an evaluation over a file with nothing to inform would be a punishment
    // for a mistake with no consequence.
    const { images, refused } = await acceptImages([file()], evidence({ image: "none" }));
    expect(refused).toBeNull();
    expect(images).toEqual([]);
  });

  it("refuses a format the model API will not take", async () => {
    const { refused } = await acceptImages(
      [file({ type: "image/heic" })],
      evidence({ image: "required" }),
    );
    expect(refused).toBe("wrong-type");
  });

  it("refuses one file over the per-image ceiling", async () => {
    const { refused } = await acceptImages(
      [file({ size: MAX_IMAGE_BYTES + 1 })],
      evidence({ image: "required" }),
    );
    expect(refused).toBe("too-big");
  });

  it("takes a file exactly at the ceiling", async () => {
    const { refused } = await acceptImages(
      [file({ size: MAX_IMAGE_BYTES })],
      evidence({ image: "required" }),
    );
    expect(refused).toBeNull();
  });

  it("refuses more frames than the brief asks for", async () => {
    const { refused } = await acceptImages(
      [file(), file(), file()],
      evidence({ image: "required", images: 2 }),
    );
    expect(refused).toBe("too-many");
  });

  /*
   * The refusal that only exists because they arrive together: six frames can
   * each clear the per-file ceiling and still be a 27MB request body, which the
   * platform holds in memory before any of this runs.
   */
  it("refuses a set that is under the per-file cap and over the whole one", async () => {
    const each = Math.ceil(MAX_SUBMISSION_IMAGE_BYTES / 3);
    expect(each).toBeLessThan(MAX_IMAGE_BYTES);

    const { refused } = await acceptImages(
      [file({ size: each }), file({ size: each }), file({ size: each }), file({ size: each })],
      evidence({ image: "required", images: 6 }),
    );
    expect(refused).toBe("total-too-big");
  });

  it("keeps nothing when it refuses part-way through a set", async () => {
    const { images } = await acceptImages(
      [file(), file({ type: "application/pdf" })],
      evidence({ image: "required", images: 4 }),
    );
    expect(images).toEqual([]);
  });

  it("keeps the order the learner chose", async () => {
    const bytes = (n: number): UploadedFile =>
      file({ arrayBuffer: async () => new Uint8Array([n]).buffer });

    const { images } = await acceptImages(
      [bytes(1), bytes(2), bytes(3)],
      evidence({ image: "required", images: 3 }),
    );

    expect(images.map((i) => i.data)).toEqual([
      Buffer.from([1]).toString("base64"),
      Buffer.from([2]).toString("base64"),
      Buffer.from([3]).toString("base64"),
    ]);
  });
});

describe("the budget", () => {
  it("is under what next.config.ts allows through the body", () => {
    // The two move together. If the body limit is the smaller of the pair, the
    // platform refuses the upload before `acceptImages` can say anything about
    // it, and the learner gets a framework error instead of a sentence.
    expect(MAX_SUBMISSION_IMAGE_BYTES).toBeLessThan(13_000_000);
  });

  it("holds more than one full-size photograph and fewer than six", () => {
    expect(MAX_SUBMISSION_IMAGE_BYTES).toBeGreaterThan(MAX_IMAGE_BYTES * 2);
    expect(MAX_SUBMISSION_IMAGE_BYTES).toBeLessThan(MAX_IMAGE_BYTES * 6);
  });
});

/**
 * The copy lives beside the codes, for the reason `failure.ts` gives about its
 * own table: nothing reaches a learner that is not written there. What these
 * assert is the property, not the wording — every refusal has to say what to do
 * next, because four of the five are one export away from being fixed and the
 * fifth is one photograph away.
 */
describe("refusalCopy", () => {
  const ALL: ImageRefusal[] = [
    "missing",
    "too-many",
    "too-big",
    "total-too-big",
    "wrong-type",
  ];

  it("has a sentence for every refusal `acceptImages` can return", () => {
    for (const refused of ALL) {
      const copy = refusalCopy(refused, { image: "required", images: 4 });
      expect(copy.length, refused).toBeGreaterThan(20);
      expect(copy.endsWith("."), refused).toBe(true);
    }
  });

  it("tells the learner how many the brief actually asks for", () => {
    expect(refusalCopy("too-many", { image: "required", images: 4 })).toContain(
      "up to 4 photographs",
    );
    expect(refusalCopy("too-many", { image: "required", images: 1 })).toContain(
      "a photograph",
    );
  });

  it("names the size honestly, rather than rounding it up", () => {
    /*
     * The cap is 4.5MB and both places that quote it used to write
     * `Math.round(bytes / 1_000_000)`, which rounds *up* — so somebody whose
     * 4.7MB export had just been refused was told the limit was 5MB. The one
     * job of a number in a refusal is to say how much smaller, and that one
     * said the file they were holding was fine.
     */
    const copy = refusalCopy("too-big", { image: "required", images: 1 });
    expect(copy).toContain(`${MAX_IMAGE_MB}MB`);
    expect(Number(MAX_IMAGE_MB) * 1_000_000).toBe(MAX_IMAGE_BYTES);
  });

  it("says which formats it can read rather than which it cannot", () => {
    const copy = refusalCopy("wrong-type", { image: "required", images: 1 });
    for (const format of ["JPEG", "PNG", "WebP", "GIF"]) {
      expect(copy).toContain(format);
    }
  });
});

describe("isRefusal", () => {
  /*
   * The action puts the code in a query string and the session page reads it
   * back. Anything can be typed into a URL, so the page needs to know whether
   * what it found is one of ours before it looks up copy for it.
   */
  it("recognises every code the ingest step produces", () => {
    for (const refused of ["missing", "too-many", "too-big", "total-too-big", "wrong-type"]) {
      expect(isRefusal(refused), refused).toBe(true);
    }
  });

  it("refuses anything else, including the other error codes on that page", () => {
    for (const other of ["empty", "quota", "", "missing "]) {
      expect(isRefusal(other), other).toBe(false);
    }
  });
});
