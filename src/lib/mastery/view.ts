import type { Db } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import {
  activeGoal,
  goalsFor,
  masteryFor,
  type StoredGoal,
} from "@/lib/goals/store";
import type { GoalStatus } from "@/lib/goals/lifecycle";
import { projectSkills } from "@/lib/goals/projection";
import { toEngineGraph } from "@/lib/packs/validate";
import type { DomainPack } from "@/lib/packs/types";
import type { MasteryState } from "@/lib/engine";
import { buildLedger, type Ledger, type LedgerEntry } from "./ledger";
import { retentionHealth, summarise, windowStart, type Digest } from "./digest";
import { artefactEvidence, weekActivity } from "./store";

/**
 * Everything `/mastery` and `/progress` need, assembled from the audit trail.
 *
 * Kept out of the pages for the reason `goals/today.ts` gives: what is worth
 * testing is which numbers reach the ledger, and a render test would check the
 * sentence they produced instead.
 *
 * **The two screens stopped sharing an assembly, on purpose.** They used to, so
 * that the count and the rows could not drift. They are now answering different
 * questions, and the difference is the point:
 *
 * - `/progress` is about a **course**. A week measured against a commitment, and
 *   the same remaining work priced at the pace actually kept. With nothing
 *   running there is no commitment and no remainder, so there is nothing to
 *   report — the screen says so rather than inventing a week.
 * - `/mastery` is about a **person**. §1 calls the ledger "an evidence-backed,
 *   per-skill record of what you have demonstrably done", and that record is not
 *   the property of whichever course happens to be running. It used to vanish
 *   the moment a learner paused one, which made the product's stated competitive
 *   advantage the most perishable thing in it.
 *
 * They still share `buildLedger`, which is where the drift would actually have
 * mattered: one definition of what counts as proved.
 */

/* ── The running course ───────────────────────────────────────────────────── */

interface ActiveCourse {
  goal: StoredGoal;
  pack: DomainPack;
  mastery: MasteryState[];
  ledger: Ledger;
}

/**
 * A goal can outlive the pack it was created against — a pack removed from disk
 * is a deployment event, not a corrupt row — so this degrades to "nothing
 * running" rather than crashing, exactly as `/today` does.
 */
async function activeCourse(
  db: Db,
  userId: string,
  now: Date,
): Promise<ActiveCourse | undefined> {
  const goal = await activeGoal(db, userId);
  if (!goal) return undefined;

  const pack = await resolvePack(db, goal.packSlug);
  if (!pack) return undefined;

  const [mastery, evidence] = await Promise.all([
    masteryFor(db, userId, goal.packSlug),
    artefactEvidence(db, userId, goal.packSlug),
  ]);

  return {
    goal,
    pack,
    mastery,
    ledger: buildLedger({
      skills: pack.skills,
      mastery,
      evidence,
      now: now.toISOString(),
    }),
  };
}

/* ── /mastery ─────────────────────────────────────────────────────────────── */

/** The claims from one subject, whatever became of the course behind them. */
export interface ClaimGroup {
  packSlug: string;
  packName: string;
  /**
   * Where the course stands now. A claim does not weaken because the course was
   * put away — the hand-in still happened — so this labels the group rather than
   * qualifying anything in it.
   */
  status: GoalStatus;
  entries: LedgerEntry[];
}

export interface LedgerView {
  /**
   * The running course, when there is one. Everything on this screen that is a
   * statement about a *plan* rather than about the learner comes from here.
   */
  active: { goal: StoredGoal; pack: DomainPack } | undefined;
  /** Every claim the learner holds, across every course. Running course first. */
  claims: ClaimGroup[];
  /** `claims` flattened and counted, so the page does not re-derive it. */
  provedCount: number;
  /**
   * Only ever the running course's.
   *
   * "What's left" is a statement about a path, and a learner between courses is
   * not on one. Merged across subjects it would be worse than empty: it would
   * list everything they have not yet proved in every subject they have ever
   * touched, and call that their remaining work.
   */
  whatsLeft: LedgerEntry[];
}

