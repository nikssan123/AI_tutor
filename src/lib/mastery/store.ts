import { and, desc, eq, gt, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  artifact,
  evaluation,
  learningSession,
  masteryUpdate,
  skill as skillTable,
  submission,
} from "@/db/schema";
import { packId } from "@/lib/packs/ids";
import type { ArtefactEvidence } from "./ledger";
import type { SkillMove } from "./digest";

/**
 * The reads behind `/mastery` and `/progress`.
 *
 * Both screens are built from the audit trail rather than from a stored
 * summary. §15 promises that "every mastery change is traceable to evidence",
 * and the cheapest way to keep a promise like that honest is to make the screen
 * that displays it read the trail itself — a nightly rollup would let the two
 * drift apart, and the rollup is what a learner would see.
 *
 * The slug/UUID seam is the one `goals/store.ts` defends: the engine and the
 * packs work in slug space, the database in UUID space, and the join back to
 * `skill` is what proves a row still points at a skill that exists.
 */

/**
 * The marked work behind each skill, newest hand-in first.
 *
 * Inner-joined to `evaluation`, which is the whole point: `mastery_update` rows
 * are also written for answered questions in a session, and those carry no
 * artefact. Only a row that names an evaluation can produce the link §24 E9
 * requires, so the join is the filter.
 */
export async function artefactEvidence(
  db: Db,
  userId: string,
  packSlug: string,
): Promise<Map<string, ArtefactEvidence>> {
  const rows = await db
    .select({
      slug: skillTable.slug,
      submissionId: evaluation.submissionId,
    })
    .from(masteryUpdate)
    .innerJoin(evaluation, eq(evaluation.id, masteryUpdate.evaluationId))
    .innerJoin(skillTable, eq(skillTable.id, masteryUpdate.skillId))
    .where(
      and(
        eq(masteryUpdate.userId, userId),
        eq(skillTable.packId, packId(packSlug)),
      ),
    )
    // Id breaks the tie so two evaluations recorded in the same millisecond
    // still pick the same one every time the page is loaded.
    .orderBy(desc(masteryUpdate.createdAt), desc(masteryUpdate.id));

  const evidence = new Map<string, ArtefactEvidence>();
  for (const row of rows) {
    const seen = evidence.get(row.slug);
    if (seen) {
      seen.count += 1;
      continue;
    }
    evidence.set(row.slug, { submissionId: row.submissionId, count: 1 });
  }

  return evidence;
}

export interface ActivityWindow {
  userId: string;
  goalId: string;
  packSlug: string;
  from: Date;
  to: Date;
}

export interface WeekActivity {
  minutesLogged: number;
  sessions: number;
  moved: SkillMove[];
  artefacts: number;
}

/** §8 screen 11's week: hours, sessions, skills moved, artefacts produced. */
export async function weekActivity(
  db: Db,
  window: ActivityWindow,
): Promise<WeekActivity> {
  const { userId, goalId, packSlug, from, to } = window;

  const [sessions, moves, handIns] = await Promise.all([
    db
      .select({ minutes: learningSession.durationMinutes })
      .from(learningSession)
      .where(
        and(
          eq(learningSession.userId, userId),
          eq(learningSession.goalId, goalId),
          isNotNull(learningSession.completedAt),
          gte(learningSession.completedAt, from),
          lte(learningSession.completedAt, to),
        ),
      ),

    db
      .select({ name: skillTable.name, delta: masteryUpdate.delta })
      .from(masteryUpdate)
      .innerJoin(skillTable, eq(skillTable.id, masteryUpdate.skillId))
      .where(
        and(
          eq(masteryUpdate.userId, userId),
          eq(skillTable.packId, packId(packSlug)),
          // Movement, not observation. A missed recall question is a real row
          // in the trail and it is not something that "moved" this week.
          gt(masteryUpdate.delta, 0),
          gte(masteryUpdate.createdAt, from),
          lte(masteryUpdate.createdAt, to),
        ),
      ),

    // Counted on hand-in rather than on a completed evaluation: producing the
    // work is the learner's act, and a grader that failed does not un-produce
    // it. Filtered by pack through the artefact's own metadata, which is where
    // a submission records what it belongs to (`submissions/store.ts`).
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(submission)
      .innerJoin(artifact, eq(artifact.submissionId, submission.id))
      .where(
        and(
          eq(submission.userId, userId),
          gte(submission.submittedAt, from),
          lte(submission.submittedAt, to),
          sql`${artifact.metadata}->>'packSlug' = ${packSlug}`,
        ),
      ),
  ]);

  const byName = new Map<string, number>();
  for (const move of moves) {
    byName.set(move.name, (byName.get(move.name) ?? 0) + move.delta);
  }

  return {
    minutesLogged: sessions.reduce((sum, row) => sum + (row.minutes ?? 0), 0),
    sessions: sessions.length,
    moved: [...byName].map(([name, delta]): SkillMove => ({ name, delta })),
    // An aggregate with no group by returns exactly one row, zero included.
    artefacts: handIns[0]!.count,
  };
}
