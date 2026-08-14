import type { Db } from "@/db";
import { plan } from "@/lib/engine";
import { toEngineGraph } from "@/lib/packs/validate";
import { resolvePack } from "@/lib/content/resolve";
import type { DomainPack } from "@/lib/packs/types";
import type { PlannedSession } from "@/lib/engine";
import type { SkillProjection } from "@/lib/contracts/goal";
import { activeGoal, masteryFor, sessionMinutesFor, type StoredGoal } from "./store";
import { projectSkills } from "./projection";
import {
  dueRetrieval,
  nextSessionIndex,
  openSession,
  recentAttempts,
  recentOutcomes,
} from "@/lib/session/store";

/**
 * Everything `/today` needs, assembled from the database and planned.
 *
 * Kept out of the page so the assembly is testable without rendering: the part
 * worth testing is which numbers reach the planner, and a render test would
 * check the sentence they produced instead.
 *
 * §8 screen 6 wants this precomputed overnight so the page loads instantly. It
 * is computed per request instead, because §24 E5 pins the planner under 50ms
 * and a nightly job would trade that for a plan that can be a day stale — the
 * wrong trade while a learner can finish a check and reload the page. The
 * precompute belongs with the Inngest work in E7, where sessions start being
 * written and the plan has history to be stale about.
 */

export interface TodayView {
  goal: StoredGoal;
  pack: DomainPack;
  projection: SkillProjection;
  session: PlannedSession;
  /** Name per skill slug, for rendering blocks the engine returns by id. */
  skillNames: Map<string, string>;
  /**
   * The id of a session already under way, so the card offers to resume rather
   * than to start — and so a second start cannot orphan the first one's answers.
   */
  openSessionId: string | undefined;
}

export interface TodayOptions {
  /** §8 screen 6's "I have less time" — a shorter session, same planner. */
  availableMinutes?: number | undefined;
}

export async function todayFor(
  db: Db,
  userId: string,
  now: Date,
  options: TodayOptions = {},
): Promise<TodayView | undefined> {
  const goal = await activeGoal(db, userId);
  if (!goal) return undefined;

  // A goal can outlive the pack it was created against — a pack removed from
  // disk is a deployment event, not a corrupt row — so this is a real branch,
  // and it degrades to the "no goal yet" screen rather than a crash.
  const pack = await resolvePack(db, goal.packSlug);
  if (!pack) return undefined;

  const nowIso = now.toISOString();
  const graph = toEngineGraph(pack);
  const mastery = await masteryFor(db, userId, goal.packSlug);
  const projection = projectSkills({
    graph,
    mastery,
    now: nowIso,
    depth: goal.spec.depth,
  });
  const areaOf = new Map(pack.skills.map((s) => [s.slug, s.area]));

  // Everything the planner was handed as an empty array until E7 wrote it.
  // Four of §16.1's nine terms read these, so a learner's tenth session used to
  // be scored exactly like their first.
  const [history, attempts, retrievalQueue, sessionIndex, open] =
    await Promise.all([
      recentOutcomes(db, userId, goal.id, (slug) => areaOf.get(slug)),
      recentAttempts(db, userId, goal.id),
      dueRetrieval(db, userId, goal.packSlug),
      nextSessionIndex(db, userId, goal.id),
      openSession(db, userId, goal.id),
    ]);

  const session = plan({
    now: nowIso,
    goalId: goal.id,
    graph,
    goalSkillIds: projection.requiredSkillIds,
    mastery,
    history,
    attempts,
    retrievalQueue,
    constraints: {
      availableMinutes:
        options.availableMinutes ?? (await sessionMinutesFor(db, userId)),
      weeklyHours: goal.spec.weeklyHours,
      deadline: goal.spec.deadline,
    },
    sessionIndex,
    depth: goal.spec.depth,
  });

  return {
    goal,
    pack,
    projection,
    session,
    skillNames: new Map(pack.skills.map((s) => [s.slug, s.name])),
    openSessionId: open?.id,
  };
}
