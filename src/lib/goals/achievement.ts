import type { Db } from "@/db";
import { buildLedger } from "@/lib/mastery/ledger";
import { artefactEvidence } from "@/lib/mastery/store";
import { toEngineGraph } from "@/lib/packs/validate";
import type { DomainPack } from "@/lib/packs/types";
import { isAchieved } from "./lifecycle";
import { courseSkillIds } from "./projection";
import { activeGoal, masteryFor, setGoalStatus } from "./store";

/**
 * Finishing a course, at the only moment it can become true.
 *
 * Called after an evaluation has moved mastery, because that is the only event
 * that can add a skill to `canDo` (§4.2 law 1 — a claim needs a marked hand-in,
 * and nothing else writes one). Checking anywhere else would either be a write
 * during a page read, or a check that could never find anything new.
 *
 * **It is recorded rather than derived, and that is the point.** Derived, it
 * would be computed from `effectiveMastery`, which decays — so a learner who
 * finished a course in March and did not touch it until June would watch it
 * quietly un-finish itself. Decay is honest about what a *claim* is currently
 * worth (§8 screen 10 shows it, and `/calendar` dates it); it is not a statement
 * that the work was never done. Finishing happened, and it stays happened.
 *
 * Silent when nothing has changed: this runs on every marked submission, and
 * the overwhelmingly common answer is "not yet".
 */
export async function markAchievedIfComplete(
  db: Db,
  userId: string,
  pack: DomainPack,
  now: Date,
): Promise<boolean> {
  const goal = await activeGoal(db, userId);
  // No running course, or the hand-in belongs to a course that is not the one
  // running — a learner can pause a course with a submission still queued.
  if (!goal || goal.packSlug !== pack.slug) return false;

  const nowIso = now.toISOString();
  const [mastery, evidence] = await Promise.all([
    masteryFor(db, userId, pack.slug),
    artefactEvidence(db, userId, pack.slug),
  ]);

  // The same ledger `/mastery` builds, and the same non-optional set the path
  // screen counts. A second opinion about what counts as proved would
  // eventually finish a course the mastery screen still showed work left on.
  const ledger = buildLedger({
    skills: pack.skills,
    mastery,
    evidence,
    now: nowIso,
  });

  // Measured against *this goal's* depth. A sprint whose yardstick was the
  // standard course set could never finish: the learner would claim every skill
  // their course asked for and still be counted short by the advanced skills it
  // deliberately made optional.
  const complete = isAchieved({
    courseSkillIds: courseSkillIds(toEngineGraph(pack), goal.spec.depth),
    claimed: new Set(ledger.canDo.map((entry) => entry.skillSlug)),
  });
  if (!complete) return false;

  await setGoalStatus(db, userId, goal.id, "achieved", now);
  return true;
}