/**
 * The learner's whole ledger, newest course first, deduplicated by subject.
 *
 * Grouped by **pack** rather than by goal, because mastery is keyed per learner
 * per skill: a learner who started photography twice has one set of claims, and
 * two goals would otherwise render them twice. The most recent goal in a subject
 * supplies the label, which is why `goalsFor` returning newest-first matters
 * here.
 */
export async function ledgerFor(
  db: Db,
  userId: string,
  now: Date,
): Promise<LedgerView | undefined> {
  const nowIso = now.toISOString();
  const [goals, running] = await Promise.all([
    goalsFor(db, userId),
    activeCourse(db, userId, now),
  ]);

  const seen = new Set<string>();
  const groups: ClaimGroup[] = [];

  for (const goal of goals) {
    if (seen.has(goal.packSlug)) continue;
    seen.add(goal.packSlug);

    const pack = await resolvePack(db, goal.packSlug);
    // Nothing to name the group after, and no skills to build it from.
    if (!pack) continue;

    // Rebuilt per pack rather than reusing the running course's ledger: the
    // running course is one of these groups, and special-casing it would be two
    // code paths deciding what counts as proved.
    const [mastery, evidence] = await Promise.all([
      masteryFor(db, userId, goal.packSlug),
      artefactEvidence(db, userId, goal.packSlug),
    ]);
    const ledger = buildLedger({
      skills: pack.skills,
      mastery,
      evidence,
      now: nowIso,
    });

    // A subject with nothing proved in it is not a group; it is an absence, and
    // a heading over an empty list is a worse answer than no heading.
    if (ledger.canDo.length === 0) continue;

    groups.push({
      packSlug: goal.packSlug,
      packName: pack.name,
      status: goal.status,
      entries: ledger.canDo,
    });
  }

  // Nothing to show and nothing to say about it.
  if (groups.length === 0 && !running) return undefined;

  // The course being worked on leads, however old it is. A learner who picked
  // an older course back up is looking for that one.
  const ordered = running
    ? [
        ...groups.filter((g) => g.packSlug === running.goal.packSlug),
        ...groups.filter((g) => g.packSlug !== running.goal.packSlug),
      ]
    : groups;

  return {
    active: running ? { goal: running.goal, pack: running.pack } : undefined,
    claims: ordered,
    provedCount: ordered.reduce((sum, group) => sum + group.entries.length, 0),
    whatsLeft: running?.ledger.whatsLeft ?? [],
  };
}

/* ── /progress ────────────────────────────────────────────────────────────── */

export interface DigestView {
  goal: StoredGoal;
  pack: DomainPack;
  digest: Digest;
  from: Date;
  to: Date;
}

export async function digestFor(
  db: Db,
  userId: string,
  now: Date,
): Promise<DigestView | undefined> {
  const course = await activeCourse(db, userId, now);
  if (!course) return undefined;

  const { goal, pack, mastery, ledger } = course;
  const from = windowStart(now);

  const activity = await weekActivity(db, {
    userId,
    goalId: goal.id,
    packSlug: goal.packSlug,
    from,
    to: now,
  });

  // The estimate is the projection recomputed now, not a number stored when the
  // goal was created — which is the only way "revised" means anything.
  const projection = projectSkills({
    graph: toEngineGraph(pack),
    mastery,
    now: now.toISOString(),
  });

  return {
    goal,
    pack,
    digest: summarise({
      committedHours: goal.spec.weeklyHours,
      minutesLogged: activity.minutesLogged,
      sessions: activity.sessions,
      moved: activity.moved,
      artefacts: activity.artefacts,
      retention: retentionHealth(ledger),
      remainingHours: projection.estimatedHours,
    }),
    from,
    to: now,
  };
}
