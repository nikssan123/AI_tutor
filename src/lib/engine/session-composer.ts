import { DEFAULT_COURSE_DEPTH } from "./types";
import type {
  CourseDepth,
  EngineItem,
  EngineSkill,
  RetrievalCandidate,
  ScoredSkill,
  SessionBlock,
} from "./types";

/**
 * §16.1 step 4 — session composition.
 *
 * Every rule here is enforced in application code rather than asked for in a
 * prompt, because §4.2 makes active learning a schema constraint: a session
 * that is 90% reading is not a session this product is willing to compose.
 */

/** Retrieval practice opens every session — non-negotiable (§16.1, §16.4). */
export const MIN_RETRIEVAL_ITEMS = 2;
export const MAX_RETRIEVAL_ITEMS = 4;
export const MAX_RETRIEVAL_MINUTES = 8;

/** §14.9.2 — sum(explain.estMinutes) <= 0.5 * sessionMinutes. */
export const MAX_EXPLAIN_RATIO = 0.5;

/**
 * §16.1 — every 4th session produces a gradeable artefact, and depth moves the
 * number in both directions for the same reason.
 *
 * A sprint has fewer sessions to spend, so waiting until the fourth to produce
 * anything gradeable means a short course can end having moved mastery once.
 * A mastery course tightens it too, because at that depth the artefact *is* the
 * point. Standard keeps §16.1's original 4.
 */
export const APPLY_SESSION_INTERVALS: Record<CourseDepth, number> = {
  sprint: 3,
  standard: 4,
  mastery: 3,
};

export function applyIntervalFor(depth: CourseDepth): number {
  return APPLY_SESSION_INTERVALS[depth];
}

export function isApplySession(
  sessionIndex: number,
  depth: CourseDepth = DEFAULT_COURSE_DEPTH,
): boolean {
  return sessionIndex > 0 && sessionIndex % applyIntervalFor(depth) === 0;
}

export interface ComposeInput {
  sessionIndex: number;
  availableMinutes: number;
  ranked: ScoredSkill[];
  skillsById: Map<string, EngineSkill>;
  retrievalQueue: RetrievalCandidate[];
  /** The pack's authored questions. Omitted means none are available. */
  items?: EngineItem[] | undefined;
  now: string;
  /** Sets the artefact cadence. Omitted means `standard`. */
  depth?: CourseDepth | undefined;
}

/** Types a check can serve. A session block is a textarea and nothing else, so
 * an `mcq` would show its stem with no options; a `micro_artifact` is a small
 * piece of work, which is what the `apply` block is for. */
const CHECKABLE_ITEM_TYPES = new Set(["short_text", "explain", "code_read"]);


/**
 * The question to ask about a skill, given what is authored and what has
 * already been served.
 *
 * **Nearest the learner's current estimate**, which is the diagnostic's rule
 * (`selectNextItem`) for the same reason: an item far below tells you nothing
 * you did not know, and one far above measures whether they can guess.
 *
 * Anything already in the retrieval queue is excluded, because it is coming
 * back on its own schedule — serving it again here would ask the same question
 * twice in one session and reset a spacing interval that was doing its job.
 * Ties break on item id, so the same state always yields the same question.
 */
export function selectCheckItem(
  items: EngineItem[],
  skillId: string,
  estimate: number,
  queue: RetrievalCandidate[],
): EngineItem | undefined {
  const queued = new Set(queue.map((c) => c.itemId));

  return items
    .filter(
      (item) =>
        item.skillId === skillId &&
        CHECKABLE_ITEM_TYPES.has(item.type) &&
        !queued.has(item.itemId),
    )
    .sort((a, b) => {
      const byFit =
        Math.abs(a.difficulty - estimate) - Math.abs(b.difficulty - estimate);
      return byFit !== 0 ? byFit : a.itemId.localeCompare(b.itemId);
    })[0];
}

export interface ComposeResult {
  blocks: SessionBlock[];
  totalMinutes: number;
  targetSkillIds: string[];
  /**
   * True when the best available skill is one the learner has just failed twice
   * and there was nothing better to offer, so the session consolidates instead
   * of pushing. §16.1's damper is "back off, don't grind" — a large negative
   * score alone does not back anything off if the skill still ranks first.
   */
  backingOff: boolean;
}

/**
 * §16.1 — the hard damper. Fires only when the top-ranked skill is itself the
 * twice-failed one: if anything else is available the ranking has already moved
 * on, and there is nothing to back off from.
 */
