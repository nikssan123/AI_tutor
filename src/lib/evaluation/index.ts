import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { logCall, shouldDegrade, type SPEND_CAP_CENTS } from "@/lib/ai/runlog";
import { BAND_SCORE, type EvaluationDraft } from "@/lib/contracts/evaluation";
import type { EvalTier, PackProject, RubricCriterion } from "@/lib/packs/types";
import { gradeSubmission, type GradeInput } from "./grade";
import {
  confidenceFor,
  needsHumanReview,
  observationFrom,
  score,
  verify,
  type VerificationResult,
} from "./verify";

/**
 * §14.5's pipeline, minus the two steps that need infrastructure this build
 * does not have yet.
 *
 * Implemented: ingest normalisation, rubric grading, self-consistency, the
 * verifier, confidence assignment, and the observation the mastery model reads.
 *
 * **Not implemented, and not pretended:** step 2's deterministic checks, which
 * mean executing a learner's code. That needs a sandbox, and a sandbox is a
 * security problem rather than a feature — running submitted code in the same
 * process as the database is not a shortcut anybody gets to take. Until it
 * exists no skill can honestly hold §7.2 tier 1, and `tierFor` below refuses to
 * hand one out, which keeps the claim on the screen true rather than aspirational.
 */

/** §14.5 step 1 — "PII scrub; size cap". The cap the grader's context can hold. */
export const MAX_ARTEFACT_CHARS = 60_000;

export interface EvaluationOutcome {
  /** Null when nothing could be graded; `reason` says why. */
  result: GradedResult | null;
  reason: string | null;
}

export interface GradedResult {
  overall: number;
  confidence: number;
  evalTier: EvalTier;
  verification: VerificationResult;
  /** Per-criterion, upheld only — what the learner is shown. */
  criteria: Array<{
    criterionId: string;
    name: string;
    band: EvaluationDraft["criteria"][number]["band"];
    evidence: string;
    reasoning: string;
    weight: number;
  }>;
  strengths: string[];
  gaps: string[];
  nextActions: string[];
  /** §14.5 step 4 — band distance between the two passes, when a second ran. */
  bandSpread: number | undefined;
  humanReview: boolean;
  observation: { correct: boolean; confidence: number; evidenceTier: EvalTier };
}

/**
 * §14.5 step 1 — ingest and normalise.
 *
 * Truncation is disclosed rather than silent (§14.9.5): a learner whose work
 * was cut off must not be marked as though the missing half did not exist, so
 * the marker is left in the text the grader sees and the quote verifier will
 * happily anchor to it.
 */
export function normaliseArtefact(raw: string): {
  text: string;
  truncated: boolean;
} {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (text.length <= MAX_ARTEFACT_CHARS) return { text, truncated: false };

  return {
    text:
      text.slice(0, MAX_ARTEFACT_CHARS) +
      "\n\n[This submission was longer than we can mark and was cut off here.]",
    truncated: true,
  };
}

/**
 * The tier an evaluation may claim, which is the skill's own tier capped by
 * what this pipeline can actually do.
 *
 * §7.2 tier 1 is "execute + assert against expected behaviour". Nothing here
 * executes anything, so a tier-1 skill graded by reading its code is being
 * assessed at tier 2 and says so. The cap disappears when the sandbox arrives;
 * until then this is the difference between a limit and a lie (§4.2 law 3).
 */
export const MAX_TIER_WITHOUT_EXECUTION: EvalTier = 2;

export function tierFor(skillTier: EvalTier): EvalTier {
  return skillTier < MAX_TIER_WITHOUT_EXECUTION
    ? MAX_TIER_WITHOUT_EXECUTION
    : skillTier;
}

