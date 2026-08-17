import type { EvalTier } from "@/lib/packs/types";

/**
 * The tier the product may *claim*, as opposed to the tier a pack declares.
 *
 * §7.2 tier 1 is "execute + assert against expected behaviour". Nothing in this
 * build executes anything — a sandbox is a security problem rather than a
 * feature, and running submitted code beside the database is not a shortcut
 * anybody gets to take. So a tier-1 skill graded by *reading* the work is being
 * assessed at tier 2, and every surface that mentions a tier has to say tier 2.
 *
 * This lives in a module of its own, apart from the pipeline, for a reason that
 * turned out to be the whole bug: the cap was defined next to the grader, which
 * imports the Anthropic SDK, so no page could import it without dragging the
 * grading pipeline into a static marketing route. The cap was therefore applied
 * in exactly one place — the evaluator — while `/learn/{topic}`,
 * `/projects/{slug}`, `/check/{topic}` and the share cards all read the pack's
 * declared tier and told visitors "We run your work and check the answer is
 * right." The claim was false on every page that made it, and true in the only
 * place nobody reads it: the verdict, after the work was already handed in.
 *
 * §4.2 law 3 is the rule this breaks, and it is the one the product is sold on.
 * Nothing that renders a tier may reach past this function for a better number.
 *
 * Deleting the cap is part of shipping the sandbox, and not before.
 */
export const MAX_TIER_WITHOUT_EXECUTION: EvalTier = 2;

/**
 * §7.2 tier 3 is "media review" — the verdict rests on looking at something.
 *
 * It is the one tier in this build whose claim can be falsified by the hand-in
 * itself rather than by the pipeline's own limits, which is why it needs the
 * second argument below.
 */
export const MEDIA_TIER: EvalTier = 3;

/**
 * @param imageSubmitted whether a photograph actually arrived with the work.
 *
 * Defaults to true, which is what a page describing a brief nobody has answered
 * yet means: *this* is the claim, if the work asked for arrives. Only the
 * pipeline knows better, and only after the fact — a tier-3 skill graded from a
 * written method alone was not media review, it was §7.2 tier 2, and saying
 * "Tier 3 evidence" on that verdict claims we looked at a photograph that was
 * never handed in.
 *
 * Note which way that moves: tier 2 carries a *higher* confidence band than
 * tier 3, so a learner who submits less is not flattered by a lower tier and is
 * not punished by it either. The tiers are kinds of evidence, not grades of it,
 * and reading a written method against a rubric is genuinely the more reliable
 * read. What would be dishonest is the label, not the number.
 */
export function tierFor(declaredTier: EvalTier, imageSubmitted = true): EvalTier {
  const rested =
    declaredTier === MEDIA_TIER && !imageSubmitted
      ? MAX_TIER_WITHOUT_EXECUTION
      : declaredTier;

  return rested < MAX_TIER_WITHOUT_EXECUTION
    ? MAX_TIER_WITHOUT_EXECUTION
    : rested;
}
