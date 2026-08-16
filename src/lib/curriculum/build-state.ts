import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { curriculumBuild } from "@/db/schema";

/**
 * What the queue is doing to a goal, written down where the screen can read it.
 *
 * `/path` used to run the build inside the server action its button posted to,
 * which meant the only record that anything was happening was a pending HTTP
 * request. A server action posts over `fetch`, so there was not even a tab
 * throbber: the learner pressed the button and the page sat there for up to two
 * model calls and a validator. Reloading looked like the fix and made it worse
 * — the work carried on in the background, invisibly, and the page came back
 * showing the same offer to build.
 *
 * The row is the fix. The action claims it and returns; the queue moves it
 * through the phases; the screen reads it and says what is happening. Nothing
 * here is estimated or timed — a phase is reached because the pipeline said so.
 */

export type PathBuildStatus = "building" | "ready" | "failed" | "skipped";

/**
 * The phases of a curriculum build, in the order the pipeline reaches them.
 *
 * Ordered, and the order is the contract: the wait screen decides what is done
 * and what is still to come by position in this list, so a phase inserted in
 * the wrong place would show a finished step as pending.
 *
 * Three, because three is what the pipeline actually has. `planning` is the
 * draft — a model's, or `canonicalCurriculum`'s arithmetic on a plan that does
 * not buy the model one — `checking` is §14.6's validator, and `saving` is the
 * write. A run that fails its checks goes back to `planning` for its second
 * attempt, and the screen showing that is the truth rather than a glitch.
 */
export const PATH_BUILD_STAGES = ["planning", "checking", "saving"] as const;

export type PathBuildStage = (typeof PATH_BUILD_STAGES)[number];

export interface PathBuild {
  goalId: string;
  status: PathBuildStatus;
  /** Null before the worker picks the row up — queued, not yet started. */
  stage: PathBuildStage | null;
  detail: string | null;
  startedAt: Date;
}

/**
 * Past this, a row still saying `building` is treated as dead.
 *
 * A build is tens of seconds; ten minutes is far past anything that is merely
 * slow. It matters because nothing else catches a worker that dies mid-step: a
 * throw inside the step is retried once and then the run is abandoned, with the
 * row it never got to finish still saying "building". Without a cut-off the
 * learner would be told their path was being built, every few seconds, forever
 * — which is the fault this whole screen exists to fix, arrived at from the
 * other direction.
 *
 * Comfortably longer than `pack_build`'s pipeline needs proportionally, and
 * comfortably shorter than the fifteen minutes that one allows itself, because
 * this build is an order of magnitude quicker.
 */
export const PATH_BUILD_TIMEOUT_MINUTES = 10;

/**
 * Read back defensively, in both directions: the columns are `text`, so a row
 * written by an older deployment can hold a word this version has never heard
 * of. An unrecognised status reads as `failed` — a build we cannot describe is
 * one the learner should not be told to keep waiting for — and an unrecognised
 * stage reads as "not started", the one answer that cannot claim progress there
 * is no evidence for.
 */
function statusOf(value: string): PathBuildStatus {
  return value === "building" || value === "ready" || value === "skipped"
    ? value
    : "failed";
}

function stageOf(value: string | null): PathBuildStage | null {
  return PATH_BUILD_STAGES.find((stage) => stage === value) ?? null;
}

function toBuild(row: typeof curriculumBuild.$inferSelect): PathBuild {
  return {
    goalId: row.goalId,
    status: statusOf(row.status),
    stage: stageOf(row.stage),
    detail: row.detail,
    startedAt: row.startedAt,
  };
}

export async function findPathBuild(
  db: Db,
  goalId: string,
): Promise<PathBuild | undefined> {
  const [row] = await db
    .select()
    .from(curriculumBuild)
    .where(eq(curriculumBuild.goalId, goalId))
    .limit(1);

  return row ? toBuild(row) : undefined;
}

