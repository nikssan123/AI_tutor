import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import { toEngineGraph } from "@/lib/packs/validate";
import { skillId as packSkillId } from "@/lib/packs/ids";
import type { DomainPack } from "@/lib/packs/types";
import { activeGoal, masteryFor, type StoredGoal } from "@/lib/goals/store";
import { initialMastery } from "@/lib/engine/bkt";
import type { EngineSkill, MasteryState, SessionBlock } from "@/lib/engine";
import type { BlockResponse, LessonContent } from "@/lib/contracts/session";
import {
  DEFAULT_PRIOR_DOMAIN,
  type PriorDomain,
} from "@/lib/contracts/goal";
import { logCall } from "@/lib/ai/runlog";
import { aiAccess } from "@/lib/billing/gate";
import type { PlanId } from "@/lib/billing/catalog";
import { buildLearnerContext, masteryBand } from "./context";
import {
  cachedLesson,
  generateLesson,
  lessonsDeliveredOn,
  recordLessonDelivery,
  saveLesson,
  type LessonRequest,
  type SupportLevel,
} from "./lesson";
import {
  openMisconceptions,
  recentOutcomes,
  recentSignals,
  sessionById,
  type StoredSession,
} from "./store";

/**
 * Everything `/session/[id]` needs, assembled from the database.
 *
 * Kept out of the page for the reason `todayFor` is: the interesting part is
 * which state reaches the screen, and a render test would assert the sentence
 * rather than the state that produced it.
 *
 * The lesson is deliberately *not* here. It is the one part that can cost a
 * model call, so it is fetched separately and awaited inside a Suspense
 * boundary — the session shell reaches the browser immediately and the lesson
 * body streams in behind it, which is what keeps §24 E7's first-token budget
 * a property of the page rather than of the slowest thing on it.
 */

export interface SessionView {
  session: StoredSession;
  goal: StoredGoal;
  pack: DomainPack;
  /** The block the learner is on, or undefined when the session is finished. */
  block: SessionBlock | undefined;
  /** The skill that block is about, when it is about one. */
  skill: EngineSkill | undefined;
  mastery: MasteryState | undefined;
  skillNames: Map<string, string>;
  /** The answer already given to the current block, if it has been answered. */
  response: BlockResponse | undefined;
  /** §14.3 — the cached prefix the tutor runs on. */
  learnerContext: string;
  finished: boolean;
}

export async function sessionView(
  db: Db,
  userId: string,
  sessionId: string,
  now: Date,
): Promise<SessionView | undefined> {
  const session = await sessionById(db, sessionId, userId);
  if (!session) return undefined;

  const goal = await activeGoal(db, userId);
  // A session outliving its goal is a real state — the goal can be completed or
  // replaced while a session sits open — and it degrades to "no session" rather
  // than rendering blocks against a path that no longer exists.
  if (!goal || goal.id !== session.goalId) return undefined;

  const pack = await resolvePack(db, goal.packSlug);
  if (!pack) return undefined;

  const graph = toEngineGraph(pack);
  const skillsById = new Map(graph.skills.map((s) => [s.id, s]));
  const mastery = await masteryFor(db, userId, goal.packSlug);
  const masteryById = new Map(mastery.map((m) => [m.skillId, m]));

  const block = session.blocks[session.blockIndex];
  const skillSlug =
    block && block.type !== "review" && block.type !== "reflect"
      ? block.skillId
      : undefined;
  const skill = skillSlug === undefined ? undefined : skillsById.get(skillSlug);

  const [history, misconceptions] = await Promise.all([
    recentOutcomes(db, userId, goal.id, (slug) => skillsById.get(slug)?.area),
    openMisconceptions(db, userId, goal.packSlug),
  ]);

  return {
    session,
    goal,
    pack,
    block,
    skill,
    mastery:
      skill === undefined
        ? undefined
        : (masteryById.get(skill.id) ?? initialMastery(skill.id, skill.bktPriors)),
    skillNames: new Map(pack.skills.map((s) => [s.slug, s.name])),
    response: session.responses.find((r) => r.blockIndex === session.blockIndex),
    learnerContext: buildLearnerContext({
      goal: goal.spec,
      packName: pack.name,
      skills: graph.skills,
      mastery,
      history,
      misconceptions,
      focusSkillIds: session.blocks.flatMap((b) =>
        b.type === "review" || b.type === "reflect" ? [] : [b.skillId],
      ),
      today: now.toISOString().slice(0, 10),
    }),
    finished: session.blockIndex >= session.blocks.length,
  };
}

/**
 * §16.4 — "support fades as mastery rises."
 *
 * Read off the mastery band rather than off the planner's damper, which was the
 * first attempt: the damper fires on two failures in a row, but a learner who
 * has never seen a skill needs the worked example just as much and has failed
 * nothing. Level is also already part of the cache key, so deriving support
 * from it means two learners at the same band share a lesson rather than each
 * generating their own.
 *
 * `stuck` only ever escalates (PLAN-ADAPTATION step 3). A learner who has said
 * out loud that they do not follow it gets the worked example whatever their
 * band says; nothing can take it away. That keeps the band rule as the floor,
 * and it keeps the cache to two buckets per band rather than one per learner —
 * bounded personalisation, which is the only kind that survives a shared cache.
 */
export function supportFor(level: string, stuck = false): SupportLevel {
  if (stuck) return "worked_example";
  return level === "solid" || level === "getting there"
    ? "standard"
    : "worked_example";
}

