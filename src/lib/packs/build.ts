import { and, count, desc, eq, gt, lt, or } from "drizzle-orm";
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

/**
 * The phases of an authoring run, in the order the pipeline reaches them.
 *
 * The wait screen is the only reader, and it exists because of what the screen
 * had to say without one: for three minutes, nothing except that it was still
 * waiting. A learner cannot tell that apart from a page that has hung, which is
 * how a working build comes to be reported as broken.
 *
 * Ordered, and the order is the contract — `stepStates` in the wait screen
 * decides what is done and what is still to come by position in this list, so
 * a phase inserted in the wrong place would show a finished step as pending.
 * Every value here is written by `generatePack` except `saving`, which the
 * Inngest handler writes around the seed.
 */
export const BUILD_STAGES = ["graph", "writing", "checking", "saving"] as const;

export type BuildStage = (typeof BUILD_STAGES)[number];

export interface PackBuild {
  slug: string;
  subject: string;
  /** Who asked first. Null once they are gone; the pack outlives them. */
  requestedBy: string | null;
  status: BuildStatus;
  /** Null before the worker picks the row up — queued, not yet started. */
  stage: BuildStage | null;
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

/**
 * A stage column read back as a stage, or nothing.
 *
 * Same shape as `statusOf` and for the same reason: the column is `text`, so a
 * row written by an older deployment — or by hand — can hold a word this
 * version has never heard of. Unrecognised reads as "not started", which is the
 * one answer that cannot make the screen claim progress it has no evidence for.
 */
function stageOf(value: string | null): BuildStage | null {
  return BUILD_STAGES.find((stage) => stage === value) ?? null;
}

type BuildRow = typeof packBuild.$inferSelect;

function toBuild(row: BuildRow): PackBuild {
  return {
    slug: row.slug,
    subject: row.subject,
    requestedBy: row.requestedBy,
    status: statusOf(row.status),
    stage: stageOf(row.stage),
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

/**
 * Packs this learner has ever commissioned, for the free tier's lifetime quota.
 *
 * No period filter — that is the whole point of the number. A monthly allowance
 * compounds into twelve subjects a year from an account that never pays; one,
 * ever, is what bounds a free signup's cost at a single build while still making
 * "any subject works" true for everybody who arrives.
 *
 * Counted from the build rows rather than from a ledger of its own, because
 * `requestedBy` is already the record of who asked and a retry writes no new
 * row: `startBuild` upserts on the slug, so a learner who retries a failed
 * subject is still on their first. That is deliberate — the quota is one custom
 * *subject*, not one attempt at one.
 *
 * One imprecision worth naming: if a build fails and a *different* learner later
 * asks for the same subject, the upsert moves `requestedBy` to them and the
 * first learner's count drops by one. The outcome is that somebody whose only
 * build failed, on a subject somebody else also wanted, gets another go. That is
 * the direction to be wrong in, so it is left alone rather than given a table.
 */
export async function buildsCommissionedBy(
  db: Db,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(packBuild)
    .where(eq(packBuild.requestedBy, userId));

  return Number(row!.n);
}

/**
 * Whether this learner is the one this subject was commissioned by.
 *
 * The other half of `buildsCommissionedBy`, and it exists because that count
 * cannot answer the question a retry asks. A learner whose only build failed
 * has a row, so their count is 1, so a lifetime quota of 1 refuses them — and
 * what it refuses them is *the subject they already spent it on*. Asking who
 * owns the row separates "a second subject", which the quota is for, from
 * "the same subject again", which costs the quota nothing: `startBuild` upserts
 * on the slug, so the retry reuses the row and the count does not move.
 *
 * Owned by somebody else is not owned. The upsert would move `requestedBy` to
 * whoever asks next, and that genuinely is a new subject for them.
 */
export async function hasCommissioned(
  db: Db,
  userId: string,
  slug: string,
): Promise<boolean> {
  const [row] = await db
    .select({ slug: packBuild.slug })
    .from(packBuild)
    .where(and(eq(packBuild.slug, slug), eq(packBuild.requestedBy, userId)))
    .limit(1);

  return row !== undefined;
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
    // Cleared explicitly, because this upserts: a retry of a subject that died
    // in `checking` would otherwise open on three finished steps it has not
    // done again, and the first one it re-does would read as a step going
    // backwards.
    stage: null,
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

/**
 * Records how far the run has got, for the learner watching it.
 *
 * Fire-and-report: nothing downstream depends on the stage, so a write that
 * fails must not take the build with it — the worst it can cost is a wait
 * screen showing the previous step for a few seconds longer. Scoped to rows
 * still building so a stage arriving after `finishBuild` — the seed step and
 * the ready mark race by milliseconds — cannot reopen a finished build.
 */
export async function markBuildStage(
  db: Db,
  slug: string,
  stage: BuildStage,
): Promise<void> {
  await db
    .update(packBuild)
    .set({ stage })
    .where(and(eq(packBuild.slug, slug), eq(packBuild.status, "building")));
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

/* ── The operator's side of a failure ─────────────────────────────────────── */

/**
 * A stopped build, with what an operator needs to decide what to do about it.
 *
 * Richer than `PackBuild` because the audience is different. A learner sees one
 * build and needs to know whether to wait; an operator sees every build that
 * stopped and needs to know which one to look at first, who is waiting on it,
 * and whether anybody has been told.
 */
export interface StoppedBuild extends PackBuild {
  finishedAt: Date | null;
  /** When the team was emailed. Null means they were not — see `notifiedAt`. */
  notifiedAt: Date | null;
  /**
   * True when the row still says `building` but has outlived the timeout.
   *
   * A run nobody will ever finish, which is not the same as one that failed and
   * said why: it stopped without a reason, so the operator's first move is to
   * find out where rather than to read a message that was never written.
   */
  stalled: boolean;
}

/**
 * Every build that stopped, newest first.
 *
 * Failed rows and stalled ones together, because the difference matters to what
 * an operator does next and not at all to whether it needs attention. Both are
 * a learner who asked for a subject and did not get it.
 */
export async function stoppedBuilds(
  db: Db,
  now: Date = new Date(),
): Promise<StoppedBuild[]> {
  const cutoff = new Date(now.getTime() - BUILD_TIMEOUT_MINUTES * 60_000);

  const rows = await db
    .select()
    .from(packBuild)
    .where(
      or(
        eq(packBuild.status, "failed"),
        and(eq(packBuild.status, "building"), lt(packBuild.startedAt, cutoff)),
      ),
    )
    .orderBy(desc(packBuild.startedAt));

  return rows.map((row) => ({
    ...toBuild(row),
    finishedAt: row.finishedAt,
    notifiedAt: row.notifiedAt,
    stalled: statusOf(row.status) === "building",
  }));
}

/**
 * Records that the team was told, so the admin list can show that they were.
 *
 * Separate from `finishBuild` rather than a field on it, because the two can
 * fail independently: the build failing is one fact and the mail going out is
 * another, and a row that recorded them together would have to claim the mail
 * sent before it had.
 */
export async function markBuildNotified(
  db: Db,
  slug: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(packBuild)
    .set({ notifiedAt: now })
    .where(eq(packBuild.slug, slug));
}
