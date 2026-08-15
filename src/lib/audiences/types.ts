import { z } from "zod";
import { GuideFaq, GuideSource } from "@/lib/guides/types";

/**
 * §10 C — the `/learn/{topic}-for-{audience}` schema.
 *
 * This page type answers "what do I skip, what transfers, and what is actually
 * new" for somebody who arrives already knowing something. §9.1 ranks it third
 * and pass 30 called it the higher-value of E12's two remaining routes for a
 * reason worth repeating here: it is the only marketing page that *demonstrates*
 * the product thesis rather than describing it. Personalising a curriculum to
 * what a learner already has is the thing the product does; this page does it in
 * public, for a whole audience at once, with no signup.
 *
 * The shape below is built around one rule, and everything else follows from it:
 *
 * > **A page may assert what an audience already knows. It may not assert that
 * > any individual reader knows it.**
 *
 * So a claim is authored as a hypothesis about the reader, and every skill it
 * covers is rendered next to the check that settles it. That is the difference
 * between this and the "you already know X, so skip to Y" article, which is
 * guessing and cannot tell you it guessed wrong. It is also §4.2 law 3 in the
 * one place where flattering the reader would convert better.
 *
 * The three §12 defences carry over from `guides/types.ts` unchanged:
 *
 *   - **The prose is hand-written** (§12.1 rule 3). Nothing here generates a
 *     sentence. Every *number* on the page, by contrast, is derived from the
 *     pack in `path.ts` and cannot be typed in at all — there is no field for
 *     one, which is a stronger version of the guides' reference syntax.
 *   - **Claims name skill slugs**, so a page cannot describe a shortcut through
 *     a skill the pack does not teach. The loader rejects an unknown slug.
 *   - **`noindex` until it clears §12.2 and somebody records a read.**
 */

const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*-for-[a-z0-9]+(-[a-z0-9]+)*$/,
    "must read {subject}-for-{audience}, lowercase and hyphen-separated",
  );

const skillSlug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/**
 * No digit may appear in any authored string on this page.
 *
 * Every number an audience page shows is arithmetic over the claims in the same
 * file — "four of twenty-six skills" is wrong the moment a fifth claim is added
 * three lines below, and nothing about that edit would remind anyone. So the
 * figures come from `references.ts` (`{{known}}`, `{{hours.low}}`) and there is
 * no way to write one by hand.
 *
 * This is stricter than the guides, which allow a literal figure in a title.
 * The stricter version is the right one here: a guide quotes a subject, and an
 * audience page quotes *itself*.
 *
 * A number spelled out in words gets through, and that is a known limit rather
 * than an oversight. The rule is a guardrail against the mistake people
 * actually make, not a proof; §12.1 rule 5's human read is what catches prose
 * arguing with its own arithmetic.
 */
const noDigits = (text: string) => !/\d/.test(text);
const NO_DIGITS = {
  message:
    "no digits in prose — every figure comes from a {{…}} reference (see references.ts)",
};

/**
 * What the audience brings to one part of the graph.
 *
 * Two verdicts, and the distinction between them is the whole page:
 *
 * - **`known`** — you can already do this. We would skip it, and the hours come
 *   off the estimate.
 * - **`transfers`** — you know the idea under another name. The hours stay on,
 *   because knowing what a pivot table does is not knowing what `GROUP BY`
 *   returns when the join underneath it fans out.
 *
 * There is deliberately no third verdict for "new". New is the absence of a
 * claim, so the page cannot pad its coverage by asserting ignorance.
 */
export const AudienceVerdict = z.enum(["known", "transfers"]);
export type AudienceVerdict = z.infer<typeof AudienceVerdict>;

/** The claim in the reader's own vocabulary, not ours. */
const claimText = z.string().min(20).refine(noDigits, NO_DIGITS);
/** Skill slugs in the pack. Validated against the real graph at load. */
const covers = z.array(skillSlug).min(1);

/**
 * A union rather than one object with an optional `note`, because the two
 * verdicts genuinely have different shapes and the difference is load-bearing:
 *
 *   - a **transfers** claim without a caveat is the flattery this page type
 *     exists to avoid, so the caveat is required;
 *   - a **known** claim with one is a page hedging something it just said it
 *     would skip, so there is nowhere to put it.
 *
 * It began as a pair of `superRefine` checks over a shared shape. Splitting it
 * moves both rules into the type, which means the renderer can draw the caveat
 * without asking whether it is there — and a branch that can never be false is
 * a branch nobody can test.
 */