/**
 * Whether a row is still worth waiting for.
 *
 * One predicate, used by the screen that renders the wait and by the claim that
 * decides whether a second press starts a second build — so the two cannot
 * disagree about when a build has stopped being one.
 */
export function isRunning(build: PathBuild, now: Date = new Date()): boolean {
  return (
    build.status === "building" &&
    now.getTime() - build.startedAt.getTime() <
      PATH_BUILD_TIMEOUT_MINUTES * 60_000
  );
}

export type ClaimOutcome = "claimed" | "already-running";

/**
 * Claims the goal for a build, or reports that one is already going.
 *
 * The upsert is the lock — `goal_id` is the primary key — so a double-pressed
 * button, or two tabs, cannot put two runs on the same goal. A run that has
 * stopped, however it stopped, may be claimed again: a failure here is usually
 * the queue being unreachable rather than anything about this learner's course,
 * and it costs nothing to let them ask again.
 *
 * `stage` and `detail` are cleared explicitly because this upserts. A retry of
 * a build that died in `checking` would otherwise open on two finished steps it
 * has not done again, under the previous attempt's error message.
 */
export async function claimPathBuild(
  db: Db,
  goalId: string,
  now: Date = new Date(),
): Promise<ClaimOutcome> {
  const existing = await findPathBuild(db, goalId);
  if (existing && isRunning(existing, now)) return "already-running";

  const row = {
    goalId,
    status: "building",
    stage: null,
    detail: null,
    startedAt: now,
    finishedAt: null,
  };

  await db
    .insert(curriculumBuild)
    .values(row)
    .onConflictDoUpdate({ target: curriculumBuild.goalId, set: row });

  return "claimed";
}

/**
 * Records how far the run has got.
 *
 * Fire-and-report: nothing downstream reads the stage, so a write that fails
 * must not take the build with it — the worst it costs is a wait screen showing
 * the previous step for a few seconds longer. Scoped to rows still building, so
 * a stage arriving after the finish — the last one and the ready mark race by
 * milliseconds — cannot reopen a finished build.
 */
export async function markPathBuildStage(
  db: Db,
  goalId: string,
  stage: PathBuildStage,
): Promise<void> {
  await db
    .update(curriculumBuild)
    .set({ stage })
    .where(
      and(
        eq(curriculumBuild.goalId, goalId),
        eq(curriculumBuild.status, "building"),
      ),
    );
}

export async function finishPathBuild(
  db: Db,
  goalId: string,
  outcome:
    | { status: "ready" }
    | { status: "failed" | "skipped"; detail: string },
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(curriculumBuild)
    .set({
      status: outcome.status,
      detail: outcome.status === "ready" ? null : outcome.detail,
      finishedAt: now,
    })
    .where(eq(curriculumBuild.goalId, goalId));
}

/**
 * Why a build ended without a path, in the learner's language.
 *
 * The queue's three non-outcomes are not all failures, and flattening them into
 * "something went wrong" would be a lie in two cases out of three. Somebody who
 * has already proved everything their course covers has *finished*, and telling
 * them the machine broke would be the worst possible reading of the best
 * possible news.
 *
 * Which is why `skipped` is a status of its own rather than a failure with a
 * gentle message: the screen shows it without alarm and without a retry, since
 * pressing the button again would reach the same conclusion at the same price.
 */
const SKIPPED: Record<string, string> = {
  "nothing-to-teach":
    "There is nothing left to build a path through — you have already proved everything this course covers.",
  "not-active":
    "This course was put aside before its path was built, so we stopped rather than spend on a course nobody is taking.",
  "no-pack":
    "The subject this course was created from is no longer one we carry, so there was nothing left to cut into modules.",
};

/** True for the outcomes that are a decision rather than a breakage. */
export function isSkip(reason: string): boolean {
  return reason in SKIPPED;
}

export function outcomeDetail(reason: string): string {
  return (
    SKIPPED[reason] ??
    "The build stopped before it reached a path, and we do not have a reason for it beyond that."
  );
}