/** How far apart two passes put the same criterion, in bands. */
export function spreadBetween(
  first: EvaluationDraft,
  second: EvaluationDraft,
): number {
  const secondById = new Map(second.criteria.map((c) => [c.criterionId, c.band]));

  let widest = 0;
  for (const verdict of first.criteria) {
    const other = secondById.get(verdict.criterionId);
    if (!other) continue;

    // Bands are evenly spaced, so the distance in band-steps is the score gap
    // over the step size. Rounded because the arithmetic is on thirds.
    const gap = Math.abs(BAND_SCORE[verdict.band] - BAND_SCORE[other]);
    widest = Math.max(widest, Math.round(gap * 3));
  }
  return widest;
}

export interface EvaluateDeps {
  client: Anthropic;
  db: Db;
  userId: string | null;
  plan?: keyof typeof SPEND_CAP_CENTS;
}

export interface EvaluateInput {
  project: Pick<PackProject, "title" | "brief" | "acceptanceCriteria">;
  criteria: RubricCriterion[];
  /** The tier of the skill this evidences, before this pipeline's own cap. */
  skillTier: EvalTier;
  artefact: string;
}

export async function evaluateSubmission(
  deps: EvaluateDeps,
  input: EvaluateInput,
): Promise<EvaluationOutcome> {
  const { text } = normaliseArtefact(input.artefact);
  if (text.length === 0) {
    // Nothing to quote means nothing to grade. Caught here rather than by a
    // model politely inventing something to say about an empty page.
    return { result: null, reason: "There was nothing in what you handed in." };
  }

  const degraded =
    deps.userId !== null && deps.plan !== undefined
      ? await shouldDegrade(deps.db, deps.userId, deps.plan)
      : false;

  const gradeArgs: GradeInput = {
    project: input.project,
    criteria: input.criteria,
    artefact: text,
  };

  const first = await logCall(
    deps.db,
    deps.userId,
    await gradeSubmission(deps.client, gradeArgs, { degraded }),
  );

  if (first.status !== "ok") {
    return {
      result: null,
      reason: `The marker could not run (${first.status}).`,
    };
  }

  const tier = tierFor(input.skillTier);

  /*
   * §14.5 step 4 — self-consistency, "Tier 2/3/4 only". Tier 1 is excluded in
   * the plan because execution has already settled it; nothing here executes,
   * so every evaluation gets the second pass. It is the only check available
   * that can catch a confidently wrong band.
   */
  const second = await logCall(
    deps.db,
    deps.userId,
    await gradeSubmission(
      deps.client,
      { ...gradeArgs, framing: "second-pass" },
      { degraded },
    ),
  );

  const bandSpread =
    second.status === "ok" ? spreadBetween(first.value, second.value) : undefined;

  const verification = verify(first.value, input.criteria, text);

  /*
   * Nothing survived the verifier, so there is no evidence behind any number
   * we could produce. The score would be 0 out of 0 and would read to a learner
   * as "your work scored zero" rather than "we could not mark this" — which is
   * §4.2 law 3 in its most damaging form, since it is a claim about their work
   * rather than about our failure.
   */
  if (verification.upheld.length === 0) {
    return {
      result: null,
      reason:
        "We could not mark this one: nothing the marker said could be traced back to what you handed in.",
    };
  }

  const scored = score(verification.upheld);

  const confidence = confidenceFor({
    tier,
    verification,
    coverage: scored.coverage,
    bandSpread,
  });

  return {
    result: {
      overall: scored.overall,
      confidence,
      evalTier: tier,
      verification,
      criteria: verification.upheld.map((u) => ({
        criterionId: u.verdict.criterionId,
        name: u.criterion.name,
        band: u.verdict.band,
        evidence: u.verdict.evidence,
        reasoning: u.verdict.reasoning,
        weight: u.criterion.weight,
      })),
      strengths: first.value.strengths,
      gaps: first.value.gaps,
      nextActions: first.value.nextActions,
      bandSpread,
      // §14.5 step 8, plus the case the plan does not name: two passes more
      // than a band apart is a disagreement no confidence score should paper
      // over, whatever the tier's floor happens to be.
      humanReview:
        needsHumanReview(confidence) ||
        (bandSpread !== undefined && bandSpread > 1),
      observation: observationFrom(scored.overall, confidence, tier),
    },
    reason: null,
  };
}
