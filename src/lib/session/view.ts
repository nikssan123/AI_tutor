import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import { toEngineGraph } from "@/lib/packs/validate";
import type { DomainPack } from "@/lib/packs/types";
import { activeGoal, masteryFor, type StoredGoal } from "@/lib/goals/store";
import { initialMastery } from "@/lib/engine/bkt";
import type { EngineSkill, MasteryState, SessionBlock } from "@/lib/engine";
import type { BlockResponse, LessonContent } from "@/lib/contracts/session";
import { logCall } from "@/lib/ai/runlog";
import { buildLearnerContext, masteryBand } from "./context";
import {
  cachedLesson,
  generateLesson,
  saveLesson,
  type LessonRequest,
  type SupportLevel,
} from "./lesson";
import {
  openMisconceptions,
  recentOutcomes,
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
 */
export function supportFor(level: string): SupportLevel {
  return level === "solid" || level === "getting there"
    ? "standard"
    : "worked_example";
}

export interface LessonOutcome {
  content: LessonContent | undefined;
  /** True when it came from the Postgres cache — §14.9.4 layer 2, verifiable. */
  cached: boolean;
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
  },
): Promise<LessonOutcome> {
  const level = masteryBand(input.mastery);
  const request: LessonRequest = {
    packSlug: input.packSlug,
    skillSlug: input.skill.id,
    skillName: input.skill.name,
    canDoStatement: input.skill.canDoStatement,
    level,
    minutes: input.minutes,
    support: supportFor(level),
  };

  const hit = await cachedLesson(db, request);
  if (hit) return { content: hit, cached: true };

  const result = await logCall(db, input.userId, await generateLesson(client, request));
  if (result.status !== "ok") return { content: undefined, cached: false };

  await saveLesson(db, request, result.value, input.now);
  return { content: result.value, cached: false };
}
