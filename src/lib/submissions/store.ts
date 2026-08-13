import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import {
  artifact,
  evaluation,
  learnerSkillMastery,
  masteryUpdate,
  submission,
} from "@/db/schema";
import { rubricId as rubricUuid, skillId as skillUuid } from "@/lib/packs/ids";
import { applyObservation } from "@/lib/engine/bkt";
import type { MasteryState } from "@/lib/engine";
import type { GradedResult } from "@/lib/evaluation";
import type { PackSkill } from "@/lib/packs/types";

/**
 * §15's submission tables, which have been waiting since pass 1.
 *
 * The shape of the write is the point: an `Evaluation` and the `MasteryUpdate`
 * rows it justifies go in **one transaction**. §15 calls the audit trail "every
 * mastery change is traceable to evidence", and a mastery row whose evaluation
 * failed to write is precisely an untraceable change — the thing §4.2 law 1
 * exists to prevent.
 */

/** queued | grading | complete | failed | human_review — §15's own list. */
export type SubmissionStatus =
  | "queued"
  | "grading"
  | "complete"
  | "failed"
  | "human_review";

export interface StoredSubmission {
  id: string;
  userId: string;
  projectSlug: string;
  packSlug: string;
  status: SubmissionStatus;
  artefact: string;
  truncated: boolean;
  submittedAt: Date;
}

function statusOf(value: string): SubmissionStatus {
  return value === "grading" ||
    value === "complete" ||
    value === "failed" ||
    value === "human_review"
    ? value
    : "queued";
}

export interface CreateSubmissionInput {
  userId: string;
  packSlug: string;
  projectSlug: string;
  /** The work itself. Stored on the artifact row, not on the submission. */
  artefact: string;
  truncated: boolean;
  /** The skill this evidences, so the evaluation knows what to move. */
  skillSlug: string;
  now: Date;
}

/**
 * Records a hand-in.
 *
 * The artefact is stored inline in `storageRef` rather than in object storage.
 * That is a deliberate limit rather than a shortcut: this build accepts pasted
 * text only, which is bounded by the ingest cap, and standing up a bucket to
 * hold 60KB of prose would be infrastructure with no user behind it yet. A repo
 * URL or a file upload changes that, and the column is named for the day it does.
 */
export async function createSubmission(
  db: Db,
  input: CreateSubmissionInput,
): Promise<string> {
  const id = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(submission).values({
      id,
      userId: input.userId,
      projectId: null,
      exerciseId: null,
      submittedAt: input.now,
      status: "queued",
    });

    await tx.insert(artifact).values({
      submissionId: id,
      type: "text",
      storageRef: input.artefact,
      sizeBytes: input.artefact.length,
      // §14.9.5 — truncation is disclosed on the evaluation, never silent.
      truncated: input.truncated,
      metadata: {
        packSlug: input.packSlug,
        projectSlug: input.projectSlug,
        skillSlug: input.skillSlug,
      },
    });
  });

  return id;
}

/** Metadata travels on the artifact row, so reading one means reading both. */
interface ArtifactMeta {
  packSlug: string;
  projectSlug: string;
  skillSlug: string;
}

function metaFrom(value: unknown): ArtifactMeta | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { packSlug, projectSlug, skillSlug } = value as Record<string, unknown>;

  return typeof packSlug === "string" &&
    typeof projectSlug === "string" &&
    typeof skillSlug === "string"
    ? { packSlug, projectSlug, skillSlug }
    : undefined;
}

export interface SubmissionDetail extends StoredSubmission {
  skillSlug: string;
}

/**
 * A submission and its work, scoped to its owner.
 *
 * Scoped rather than filtered afterwards: reading someone else's marked work by
 * guessing a UUID is not a feature, and the same rule the path screen follows.
 */
export async function submissionById(
  db: Db,
  id: string,
  userId: string,
): Promise<SubmissionDetail | undefined> {
  const [row] = await db
    .select({ submission, artifact })
    .from(submission)
    .innerJoin(artifact, eq(artifact.submissionId, submission.id))
    .where(and(eq(submission.id, id), eq(submission.userId, userId)))
    .limit(1);

  if (!row) return undefined;
  const meta = metaFrom(row.artifact.metadata);
  if (!meta) return undefined;

  return {
    id: row.submission.id,
    userId: row.submission.userId,
    packSlug: meta.packSlug,
    projectSlug: meta.projectSlug,
    skillSlug: meta.skillSlug,
    status: statusOf(row.submission.status),
    artefact: row.artifact.storageRef,
    truncated: row.artifact.truncated,
    submittedAt: row.submission.submittedAt,
  };
}

export async function setStatus(
  db: Db,
  id: string,
  status: SubmissionStatus,
): Promise<void> {
  await db.update(submission).set({ status }).where(eq(submission.id, id));
}

/* ── The evaluation, and what it moves ────────────────────────────────────── */

