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
  const photographs =
    evidence.images === 1 ? "a photograph" : `up to ${evidence.images} photographs`;

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
