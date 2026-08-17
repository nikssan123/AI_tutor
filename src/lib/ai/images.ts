/**
 * What the model API will take as a photograph, and how big.
 *
 * Facts about Anthropic's request format rather than product policy, which is
 * why they are here rather than beside either of the two things that send an
 * image — the anonymous Skill Check (§7.3's photograph) and a graded submission
 * (§24 E8.5). Two copies of an allowlist drift, and the copy that drifts is the
 * one that starts accepting a format the API refuses, at the moment the learner
 * has already waited for the upload.
 *
 * No imports, deliberately: `check-screens.tsx` is a client component and reads
 * both of these to write the file input's `accept` and its size sentence. It
 * used to reach into `check/photo.ts` for them, which is a module that imports
 * the SDK.
 */

/** What Anthropic accepts, which is also what a phone or a camera produces. */
export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type ImageType = (typeof IMAGE_TYPES)[number];

export function isImageType(value: string): value is ImageType {
  return (IMAGE_TYPES as readonly string[]).includes(value);
}

/**
 * The largest single photograph we will take, in bytes.
 *
 * The API's own ceiling is 5MB per image and it downscales anything over its
 * working resolution, so this is about the request rather than about quality: a
 * 4.5MB JPEG off a phone arrives intact, a 20MB raw export is refused with a
 * sentence that says what to do instead. Nothing is resized on the way —
 * adding an image pipeline to save a fraction of a cent would be the wrong
 * trade in both places this is used.
 */
export const MAX_IMAGE_BYTES = 4_500_000;