export interface LessonOutcome {
  content: LessonContent | undefined;
  /** True when it came from the Postgres cache — §14.9.4 layer 2, verifiable. */
  cached: boolean;
  /**
   * True when there was no lesson because the month's ceiling was reached.
   *
   * Distinct from a failed generation, and the screen says different things:
   * a failure is ours to apologise for, a ceiling is something the learner can
   * act on. Without this the two are indistinguishable and the honest message
   * cannot be written.
   */
  capped?: boolean;
  /**
   * True when the plan's per-course lesson allowance is spent.
   *
   * A third outcome rather than a flavour of `capped`, because the two are
   * different facts and the screen owes a different sentence for each. `capped`
   * is "you have used this month's budget" — it comes back next month and no
   * money changes hands. This is "this is where the free course stops", which
   * is not a limit that lifts on its own and is the one the learner is meant to
   * act on.
   */
  locked?: boolean;
}

/**
 * The lesson for an explain block: cache first, model second.
 *
 * A failed generation returns no lesson rather than an apology dressed as one.
 * The screen then shows the block's own one-line brief and the tutor, which is
 * a thinner session than intended and an honest one — inventing filler text
 * would be the product teaching something nobody wrote.
 */
export async function lessonForBlock(
  db: Db,
  client: Anthropic,
  input: {
    userId: string;
    packSlug: string;
    skill: EngineSkill;
    mastery: MasteryState;
    minutes: number;
    now: Date;
    /** From the goal's spec. Omitted means `none` — see `PriorDomain`. */
    priorDomain?: PriorDomain | undefined;
    /**
     * The learner's plan, for §14.9.7 limit 1. Omitted skips the check, which
     * is what the calibration and probe callers want — they have no learner to
     * bill and `userId` is theirs, not a customer's.
     */
    plan?: PlanId | undefined;
    /**
     * The plan's per-course lesson allowance. `null` is unlimited; omitted
     * skips the paywall entirely, which is what the calibration and probe
     * callers want for the same reason they omit `plan` — there is no learner
     * here to sell anything to.
     */
    lessonsPerCourse?: number | null | undefined;
  },
): Promise<LessonOutcome> {
  const level = masteryBand(input.mastery);

  // PLAN-ADAPTATION step 3. Asked here rather than threaded down from the page,
  // because this is the only function that decides what a lesson looks like and
  // splitting that decision across two files is how the two would disagree.
  const signals = await recentSignals(
    db,
    input.userId,
    input.packSlug,
    input.now,
  );
  const stuck = signals.some(
    (s) => s.signal === "stuck" && s.skillSlug === input.skill.id,
  );

  const request: LessonRequest = {
    packSlug: input.packSlug,
    skillSlug: input.skill.id,
    skillName: input.skill.name,
    canDoStatement: input.skill.canDoStatement,
    level,
    minutes: input.minutes,
    support: supportFor(level, stuck),
    priorDomain: input.priorDomain ?? DEFAULT_PRIOR_DOMAIN,
  };

  /*
   * The plan's per-course allowance — **before the cache, deliberately.**
   *
   * This is the one check in this function that runs ahead of the cache lookup,
   * and the ordering is the whole difference between a paywall and a spend
   * control. §14.9.7's ceiling sits *after* the cache because a cached lesson
   * costs nothing and refusing somebody something free would be absurd. This
   * one has nothing to do with what a lesson costs us: a free learner on a
   * popular pack would otherwise read the entire course for nothing, purely
   * because other people had already paid to generate it.
   *
   * A skill they have already been served is let through either way. The
   * allowance buys a lesson, not one viewing of it, and a learner who reloads
   * the page or comes back tomorrow to re-read the one lesson they were given
   * is not asking for a second one.
   */
  if (input.lessonsPerCourse !== null && input.lessonsPerCourse !== undefined) {
    const delivered = await lessonsDeliveredOn(db, input.userId, input.packSlug);
    const already = delivered.has(packSkillId(input.packSlug, input.skill.id));

    if (!already && delivered.size >= input.lessonsPerCourse) {
      return { content: undefined, cached: false, locked: true };
    }
  }

  const hit = await cachedLesson(db, request);
  if (hit) {
    await recordLessonDelivery(db, {
      userId: input.userId,
      packSlug: input.packSlug,
      skillSlug: input.skill.id,
      now: input.now,
    });
    return { content: hit, cached: true };
  }

  /*
   * §14.9.7 limit 1 — **after the cache, not before it.**
   *
   * The ordering is the whole point. A cached lesson is a database read that
   * costs nothing, and §14.9.4 expects a 40–60% hit rate, so checking the cap
   * first would refuse a learner something free — and refuse it more often to
   * the learner most likely to be reading a popular pack's early skills.
   *
   * `standard` because §14.9.3 puts the lesson generator on Sonnet: there is no
   * cheaper model to fall to, so over the cap this declines to generate rather
   * than generating something worse. The caller already handles a missing
   * lesson honestly — the block's own brief and the tutor — which is what makes
   * declining safe here rather than a broken screen.
   */
  if (input.plan) {
    const access = await aiAccess(db, input.userId, input.plan, "standard");
    if (access.blocked) return { content: undefined, cached: false, capped: true };
  }

  const result = await logCall(db, input.userId, await generateLesson(client, request));
  if (result.status !== "ok") return { content: undefined, cached: false };

  await saveLesson(db, request, result.value, input.now);
  // After the content is in hand, never before: a generation that failed must
  // not spend the allowance on a lesson nobody got to read.
  await recordLessonDelivery(db, {
    userId: input.userId,
    packSlug: input.packSlug,
    skillSlug: input.skill.id,
    now: input.now,
  });
  return { content: result.value, cached: false };
}
