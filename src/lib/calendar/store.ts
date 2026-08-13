import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { learningSession } from "@/db/schema";
import type { WorkedDay } from "./schedule";

/**
 * The one read `/calendar` needs that no other screen already does.
 *
 * `/progress` sums a rolling week; this needs the same rows split by day, which
 * is a different question and not one you can ask a total. Everything else the
 * calendar shows — the retrieval queue, the mastery trail, the curriculum — is
 * read by the functions that already own those tables, because a second query
 * over `retrieval_queue_item` would be a second opinion about what is due.
 */

export interface WorkedRange {
  userId: string;
  goalId: string;
  from: Date;
  to: Date;
}

/**
 * Days the learner actually finished a session on, oldest first.
 *
 * Grouped in Postgres rather than in JS: the range covers up to a year, and
 * shipping a row per session to fold them into thirty buckets is work the
 * database is better at.
 *
 * `AT TIME ZONE 'UTC'` is what makes the bucket deterministic. A bare
 * `::date` cast reads the *connection's* timezone, so the same session would
 * land on different squares depending on how the server happened to be
 * configured — see the note in `dates.ts` about why the whole screen is UTC.
 */
export async function workedDays(
  db: Db,
  range: WorkedRange,
): Promise<WorkedDay[]> {
  const day = sql<string>`to_char(${learningSession.completedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      day,
      // A session that never recorded a duration counts as no time at all,
      // exactly as `weekActivity` treats it.
      minutes: sql<number>`coalesce(sum(${learningSession.durationMinutes}), 0)::int`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(learningSession)
    .where(
      and(
        eq(learningSession.userId, range.userId),
        eq(learningSession.goalId, range.goalId),
        isNotNull(learningSession.completedAt),
        gte(learningSession.completedAt, range.from),
        lte(learningSession.completedAt, range.to),
      ),
    )
    .groupBy(day)
    .orderBy(day);

  return rows.map((row) => ({
    day: row.day,
    minutes: row.minutes,
    sessions: row.sessions,
  }));
}