export const KnownClaim = z
  .object({ claim: claimText, verdict: z.literal("known"), covers })
  .strict();

export const TransfersClaim = z
  .object({
    claim: claimText,
    verdict: z.literal("transfers"),
    covers,
    /** Where the resemblance stops being true. */
    note: z.string().min(20).refine(noDigits, NO_DIGITS),
  })
  .strict();

export const AudienceClaim = z.discriminatedUnion("verdict", [
  KnownClaim,
  TransfersClaim,
]);
export type AudienceClaim = z.infer<typeof AudienceClaim>;

/**
 * Who read it. The same block a pack and a guide carry, and for the same reason
 * pass 28 made it an enum: the free-string version failed open.
 */
export const AudienceReview = z.object({
  reviewedBy: z.string().min(2).nullable().default(null),
  reviewKind: z.enum(["human", "model"]).nullable().default(null),
  reviewedAt: z.string().nullable().default(null),
});
export type AudienceReview = z.infer<typeof AudienceReview>;

export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/);
  return words[0] === "" ? 0 : words.length;
}

/**
 * §11 item 1 — the 40–60 word direct answer, enforced rather than scored. The
 * range is `guides/types.ts`'s and the argument is identical: under 40 it has
 * not answered, over 60 the snippet truncates it.
 */
const directAnswer = z
  .string()
  .refine((t) => wordCount(t) >= 40 && wordCount(t) <= 60, {
    message: "the direct answer must be 40–60 words (§11 item 1)",
  })
  .refine(noDigits, NO_DIGITS);

export const AudienceSchema = z
  .object({
    slug,
    /** The pack this page re-cuts. Must exist, and must be its own subject. */
    topic: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    /**
     * The audience as a plural noun phrase — "product managers", not "a product
     * manager" and not "you". It is rendered inside our sentences, so it has to
     * be the form that fits one.
     */
    audience: z.string().min(3).max(48),
    /** §13.3 — title ≤60 characters, description 140–160. */
    title: z.string().min(1).max(60).refine(noDigits, NO_DIGITS),
    description: z.string().min(140).max(160).refine(noDigits, NO_DIGITS),
    h1: z.string().min(1).refine(noDigits, NO_DIGITS),
    answer: directAnswer,
    /**
     * Who this page is actually addressed to, stated as a condition the reader
     * can check about themselves before reading on. This is the field that
     * keeps the claims honest: an audience page with no admission requirement
     * is a page claiming things about everybody.
     */
    ifYou: z.array(z.string().min(10).refine(noDigits, NO_DIGITS)).min(2),
    claims: z.array(AudienceClaim).min(3),
    /**
     * The source and FAQ shapes are the guides', imported rather than copied.
     * They are the same objects in every way that matters — an external link
     * with an honest one-line assessment, and a question with an answer — and
     * both page types are rendered by the same `Prose`/`Sources` components,
     * which is the part that makes a second definition a liability: a citation
     * shape that drifts from the renderer's is a footnote that stops resolving.
     */
    sources: z.array(GuideSource).default([]),
    faqs: z
      .array(
        GuideFaq.refine(
          (f) => noDigits(f.question) && noDigits(f.answer),
          NO_DIGITS,
        ),
      )
      .default([]),
    review: AudienceReview.default({
      reviewedBy: null,
      reviewKind: null,
      reviewedAt: null,
    }),
  })
  .strict();
export type Audience = z.infer<typeof AudienceSchema>;

/**
 * Every word a reader sees that a person typed.
 *
 * Lives here for the reason `guideProse` does: the score and the duplicate
 * check both need "all the prose" and they must get the same answer. The
 * derived sections are deliberately excluded — they are the same sentences on
 * every page of this type by construction, and counting them would make two
 * audience pages look alike in exactly the dimension that is supposed to tell
 * them apart.
 */
export function audienceProse(audience: Audience): string {
  return [
    audience.answer,
    ...audience.ifYou,
    ...audience.claims.flatMap((c) =>
      c.verdict === "transfers" ? [c.claim, c.note] : [c.claim],
    ),
    ...audience.faqs.flatMap((f) => [f.question, f.answer]),
  ].join("\n\n");
}