export function shouldBackOff(ranked: ScoredSkill[]): boolean {
  const top = ranked[0];
  if (!top) return false;
  return top.components.recentlyFailedTwice === 1;
}

/**
 * Picks the retrieval items that open the session: due first, oldest due date
 * first, capped by both item count and minutes. Deterministic ordering by
 * (dueAt, itemId) so the same queue always yields the same opening.
 */
export function selectRetrievalItems(
  queue: RetrievalCandidate[],
  nowIso: string,
): RetrievalCandidate[] {
  const due = queue
    .filter((item) => item.dueAt <= nowIso)
    .sort((a, b) =>
      a.dueAt !== b.dueAt
        ? a.dueAt.localeCompare(b.dueAt)
        : a.itemId.localeCompare(b.itemId),
    );

  // Nothing overdue yet: pull the next-soonest items anyway. Retrieval practice
  // opening the session is unconditional, so an empty queue is the only reason
  // a session starts without it.
  const pool =
    due.length > 0
      ? due
      : [...queue].sort((a, b) =>
          a.dueAt !== b.dueAt
            ? a.dueAt.localeCompare(b.dueAt)
            : a.itemId.localeCompare(b.itemId),
        );

  const selected: RetrievalCandidate[] = [];
  let minutes = 0;

  for (const item of pool) {
    if (selected.length >= MAX_RETRIEVAL_ITEMS) break;
    const wouldBe = minutes + item.estMinutes;
    // Always admit the first two items; the minutes cap only starts biting once
    // the non-negotiable minimum is met.
    if (selected.length >= MIN_RETRIEVAL_ITEMS && wouldBe > MAX_RETRIEVAL_MINUTES) {
      break;
    }
    selected.push(item);
    minutes = wouldBe;
  }

  return selected;
}

/**
 * Composes the session. Returns blocks whose `estMinutes` sum to at most the
 * time available, with the explain cap and the apply-session rule both applied.
 */