export interface RecordInput {
  submissionId: string;
  userId: string;
  packSlug: string;
  rubricSlug: string;
  rubricVersion: number;
  skill: PackSkill;
  /** Current belief about the skill, so BKT has a prior to move. */
  mastery: MasteryState;
  result: GradedResult;
  model: string;
  promptVersion: string;
  now: Date;
}

export interface RecordOutcome {
  evaluationId: string;
  /** Null when §7.2 kept the observation as engagement rather than evidence. */
  masteryDelta: number | null;
}

/**
 * Writes the evaluation, moves mastery, and leaves the trail between them.
 *
 * One transaction, because §15's promise is that every mastery change traces to
 * evidence. The `masteryUpdate` row carries `evaluationId`, which is the link
 * that makes "why did my score change" answerable months later — and `reason`,
 * which is the sentence a learner would be shown if they asked.
 */
export async function recordEvaluation(
  db: Db,
  input: RecordInput,
): Promise<RecordOutcome> {
  const evaluationId = crypto.randomUUID();
  const { result } = input;

  const { state, update } = applyObservation(
    input.mastery,
    input.skill.bktPriors,
    result.observation,
    input.now.toISOString(),
  );

  await db.transaction(async (tx) => {
    await tx.insert(evaluation).values({
      id: evaluationId,
      submissionId: input.submissionId,
      rubricId: rubricUuid(input.packSlug, input.rubricSlug),
      rubricVersion: input.rubricVersion,
      overallScore: result.overall,
      confidence: result.confidence,
      evalTier: result.evalTier,
      criterionResults: result.criteria,
      strengths: result.strengths,
      gaps: result.gaps,
      nextActions: result.nextActions,
      // §14.5 — what the score is built on, kept beside the score itself.
      provenBy: {
        invalidated: result.verification.invalidated,
        missing: result.verification.missing,
        bandSpread: result.bandSpread ?? null,
      },
      modelUsed: input.model,
      promptVersion: input.promptVersion,
      verifierPassed: result.verification.passed,
      deterministicChecks: null,
      humanReviewed: false,
      createdAt: input.now,
    });

    const skillId = skillUuid(input.packSlug, input.skill.slug);

    await tx.insert(masteryUpdate).values({
      userId: input.userId,
      skillId,
      evaluationId,
      priorMastery: update.prior,
      posteriorMastery: update.posterior,
      delta: update.delta,
      observationConfidence: result.observation.confidence,
      evidenceTier: result.evalTier,
      // Written for a person to read, because this is the row that answers
      // "why did my mastery move" (§15's audit trail).
      reason: update.ignoredAsEngagement
        ? `Logged as engagement only: ${input.skill.name} is Tier ${result.evalTier}, which cannot raise mastery.`
        : `Marked ${(result.overall * 100).toFixed(0)}% against the rubric, at confidence ${result.confidence.toFixed(2)}.`,
      createdAt: input.now,
    });

    const row = {
      userId: input.userId,
      skillId,
      mastery: state.mastery,
      confidence: state.confidence,
      evidenceCount: state.evidenceCount,
      lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt) : null,
      // Always set: `applyObservation` stamps it on every path, including the
      // one where §7.2 keeps the observation as engagement.
      lastPracticedAt: new Date(state.lastPracticedAt!),
      decayHalfLifeDays: state.decayHalfLifeDays,
      updatedAt: input.now,
    };

    await tx
      .insert(learnerSkillMastery)
      .values(row)
      .onConflictDoUpdate({
        target: [learnerSkillMastery.userId, learnerSkillMastery.skillId],
        set: row,
      });

    await tx
      .update(submission)
      .set({ status: result.humanReview ? "human_review" : "complete" })
      .where(eq(submission.id, input.submissionId));
  });

  return {
    evaluationId,
    masteryDelta: update.ignoredAsEngagement ? null : update.delta,
  };
}

export interface EvaluationView {
  id: string;
  overall: number;
  confidence: number;
  evalTier: number;
  criteria: GradedResult["criteria"];
  strengths: string[];
  gaps: string[];
  nextActions: string[];
  verifierPassed: boolean;
  humanReviewed: boolean;
  createdAt: Date;
}

function stringsFrom(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/** The latest evaluation for a submission, for the result screen. */
export async function evaluationFor(
  db: Db,
  submissionId: string,
): Promise<EvaluationView | undefined> {
  const [row] = await db
    .select()
    .from(evaluation)
    .where(eq(evaluation.submissionId, submissionId))
    .orderBy(desc(evaluation.createdAt))
    .limit(1);

  if (!row) return undefined;

  return {
    id: row.id,
    overall: row.overallScore,
    confidence: row.confidence,
    evalTier: row.evalTier,
    criteria: Array.isArray(row.criterionResults)
      ? (row.criterionResults as GradedResult["criteria"])
      : [],
    strengths: stringsFrom(row.strengths),
    gaps: stringsFrom(row.gaps),
    nextActions: stringsFrom(row.nextActions),
    verifierPassed: row.verifierPassed,
    humanReviewed: row.humanReviewed,
    createdAt: row.createdAt,
  };
}
