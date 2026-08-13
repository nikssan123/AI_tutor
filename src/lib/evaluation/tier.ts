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

export function tierFor(declaredTier: EvalTier): EvalTier {
  return declaredTier < MAX_TIER_WITHOUT_EXECUTION
    ? MAX_TIER_WITHOUT_EXECUTION
    : declaredTier;
}