export function composeSession(input: ComposeInput): ComposeResult {
  const blocks: SessionBlock[] = [];
  const targetSkillIds: string[] = [];
  const available = Math.max(0, input.availableMinutes);

  // 1. Retrieval, always first.
  const retrieval = selectRetrievalItems(input.retrievalQueue, input.now);
  let used = 0;
  for (const item of retrieval) {
    if (used + item.estMinutes > available) break;
    const skill = input.skillsById.get(item.skillId);
    blocks.push({
      type: "check",
      skillId: item.skillId,
      prompt: skill
        ? `Recall: ${skill.canDoStatement}`
        : `Recall the prior skill for item ${item.itemId}`,
      // The recall target, not the queue row's id. This field held `itemId`
      // until something finally read it: §14.9.2 defines `expected` as what a
      // correct answer looks like, and a grader handed a queue id marks every
      // answer wrong. The id it used to carry now has its own field.
      expected: skill ? skill.canDoStatement : item.itemId,
      isRetrieval: true,
      itemId: item.itemId,
      estMinutes: item.estMinutes,
    });
    used += item.estMinutes;
  }

  const top = input.ranked[0];
  if (!top) {
    return { blocks, totalMinutes: used, targetSkillIds, backingOff: false };
  }

  const topSkill = input.skillsById.get(top.skillId);
  const remaining = available - used;

  if (remaining <= 0 || !topSkill) {
    return { blocks, totalMinutes: used, targetSkillIds, backingOff: false };
  }

  targetSkillIds.push(top.skillId);

  // 2a. Backing off: the learner has failed this twice running and there is
  //     nothing better to offer. Scaffolding goes back *up* (§16.4 — support
  //     fades as mastery rises, so it should return when mastery stalls), and
  //     crucially there is no artefact to submit: setting them up to fail a
  //     third time is the behaviour the damper exists to prevent.
  if (shouldBackOff(input.ranked)) {
    const explainMinutes = Math.min(
      Math.floor(available * MAX_EXPLAIN_RATIO),
      Math.max(1, Math.floor(remaining * 0.5)),
    );
    blocks.push({
      type: "explain",
      skillId: top.skillId,
      content: `Worked example, step by step: ${topSkill.canDoStatement}`,
      estMinutes: explainMinutes,
    });
    used += explainMinutes;

    // The explain block is capped at half the session, so there is always time
    // left for the learner to walk it back.
    const left = available - used;
    blocks.push({
      type: "check",
      skillId: top.skillId,
      prompt: `Walk through the worked example in your own words: ${topSkill.canDoStatement}`,
      expected: topSkill.canDoStatement,
      isRetrieval: false,
      itemId: null,
      estMinutes: left,
    });
    used += left;

    return { blocks, totalMinutes: used, targetSkillIds, backingOff: true };
  }

  // 2b. The main activity.
  if (isApplySession(input.sessionIndex, input.depth ?? DEFAULT_COURSE_DEPTH)) {
    // §16.1 — "Every 4th session is an `apply` session producing a gradeable
    // artefact. Hard rule, enforced in code — this is what makes mastery move."
    const reflectMinutes = remaining >= 15 ? 5 : 0;
    const applyMinutes = remaining - reflectMinutes;

    blocks.push({
      type: "apply",
      skillId: top.skillId,
      brief: `Produce work that demonstrates: ${topSkill.canDoStatement}`,
      rubricId: null,
      evidenceType: topSkill.area,
      estMinutes: applyMinutes,
    });
    used += applyMinutes;

    if (reflectMinutes > 0) {
      blocks.push({
        type: "reflect",
        prompt: `What was hardest about ${topSkill.name}, and what would you do differently next time?`,
        estMinutes: reflectMinutes,
      });
      used += reflectMinutes;
    }

    return { blocks, totalMinutes: used, targetSkillIds, backingOff: false };
  }

  // 3. A learn session: explain, then check, then practise — with explain
  //    capped at half the *whole* session, per §14.9.2's invariant.
  const explainBudget = Math.floor(available * MAX_EXPLAIN_RATIO);
  const explainMinutes = Math.min(explainBudget, Math.floor(remaining * 0.4));

  if (explainMinutes > 0) {
    blocks.push({
      type: "explain",
      skillId: top.skillId,
      content: `A short lesson on ${topSkill.name}.`,
      estMinutes: explainMinutes,
    });
    used += explainMinutes;
  }

  /*
   * The check, **only when there is a real question to ask.**
   *
   * This block used to be the skill's can-do statement with an instruction in
   * front of it — "From memory, describe how you would do this: X" — sitting
   * directly above an apply block reading "Produce work that demonstrates: X".
   * Two blocks, one task, done twice: write out how you would do the thing,
   * then go and do the thing. The first is not practice for the second, it is
   * the second with the doing taken out, and a learner asked for both rightly
   * called it busywork.
   *
   * So the check earns its place by being a *different* question — one from
   * the item bank, aimed at what they specifically might not know — or it does
   * not appear and its minutes go to the work. Never a rehearsal of the apply.
   *
   * The bank was reachable all along; nothing had ever passed it in.
   */
  const afterExplain = available - used;
  const item = input.items
    ? selectCheckItem(
        input.items,
        top.skillId,
        top.effectiveMastery,
        input.retrievalQueue,
      )
    : undefined;

  if (item) {
    // Explain takes at most 40% of what remains, so a check always fits.
    const checkMinutes = Math.min(
      Math.max(1, Math.round(afterExplain * 0.4)),
      afterExplain,
    );

    blocks.push({
      type: "check",
      skillId: top.skillId,
      prompt: item.prompt,
      expected: item.expected,
      isRetrieval: false,
      itemId: item.itemId,
      // The author's word, carried through untouched. Inferring it from `type`
      // was the first attempt and it is not inferable: the .NET item that
      // asked for "the exact sequence of dotnet CLI commands" is `short_text`.
      answerFormat: item.answerFormat,
      estMinutes: checkMinutes,
    });
    used += checkMinutes;
  }

  const afterCheck = available - used;
  if (afterCheck > 0) {
    blocks.push({
      type: "apply",
      skillId: top.skillId,
      // The same sentence the apply *session* uses for the same act, rather
      // than a second phrasing for "make something that proves it".
      brief: `Produce work that demonstrates: ${topSkill.canDoStatement}`,
      rubricId: null,
      evidenceType: topSkill.area,
      estMinutes: afterCheck,
    });
    used += afterCheck;
  }

  return { blocks, totalMinutes: used, targetSkillIds, backingOff: false };
}

/**
 * The §14.9.2 invariant, exposed so tests (and the planner itself) can assert
 * it rather than trust it.
 */
export function explainRatio(blocks: SessionBlock[]): number {
  const total = blocks.reduce((sum, block) => sum + block.estMinutes, 0);
  if (total === 0) return 0;
  const explain = blocks
    .filter((block) => block.type === "explain")
    .reduce((sum, block) => sum + block.estMinutes, 0);
  return explain / total;
}
