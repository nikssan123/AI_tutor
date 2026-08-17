import { isImageType, MAX_IMAGE_BYTES, type ImageType } from "@/lib/ai/images";
import type { ProjectEvidence } from "@/lib/packs/types";

/**
 * §14.5 step 1, the half `normaliseArtefact` could not do: photographs.
 *
 * Text is capped by one number because there is one way for it to be too much.
 * An image has four, and every one of them has to be refused with a sentence
 * rather than a stack trace: the wrong format, one file too large, too many
 * files, and — the one that only exists because they arrive together — too many
 * bytes in total.
 *
 * Pure and `File`-shaped rather than request-shaped, so the rules are testable
 * without a form POST. The action reads the refusal and picks the copy.
 */

export interface SubmittedImage {
  mediaType: ImageType;
  /** base64, no data-URL prefix — the shape the API and `storageRef` both take. */
  data: string;
  /** Decoded size, for the `artifact` row. */
  bytes: number;
}

/**
 * The most image data one hand-in may carry, across every file in it.
 *
 * **This is a request-body budget before it is a storage one.** Server Actions
 * hold the whole multipart body in memory, and the box this deploys to has
 * 7.6GB shared with another project — six photographs at `MAX_IMAGE_BYTES` each
 * would be a 27MB body for one hand-in. It is set instead at a size a correctly
 * exported set fits inside comfortably: the API downscales anything over about
 * 1568px on the long edge, and a JPEG at that size runs 300–450KB, so six of
 * them is under 3MB. What this refuses is six untouched camera exports, and the
 * only thing lost by exporting them smaller is upload time.
 *
 * `next.config.ts` carries this number plus the multipart wrapper. The two move
 * together or the platform refuses the upload before any of this runs, and the
 * learner gets a framework error instead of a sentence.
 */
export const MAX_SUBMISSION_IMAGE_BYTES = 12_000_000;

export type ImageRefusal =
  | "wrong-type"
  | "too-big"
  | "too-many"
  | "total-too-big"
  | "missing";

export interface ImageIngest {
  images: SubmittedImage[];
  /** Null when everything was taken. Never both. */
  refused: ImageRefusal | null;
}

/** What a `File` has to look like here — the two fields and the bytes. */
export interface UploadedFile {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export async function acceptImages(
  files: UploadedFile[],
  evidence: ProjectEvidence,
): Promise<ImageIngest> {
  /*
   * A brief that takes no photographs and was sent some. Dropped rather than
   * refused: nothing about the hand-in is wrong, the extra files simply have no
   * criterion to inform, and stopping a piece of work over them would cost the
   * learner an evaluation for a mistake with no consequence.
   */
  const offered = evidence.image === "none" ? [] : files;

  if (evidence.image === "required" && offered.length === 0) {
    return { images: [], refused: "missing" };
  }
  if (offered.length > evidence.images) {
    return { images: [], refused: "too-many" };
  }

  let total = 0;
  const images: SubmittedImage[] = [];

  for (const file of offered) {
    if (!isImageType(file.type)) return { images: [], refused: "wrong-type" };
    if (file.size > MAX_IMAGE_BYTES) return { images: [], refused: "too-big" };

    total += file.size;
    if (total > MAX_SUBMISSION_IMAGE_BYTES) {
      return { images: [], refused: "total-too-big" };
    }

    const bytes = await file.arrayBuffer();
    images.push({
      mediaType: file.type,
      data: Buffer.from(bytes).toString("base64"),
      bytes: file.size,
    });
  }

  return { images, refused: null };
}
