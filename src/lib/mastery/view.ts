import type { Db } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import { activeGoal, masteryFor, type StoredGoal } from "@/lib/goals/store";
import { projectSkills } from "@/lib/goals/projection";
import { toEngineGraph } from "@/lib/packs/validate";
import type { DomainPack } from "@/lib/packs/types";
import type { MasteryState } from "@/lib/engine";
import { buildLedger, type Ledger } from "./ledger";
import { retentionHealth, summarise, windowStart, type Digest } from "./digest";
import { artefactEvidence, weekActivity } from "./store";

/**
 * Everything `/mastery` and `/progress` need, assembled from the audit trail.
 *
 * Kept out of the pages for the reason `goals/today.ts` gives: what is worth
 * testing is which numbers reach the ledger, and a render test would check the
 * sentence they produced instead.
 *
 * Both screens are built on the same ledger, deliberately. `/progress` promises
 * to show which skills are slipping and links to `/mastery` to do it, so the
 * count and the rows have to be one fact rather than two computations that
 * usually agree.
 */

export interface LedgerView {
  goal: StoredGoal;
  pack: DomainPack;
  ledger: Ledger;
}

interface Assembled extends LedgerView {
  mastery: MasteryState[];
}

/**
 * A goal can outlive the pack it was created against — a pack removed from disk
 * is a deployment event, not a corrupt row — so both screens degrade to the "no
 * goal yet" state rather than crashing, exactly as `/today` does.
 */
async function assemble(
  db: Db,
  userId: string,
  now: Date,
): Promise<Assembled | undefined> {
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

export async function ledgerFor(
  db: Db,
  userId: string,
  now: Date,
): Promise<LedgerView | undefined> {
  const assembled = await assemble(db, userId, now);
  if (!assembled) return undefined;

  const { goal, pack, ledger } = assembled;
  return { goal, pack, ledger };
}

export interface DigestView extends LedgerView {
  digest: Digest;
  from: Date;
  to: Date;
}

export async function digestFor(
  db: Db,
  userId: string,
  now: Date,
): Promise<DigestView | undefined> {
  const assembled = await assemble(db, userId, now);
  if (!assembled) return undefined;

  const { goal, pack, mastery, ledger } = assembled;
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
    ledger,
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
