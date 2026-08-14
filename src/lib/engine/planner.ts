import { rankSkills } from "./scoring";
import {
  composeSession,
  isApplySession,
  selectRetrievalItems,
} from "./session-composer";
import { buildCompressionMessage, buildReason } from "./reason";
import { DEFAULT_COURSE_DEPTH } from "./types";
import type { EngineSkill, PlannedSession, PlannerInput } from "./types";

/**
 * §16.1 — the planner. Pure deterministic code, no LLM call anywhere in this
 * path, per §14.9.1: "the loop is closed by code, not by a model."
 *
 * Determinism is an acceptance criterion (§24 E5), so three things hold here:
 * `now` is injected rather than read from the clock, nothing is random, and
 * every ordering has an explicit tiebreak.
 */
export function plan(input: PlannerInput): PlannedSession {
  const { ranked, compressionApplied, droppedSkillIds } = rankSkills(input);

  const skillsById = new Map<string, EngineSkill>(
    input.graph.skills.map((s) => [s.id, s]),
  );

  const depth = input.depth ?? DEFAULT_COURSE_DEPTH;

  const composed = composeSession({
    sessionIndex: input.sessionIndex,
    availableMinutes: input.constraints.availableMinutes,
    ranked,
    skillsById,
    retrievalQueue: input.retrievalQueue,
    now: input.now,
    depth,
  });

  const retrievalCount = selectRetrievalItems(
    input.retrievalQueue,
    input.now,
  ).length;

  const top = ranked[0];
  const topSkill = top ? skillsById.get(top.skillId) : undefined;

  const reason =
    top && topSkill
      ? buildReason({
          top,
          skill: topSkill,
          minutes: composed.totalMinutes,
          isApplySession: isApplySession(input.sessionIndex, depth),
          backingOff: composed.backingOff,
          retrievalCount: Math.min(
            retrievalCount,
            composed.blocks.filter(
              (b) => b.type === "check" && b.isRetrieval,
            ).length,
          ),
        })
      : "Nothing is unlocked right now — every skill on your path is either mastered or waiting on a prerequisite.";

  // Compression can only fire when a deadline exists — isBehindSchedule
  // returns false without one — so the deadline is non-null here by
  // construction rather than by a fallback string nobody would ever see.
  const deadline = input.constraints.deadline;
  const compression =
    compressionApplied && deadline
      ? {
          applied: true,
          droppedSkillIds,
          message: buildCompressionMessage(
            droppedSkillIds
              .map((id) => skillsById.get(id))
              .filter((s): s is EngineSkill => s !== undefined),
            deadline,
          ),
        }
      : null;

  return {
    goalId: input.goalId,
    plannedFor: input.now.slice(0, 10),
    sessionIndex: input.sessionIndex,
    blocks: composed.blocks,
    totalMinutes: composed.totalMinutes,
    targetSkillIds: composed.targetSkillIds,
    backingOff: composed.backingOff,
    reason,
    compression,
    ranked,
  };
}

/**
 * Canonical serialisation with sorted keys.
 *
 * §14.3's cache discipline requires deterministic JSON, and §24 E5 requires
 * byte-identical planner output on repeat runs. One function serves both, so
 * there is no second implementation to drift.
 */
export function serialisePlan(session: PlannedSession): string {
  return stableStringify(session);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  const result: Record<string, unknown> = {};
  for (const [key, nested] of entries) {
    result[key] = sortKeys(nested);
  }
  return result;
}
