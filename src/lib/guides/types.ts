import { z } from "zod";

/**
 * §10 D — the `/guides/{question}` schema.
 *
 * A guide is the one page type on this site that is mostly *prose*, which makes
 * it the one page type §12 is actually written about. Everything else we
 * publish is a tool or a rubric and is scaled-content-proof by construction; a
 * guide is not, so the shape below carries the defences rather than leaving
 * them to a review that may not happen:
 *
 *   - **The prose is hand-written, always** (§12.1 rule 3). Nothing in this
 *     module generates a sentence. A template renders *structure* around
 *     paragraphs a person typed.
 *   - **Every number is a reference, never a literal** (`data.ts`). A guide that
 *     says "26 skills" says `{{topic:sql-data-analysis.skills}}` and the build
 *     resolves it, so a page cannot quietly go stale against the pack it
 *     describes — and dimension 7 of §12.2, "a data point only you have",
 *     becomes mechanical rather than aspirational.
 *   - **Every claim that is not ours carries a citation** that resolves to a
 *     declared source with a URL (§12.2 dimension 1).
 *
 * The file lives on disk, in git, and is reviewed in a diff — the same choice
 * `packs/` made and for the same reason: a human has to read this before it
 * ships, and a database row is not a thing you can read in a pull request.
 */

const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "must be lowercase, hyphen-separated, no leading or trailing hyphen",
  );

/** §13.3's typed internal edges. The renderer places each one by its type. */
export const LinkType = z.enum([
  "prerequisite",
  "next_step",
  "related",
  "project_for",
  "check_for",
]);
export type LinkType = z.infer<typeof LinkType>;

const LITERAL_ONLY = {
  message: "must be written out; a {{…}} reference has no fixed length",
};

function noReferences(text: string): boolean {
  return !text.includes("{{");
}

export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/);
  return words[0] === "" ? 0 : words.length;
}

/**
 * §11 item 1 — "H1 + a 40–60 word direct answer".
 *
 * The range is the whole point of the field: a featured snippet is truncated
 * near 60 words and an answer under 40 has not actually answered anything. It
 * is enforced here rather than scored later because a guide that fails it is
 * not a guide that needs improving, it is one that has not been written yet.
 */
const directAnswer = z
  .string()
  .refine((t) => wordCount(t) >= 40 && wordCount(t) <= 60, {
    message: "the direct answer must be 40–60 words (§11 item 1)",
  });

export const GuideSource = z.object({
  /** Cited from prose as `[^id]`. */
  id: slug,
  url: z.string().url(),
  title: z.string().min(1),
  /**
   * §11 item 10 — "genuinely curated, external, with honest one-line
   * assessments". A bare link list is a citation; a link with an assessment of
   * it is the thing worth reading.
   */
  note: z.string().min(10),
});
export type GuideSource = z.infer<typeof GuideSource>;

export const GuideLink = z.object({
  /** An internal path. Resolved against the real page set at validation. */
  to: z.string().startsWith("/"),
  type: LinkType,
  anchor: z.string().min(3),
});
export type GuideLink = z.infer<typeof GuideLink>;

export const GuideSection = z.object({
  heading: z.string().min(3),
  /** Paragraphs, separated by a blank line. Citations and data refs allowed. */
  body: z.string().min(1),
  /** An optional bullet list under the paragraphs. */
  list: z.array(z.string().min(1)).default([]),
  /**
   * Links rendered *inside* this section, which is what §13.3 means by
   * "contextually, not as a footer link dump". A link in the section that
   * earns it is a link a reader follows; the same link in a strip at the
   * bottom is furniture.
   */
  links: z.array(GuideLink).default([]),
});
export type GuideSection = z.infer<typeof GuideSection>;

export const GuideFaq = z.object({
  question: z.string().min(8),
  answer: z.string().min(20),
});
export type GuideFaq = z.infer<typeof GuideFaq>;

/**
 * Who read it. Identical in shape and in spirit to a pack's `quality` block:
 * `reviewKind` is an enum rather than a free string because pass 28 found the
 * free string version failing open, and a guide is the page type where that
 * failure would be most expensive.
 */
export const GuideReview = z.object({
  reviewedBy: z.string().min(2).nullable().default(null),
  reviewKind: z.enum(["human", "model"]).nullable().default(null),
  reviewedAt: z.string().nullable().default(null),
});
export type GuideReview = z.infer<typeof GuideReview>;

export const GuideSchema = z
  .object({
    slug,
    /**
     * §13.3 — title ≤60 characters, description 140–160.
     *
     * Both are checked as written, which is why neither may contain a
     * `{{…}}` reference: the limits are about what a searcher sees in a result,
     * and a string whose length changes when a pack is edited cannot be held to
     * a character budget. A churning snippet is bad for the listing anyway —
     * the figures belong in the body, where a reader wants them current.
     */
    title: z.string().min(1).max(60).refine(noReferences, LITERAL_ONLY),
    description: z
      .string()
      .min(140)
      .max(160)
      .refine(noReferences, LITERAL_ONLY),
    h1: z.string().min(1),
    answer: directAnswer,
    /**
     * §12.1 rule 2 — "every indexable page contains a working tool or unique
     * data". For a guide the tool is a real one elsewhere on the site, named
     * here and rendered above the fold, and the *reason* this page is allowed
     * to be prose at all. There is no guide without one.
     */
    tool: z.object({
      path: z.string().startsWith("/"),
      label: z.string().min(3),
      /** Why this tool answers this question, in the reader's terms. */
      pitch: z.string().min(20),
    }),
    sections: z.array(GuideSection).min(3),
    sources: z.array(GuideSource).default([]),
    faqs: z.array(GuideFaq).default([]),
    review: GuideReview.default({
      reviewedBy: null,
      reviewKind: null,
      reviewedAt: null,
    }),
  })
  .strict();
export type Guide = z.infer<typeof GuideSchema>;
