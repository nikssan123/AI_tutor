import { and, count, desc, eq, gt } from "drizzle-orm";
import type { Db } from "@/db";
import { packBuild } from "@/db/schema";

/**
 * The state of an on-demand pack build.
 *
 * Keyed by slug rather than by learner, deliberately: §7.1 says a Generated
 * pack is promoted to Standard "after 5 users", which only means anything if
 * the pack is shared. Ten people asking for Rust start one generation and all
 * ten get the same pack — which is also what stops on-demand authoring from
 * being a money hole at roughly $0.61 a time.
 */

export type BuildStatus = "building" | "ready" | "failed";

export interface PackBuild {
  slug: string;
  subject: string;
  status: BuildStatus;
  detail: string | null;
  startedAt: Date;
}

/**
 * How many packs one learner may have in flight.
 *
 * One. Authoring is the most expensive thing the product does, and nothing a
 * learner can do with a second simultaneous build is something they need — they
 * can only study one subject at a time on `/today` anyway.
 */
export const MAX_CONCURRENT_BUILDS_PER_USER = 1;

/**
 * A build older than this is treated as dead rather than in progress.
 *
 * A generation takes about three minutes; a worker that died mid-run would
 * otherwise leave a slug wedged in `building` forever, and the learner watching
 * the wait screen has no way to ask for it again.
 */
export const BUILD_TIMEOUT_MINUTES = 15;

function statusOf(value: string): BuildStatus {
  return value === "ready" || value === "failed" ? value : "building";
}

type BuildRow = typeof packBuild.$inferSelect;

function toBuild(row: BuildRow): PackBuild {
  return {
    slug: row.slug,
    subject: row.subject,
    status: statusOf(row.status),
    detail: row.detail,
    startedAt: row.startedAt,
  };
}

export async function findBuild(
  db: Db,
  slug: string,
): Promise<PackBuild | undefined> {
  const [row] = await db
    .select()
    .from(packBuild)
    .where(eq(packBuild.slug, slug))
    .limit(1);

  return row ? toBuild(row) : undefined;
}

/**
 * A learner's live builds — one predicate, so the count used for rate limiting
 * and the row shown on screen cannot disagree about what "in flight" means.
 */
function inFlight(userId: string, now: Date) {
  const cutoff = new Date(now.getTime() - BUILD_TIMEOUT_MINUTES * 60_000);

  return and(
    eq(packBuild.requestedBy, userId),
    eq(packBuild.status, "building"),
    gt(packBuild.startedAt, cutoff),
  );
}

/** Builds this learner has in flight, ignoring ones that have clearly died. */
export async function activeBuildsFor(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(packBuild)
    .where(inFlight(userId, now));

  return Number(row!.n);
}

/**
 * The build a learner has running, for screens that owe them a progress report.
 *
 * `activeBuildsFor` answers "may they start another"; this answers "what is
 * happening to them right now", which is what every screen outside `/start`
 * needs and none of them could ask. A learner who walks away from the wait
 * screen is mid-course-creation, and until this existed the rest of the product
 * had no way to say so — `/today` offered to build a course that was already
 * being built, and the button it offered fails with "you already have a course
 * being built".
 *
 * Newest first, though `MAX_CONCURRENT_BUILDS_PER_USER` means there is at most
 * one: the ordering is what makes that cap a rate limit rather than an
 * assumption this function rests on.
 */
export async function buildInFlightFor(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<PackBuild | undefined> {
  const [row] = await db
    .select()
    .from(packBuild)
    .where(inFlight(userId, now))
    .orderBy(desc(packBuild.startedAt))
    .limit(1);

  return row ? toBuild(row) : undefined;
}

export type StartOutcome =
  | { kind: "started" }
  | { kind: "already"; build: PackBuild }
  | { kind: "rate-limited" };

/**
 * Claims a slug for building, or reports why it did not.
 *
 * The insert is the lock: `slug` is the primary key, so two requests racing to
 * build the same subject cannot both win, and the loser is told to go and watch
 * the build that already exists rather than starting a second one.
 */
export async function startBuild(
  db: Db,
  input: { slug: string; subject: string; userId: string },
  now: Date = new Date(),
): Promise<StartOutcome> {
  const existing = await findBuild(db, input.slug);

  if (existing) {
    const stale =
      existing.status === "building" &&
      now.getTime() - existing.startedAt.getTime() >
        BUILD_TIMEOUT_MINUTES * 60_000;

    // A failed or abandoned build may be retried; a live one is joined.
    if (!stale && existing.status !== "failed") {
      return { kind: "already", build: existing };
    }
  } else if (
    (await activeBuildsFor(db, input.userId, now)) >=
    MAX_CONCURRENT_BUILDS_PER_USER
  ) {
    return { kind: "rate-limited" };
  }

  const row = {
    slug: input.slug,
    subject: input.subject,
    requestedBy: input.userId,
    status: "building",
    detail: null,
    startedAt: now,
    finishedAt: null,
  };

  await db
    .insert(packBuild)
    .values(row)
    .onConflictDoUpdate({ target: packBuild.slug, set: row });

  return { kind: "started" };
}

export async function finishBuild(
  db: Db,
  slug: string,
  outcome: { status: "ready" } | { status: "failed"; detail: string },
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(packBuild)
    .set({
      status: outcome.status,
      detail: outcome.status === "failed" ? outcome.detail : null,
      finishedAt: now,
    })
    .where(eq(packBuild.slug, slug));
}
