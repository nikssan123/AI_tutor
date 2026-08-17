import type { ProjectEvidence } from "@/lib/packs/types";

/**
 * What a brief asks the learner to hand in, as a sentence.
 *
 * It replaces the free string `evidenceType`, which said "image" or "document"
 * or "query" — one word, chosen by whoever authored the pack, and wrong in the
 * same way on every media brief: it named the photograph and never mentioned
 * the write-up, which is the half that is always required and the half most of
 * the rubric is marked from.
 *
 * In a module of its own, with no imports but a type, for the reason
 * `evaluation/tier.ts` is: the three surfaces that render this are marketing
 * pages and a card component, and anything they reach for drags its own
 * dependencies into a static route. `content/index.ts` reads the filesystem.
 */
export function handInLabel(evidence: ProjectEvidence): string {
  const photographs = photographPhrase(evidence.images);

  switch (evidence.image) {
    case "required":
      return `a write-up and ${photographs}`;
    case "optional":
      return evidence.images === 1
        ? "a write-up, and a photograph if it helps"
        : `a write-up, and ${photographs} if they help`;
    // Every project takes a write-up; this is the one that takes nothing else.
    case "none":
      return "a write-up";
  }
}

/**
 * "a photograph" or "up to 4 photographs".
 *
 * Shared rather than written twice because it appears on a marketing card and
 * in a refusal the learner reads after being turned away — and those two
 * disagreeing about how many a brief takes is the disagreement that matters
 * most, since one of them is why they were refused.
 */
export function photographPhrase(images: number): string {
  return images === 1 ? "a photograph" : `up to ${images} photographs`;
}

/**
 * The frames a verdict cites, named the way the learner chose them.
 *
 * "Photograph 3", "Photographs 1 and 4", "Photographs 1, 2 and 4" — a list
 * rather than a single number because most criteria that read a photograph read
 * a *set*: whether the light is consistent, whether every frame clears a floor.
 *
 * Beside `photographPhrase` for the reason that one is shared: this is the same
 * vocabulary at the other end of the loop, and a brief that asks for "up to 4
 * photographs" and a verdict that calls them "images" or "files" have drifted.
 *
 * Sorted and de-duplicated, because the numbers come from a model and the
 * learner is being asked to go and look: "Photographs 3, 1 and 3" is a sentence
 * that makes them doubt the frames rather than the judgement.
 */
export function framesCited(photographs: number[]): string {
  const frames = [...new Set(photographs)].sort((a, b) => a - b);
  const noun = frames.length === 1 ? "Photograph" : "Photographs";

  if (frames.length <= 2) return `${noun} ${frames.join(" and ")}`;

  return `${noun} ${frames.slice(0, -1).join(", ")} and ${frames.at(-1)}`;
}
