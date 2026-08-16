import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { logCall, shouldDegrade, type RunOrigin } from "@/lib/ai/runlog";
import type { PlanId } from "@/lib/billing/catalog";
import { BAND_SCORE, type EvaluationDraft } from "@/lib/contracts/evaluation";
import type { EvalTier, PackProject, RubricCriterion } from "@/lib/packs/types";
import type { FailureCause } from "@/lib/submissions/failure";
import { gradeSubmission, type GradeInput } from "./grade";
import { tierFor } from "./tier";
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
  /** Null when nothing could be graded; `cause` says why. */
  result: GradedResult | null;
  reason: string | null;
  /**
   * Which of `FAILURE_CAUSES` this was, for the row and thence the screen.
   *
   * Alongside `reason` rather than instead of it: `reason` is what the handler
   * returns to the queue and what the logs read, and it says more than four
   * codes can. The code is the half a learner is shown copy for, and keeping
   * them separate is what stopped a `CallResult.status` reaching a screen.
   */
  cause: FailureCause | null;
  /**
   * What actually went wrong, for `submission.failure_detail`. Never rendered.
   *
   * This is the string the pipeline used to discard. `The marker could not run
   * (invalid)` kept the status and threw away the `detail` beside it, which was
   * the only part that said *which* invalid — "gaps: Too big: expected array to
   * have <=6 items", in the failure this column was added after.
   */
  detail: string | null;
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
 * The tier an evaluation may claim. Defined in `./tier`, which has no
 * dependencies, so that the pages quoting a tier to a visitor can apply the same
 * cap without importing the grader — the reason they did not, and the reason
 * they overclaimed for four passes.
 */
export { MAX_TIER_WITHOUT_EXECUTION, tierFor } from "./tier";

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
  /**
   * Only read when `userId` is null. A calibration run grades real submissions
   * with nobody to bill, and without this its spend counts against §19.2's
   * free-tier cap and degrades the anonymous check for actual visitors.
   */
  origin?: RunOrigin;
  plan?: PlanId;
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
    return {
      result: null,
      reason: "There was nothing in what you handed in.",
      cause: "empty",
      detail: null,
    };
  }

  // The month's ceiling only — deliberately **not** `degradesGeneration`.
  //
  // A cheaper plan buys fewer evaluations, never worse ones. Marking on a
  // weaker model for a Learner would sell a worse verdict to a cheaper
  // customer, and the verdict is the product's whole claim (§4.2 law 1, §14.5).
  // It would also fork §21's calibration corpus by plan and make the κ
  // measurement meaningless. See `degradesGeneration` in the catalog.
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
    undefined,
    deps.origin,
  );

  if (first.status !== "ok") {
    /*
     * `first.status` used to be spliced into this sentence and shown to the
     * learner: "The marker could not run (invalid)." A `CallResult` status is
     * machinery, and `invalid` in particular is a lie by connotation — it reads
     * as a judgement on what they handed in, when it means our own schema
     * rejected our own model's reply.
     *
     * The status picks the code, the detail beside it goes to the row, and the
     * learner gets the copy `marker_unavailable` maps to. `reason` keeps the
     * status because the queue's return value and the logs are ours.
     */
    return {
      result: null,
      reason: `The marker could not run (${first.status}).`,
      cause: "marker_unavailable",
      detail: first.detail,
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
    undefined,
    deps.origin,
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
      cause: "unverifiable",
      detail: `every criterion was invalidated: ${verification.invalidated
        .map((i) => `${i.criterionId} (${i.reason})`)
        .join("; ")}`,
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
    cause: null,
    detail: null,
  };
}
