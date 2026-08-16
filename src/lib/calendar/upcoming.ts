import type { Db } from "@/db";
import type { DomainPack } from "@/lib/packs/types";
import type { StoredGoal } from "@/lib/goals/store";
import { masteryFor } from "@/lib/goals/store";
import { toEngineGraph } from "@/lib/packs/validate";
import { effectiveMastery } from "@/lib/engine/bkt";
import { remainingHoursFor } from "@/lib/engine/scoring";
import { buildLedger } from "@/lib/mastery/ledger";
import { artefactEvidence } from "@/lib/mastery/store";
import { currentCurriculum } from "@/lib/curriculum/store";
import { dueRetrieval } from "@/lib/session/store";
import { dayOf } from "./dates";
import { claimLapses } from "./lapse";
import { projectCheckpoints } from "./checkpoints";
import { dueSkills } from "./view";
import { buildEntries, type CalendarEntry } from "./schedule";

/**
 * The next few dated things, for `/today`.
 *
 * `/progress` holds the month, and holding it there is right — a grid is a
 * screen you go to, not one you glance at. What a learner opening the product
 * daily actually needs is narrower: *is anything about to land on me*. Until
 * this existed the answer lived two clicks and a scroll away, so a hand-in due
 * in four days was something you found out about by going looking for it.
 *
 * **Nothing here is a new source of truth**, and that is the whole design.
 * `buildEntries` produces the rows, so a question coming back round is worded
 * on `/today` exactly as it is worded on `/progress`; the dates come from the
 * same queue, the same ledger and the same checkpoint projection. A second
 * "what's coming" that computed its own version would be two screens quietly
 * disagreeing about the same week.
 *
 * It reads for itself rather than taking `todayFor`'s working set, which costs
 * two queries it could have borrowed. That is deliberate: `todayFor` is also
 * what `startSessionAction` calls, and putting a ledger read and a curriculum
 * read behind the *Start session* button would make the hottest path in the
 * product pay for a band it never renders.
 */

/**
 * Three rows, and it is a cap rather than a target.
 *
 * `/progress` shows eight, because that screen is where you go to read the
 * month. This one sits under the session card on a screen §8 screen 6 says must
 * answer "what do I do now" in under two seconds and must never become a feed.
 * Three is what fits under that rule: the things close enough to change what you
 * do today, and nothing else.
 */
export const UPCOMING_LIMIT = 3;

export interface UpcomingInput {
  userId: string;
  goal: StoredGoal;
  pack: DomainPack;
  now: Date;
  limit?: number;
}

export async function upcomingFor(
  db: Db,
  input: UpcomingInput,
): Promise<CalendarEntry[]> {
  const nowIso = input.now.toISOString();
  const today = dayOf(nowIso);

  const [mastery, queue, evidence, curriculum] = await Promise.all([
    masteryFor(db, input.userId, input.goal.packSlug),
    dueRetrieval(db, input.userId, input.goal.packSlug),
    artefactEvidence(db, input.userId, input.goal.packSlug),
    currentCurriculum(db, input.goal.id),
  ]);

  const graph = toEngineGraph(input.pack);
  const names = new Map(input.pack.skills.map((s) => [s.slug, s.name]));
  const byId = new Map(mastery.map((m) => [m.skillId, m]));

  const ledger = buildLedger({
    skills: input.pack.skills,
    mastery,
    evidence,
    now: nowIso,
  });

  const remaining = new Map(
    graph.skills.map((skill) => {
      const state = byId.get(skill.id);
      return [
        skill.id,
        remainingHoursFor(skill, state ? effectiveMastery(state, nowIso) : 0),
      ];
    }),
  );

  const checkpoints = projectCheckpoints({
    modules: curriculum?.modules ?? [],
    remainingHours: remaining,
    weeklyHours: input.goal.spec.weeklyHours,
    /*
     * Zero, which `CheckpointInput` documents as "the week holds no pace to
     * project from" rather than as an error — and here it is a statement about
     * this screen rather than about the week. The second date is the honest
     * half of `/progress`'s checkpoint card and it is not on this band, so
     * buying the `workedDays` read to compute a figure nothing renders would be
     * paying for precision that never reaches anybody.
     */
    actualWeeklyHours: 0,
    today,
  });

  const entries = buildEntries({
    // Nothing recorded: this band is about what has not happened yet, and a
    // session you already finished is not news on the screen you finished it on.
    worked: [],
    retrieval: dueSkills(queue, names),
    lapses: claimLapses({ claims: ledger.canDo, mastery: byId, now: nowIso }),
    checkpoints,
    deadline: input.goal.spec.deadline,
    targetOutcome: input.goal.spec.targetOutcome,
  });

  // Sorted by day already, so overdue comes first — which is the correct order
  // for a band whose job is to say what is about to land on you.
  return entries.slice(0, input.limit ?? UPCOMING_LIMIT);
}
