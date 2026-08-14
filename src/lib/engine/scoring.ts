import { clamp, effectiveMastery, retentionDecayFraction } from "./bkt";
import {
  buildIndex,
  distancesToGoal,
  goalCriticality,
  prerequisitesOf,
  type GraphIndex,
} from "./graph";
import type {
  EngineSkill,
  EvalTier,
  MasteryState,
  PlannerInput,
  ScoreComponents,
  ScoredSkill,
  SessionOutcome,
  SkillAttempt,
} from "./types";

/**
 * §16.1 — "What should the learner do next?", v1.
 *
 * Pure deterministic code, ~200 lines as specified. Per §16.3 this beats an LLM
 * planner on every axis that matters here: cost (~$0), latency (<10ms),
 * consistency (perfect), debuggability (inspect the components below) and
 * testability. The LLM is used where novelty actually appears — interpreting a
 * messy artefact, generating content — never for this decision.
 */

/** §16.1 step 2 — the weights, verbatim. */
export const WEIGHTS = {
  goalCriticality: 1.6,
  masteryGap: 1.2,
  prereqReadiness: 1.0,
  retentionUrgency: 1.4,
  momentum: 0.7,
  interleavingBonus: 0.5,
  frustrationRisk: -1.8,
  timeFit: -0.9,
  recentlyFailedTwice: -2.5,
} as const;

/** §16.1 step 1 — eligibility thresholds. */
export const HARD_PREREQ_THRESHOLD = 0.7;
export const MASTERY_TARGET = 0.85;

/** §16.1 step 3 — the deadline override multiplier. */
export const DEADLINE_CRITICALITY_MULTIPLIER = 2.0;

/**
 * What a written answer is worth, and how far it can be trusted.
 *
 * These lived in `session/grade.ts` while a session was the only place a model
 * marked prose. The anonymous Skill Check now does it too, and the engine that
 * applies the observation cannot import a module that pulls in the Anthropic
 * client — so the calibration lives here, beside the other numbers §16 sets,
 * and both graders read it. Two copies of "what is a written answer worth"
 * would drift, and the direction they would drift in is flattering.
 */

/**
 * §7.2, as arithmetic. Tier 1's claim is "verified: this works" and it is
 * earned by executing something; explaining a join in prose is not running one.
 * So a written answer caps at Tier 2 — and a skill whose own domain is weaker
 * keeps its own tier, because evidence cannot be stronger than the domain
 * allows.
 */
export const WRITTEN_ANSWER_TIER = 2;

export function evidenceTierFor(skillTier: EvalTier): EvalTier {
  return Math.max(WRITTEN_ANSWER_TIER, skillTier) as EvalTier;
}

/**
 * §16.2's `c`. A recall question is production, but small production: it moves
 * the belief, and it does not move it as far as an evaluated artefact would.
 */
export const CHECK_CONFIDENCE = 0.45;

/**
 * What a *piece of work* is worth, when a model marked it.
 *
 * Higher than a written answer and deliberately so: a photograph that shows the
 * plane of focus where the learner said they would put it is the thing itself,
 * not a description of it. §7.2 puts tier-3 media review at 0.5–0.7 and this
 * takes the top of that band — the frame is direct evidence, and the reasons to
 * hold back are that the marking is one pass with no verifier and that
 * aesthetics are excluded by design, not that the evidence is weak.
 *
 * It is still not a graded project: that is a rubric, multiple criteria, and a
 * verifier pass (§14.5). This is one question about one control.
 */
export const ARTEFACT_CONFIDENCE = 0.7;

/**
 * Estimated hours still owed on a skill, discounted by how much of it the
 * learner already has.
 *
 * Exported because two different surfaces quote a number of hours — the
 * deadline check below, and the projection shown on the path screen (§8 screen
 * 5, "an honest completion estimate"). Two formulas would eventually disagree
 * in front of the learner, and the one on screen is the one they would believe.
 */
export function remainingHoursFor(
  skill: EngineSkill,
  effective: number,
): number {
  return (
    skill.estimatedHours * (clamp(MASTERY_TARGET - effective) / MASTERY_TARGET)
  );
}

/** How many recent sessions the momentum and interleaving terms consider. */
export const MOMENTUM_WINDOW = 2;

export interface EligibilityContext {
  index: GraphIndex;
  distances: Map<string, number>;
  masteryById: Map<string, MasteryState>;
  effectiveById: Map<string, number>;
  attemptsBySkill: Map<string, SkillAttempt[]>;
  skillsById: Map<string, EngineSkill>;
  recentSessions: SessionOutcome[];
  now: string;
}

export function buildContext(input: PlannerInput): EligibilityContext {
  const index = buildIndex(input.graph);
  const masteryById = new Map(input.mastery.map((m) => [m.skillId, m]));
  const skillsById = new Map(input.graph.skills.map((s) => [s.id, s]));

  const effectiveById = new Map<string, number>();
  for (const skill of input.graph.skills) {
    const state = masteryById.get(skill.id);
    effectiveById.set(
      skill.id,
      state ? effectiveMastery(state, input.now) : 0,
    );
  }

  // Attempts are grouped per skill and sorted oldest-first so "the last two
  // attempts" is unambiguous regardless of the order the caller supplied.
  const attemptsBySkill = new Map<string, SkillAttempt[]>();
  for (const attempt of input.attempts) {
    const list = attemptsBySkill.get(attempt.skillId) ?? [];
    list.push(attempt);
    attemptsBySkill.set(attempt.skillId, list);
  }
  for (const list of attemptsBySkill.values()) {
    list.sort((a, b) => a.at.localeCompare(b.at));
  }

  const recentSessions = [...input.history]
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, MOMENTUM_WINDOW);

  return {
    index,
    distances: distancesToGoal(index, input.goalSkillIds),
    masteryById,
    effectiveById,
    attemptsBySkill,
    skillsById,
    recentSessions,
    now: input.now,
  };
}

/**
 * §16.1 step 1 — keep skills where every hard prerequisite is at mastery ≥ 0.7,
 * own mastery is below 0.85, and the skill is on a path to a goal-required skill.
 */
export function isEligible(
  ctx: EligibilityContext,
  skillId: string,
): boolean {
  if (!ctx.distances.has(skillId)) return false;

  const own = ctx.effectiveById.get(skillId)!;
  if (own >= MASTERY_TARGET) return false;

  for (const edge of prerequisitesOf(ctx.index, skillId, "hard")) {
    const prereqMastery = ctx.effectiveById.get(edge.fromSkillId)!;
    if (prereqMastery < HARD_PREREQ_THRESHOLD) return false;
  }

  return true;
}

function masteryGap(ctx: EligibilityContext, skillId: string): number {
  // "(0.85 - mastery), clipped at 0"
  return clamp(MASTERY_TARGET - ctx.effectiveById.get(skillId)!);
}

/** Mean mastery of the *soft* prereqs — how ready the ground is, not a gate. */
function prereqReadiness(ctx: EligibilityContext, skillId: string): number {
  const soft = prerequisitesOf(ctx.index, skillId, "soft");
  if (soft.length === 0) return 1;
  const total = soft.reduce(
    (sum, edge) => sum + ctx.effectiveById.get(edge.fromSkillId)!,
    0,
  );
  return clamp(total / soft.length);
}

/** Decay-driven: the share of retention already lost since the last success. */
function retentionUrgency(ctx: EligibilityContext, skillId: string): number {
  const state = ctx.masteryById.get(skillId);
  if (!state) return 0;
  return retentionDecayFraction(state, ctx.now);
}

/** Continuity with the last two sessions — most recent counts for more. */
function momentum(ctx: EligibilityContext, skillId: string): number {
  let score = 0;
  ctx.recentSessions.forEach((session, position) => {
    if (session.skillIds.includes(skillId)) {
      score += position === 0 ? 1 : 0.5;
    }
  });
  return clamp(score);
}

/**
 * §16.4 — rewards switching skill *area*, not topic. A skill in an area the
 * last session did not touch gets the bonus; one that repeats the area does not.
 */
function interleavingBonus(ctx: EligibilityContext, skillId: string): number {
  const lastSession = ctx.recentSessions[0];
  if (!lastSession) return 0;
  const area = ctx.skillsById.get(skillId)?.area;
  if (area === undefined) return 0;
  return lastSession.areas.includes(area) ? 0 : 1;
}

/**
 * Recent failures on the skill or its prerequisites. Grinding a learner against
 * something they keep failing is the fastest way to lose them (§16.4's
 * desirable-difficulty target is a 75–85% success rate, not 40%).
 */
function frustrationRisk(ctx: EligibilityContext, skillId: string): number {
  const own = ctx.attemptsBySkill.get(skillId) ?? [];
  const prereqIds = prerequisitesOf(ctx.index, skillId).map(
    (edge) => edge.fromSkillId,
  );
  const prereqAttempts = prereqIds.flatMap(
    (id) => ctx.attemptsBySkill.get(id) ?? [],
  );

  const considered = [...own.slice(-3), ...prereqAttempts.slice(-3)];
  if (considered.length === 0) return 0;

  const failures = considered.filter((a) => !a.succeeded).length;
  return clamp(failures / considered.length);
}

/**
 * How badly the skill's natural block length fits the time available today.
 * A 90-minute skill on a 20-minute evening is a bad recommendation even if it
 * is the most important one.
 */
function timeFit(
  ctx: EligibilityContext,
  skillId: string,
  availableMinutes: number,
): number {
  if (availableMinutes <= 0) return 1;
  const skill = ctx.skillsById.get(skillId);
  if (!skill) return 1;
  // A skill is normally met over several sessions; one block is a fraction of
  // its total estimated hours, floored so tiny skills don't score as perfect.
  const blockMinutes = Math.max(10, (skill.estimatedHours * 60) / 3);
  return clamp(Math.abs(blockMinutes - availableMinutes) / availableMinutes);
}

/** The hard damper: back off, don't grind (§16.1). */
function recentlyFailedTwice(
  ctx: EligibilityContext,
  skillId: string,
): number {
  const attempts = ctx.attemptsBySkill.get(skillId) ?? [];
  if (attempts.length < 2) return 0;
  const lastTwo = attempts.slice(-2);
  return lastTwo.every((a) => !a.succeeded) ? 1 : 0;
}

export function scoreComponents(
  ctx: EligibilityContext,
  skillId: string,
  availableMinutes: number,
  criticalityMultiplier = 1,
): ScoreComponents {
  return {
    goalCriticality: clamp(
      goalCriticality(ctx.distances, skillId) * criticalityMultiplier,
    ),
    masteryGap: masteryGap(ctx, skillId),
    prereqReadiness: prereqReadiness(ctx, skillId),
    retentionUrgency: retentionUrgency(ctx, skillId),
    momentum: momentum(ctx, skillId),
    interleavingBonus: interleavingBonus(ctx, skillId),
    frustrationRisk: frustrationRisk(ctx, skillId),
    timeFit: timeFit(ctx, skillId, availableMinutes),
    recentlyFailedTwice: recentlyFailedTwice(ctx, skillId),
  };
}

export function totalScore(components: ScoreComponents): number {
  const raw =
    WEIGHTS.goalCriticality * components.goalCriticality +
    WEIGHTS.masteryGap * components.masteryGap +
    WEIGHTS.prereqReadiness * components.prereqReadiness +
    WEIGHTS.retentionUrgency * components.retentionUrgency +
    WEIGHTS.momentum * components.momentum +
    WEIGHTS.interleavingBonus * components.interleavingBonus +
    WEIGHTS.frustrationRisk * components.frustrationRisk +
    WEIGHTS.timeFit * components.timeFit +
    WEIGHTS.recentlyFailedTwice * components.recentlyFailedTwice;

  // Round to 6dp so the same inputs serialise identically across platforms —
  // float noise in the 15th decimal would otherwise break snapshot equality.
  return Math.round(raw * 1e6) / 1e6;
}

export interface RankResult {
  ranked: ScoredSkill[];
  compressionApplied: boolean;
  droppedSkillIds: string[];
}

/**
 * §16.1 steps 1–3: filter, score, and apply the deadline override.
 *
 * Ties break on skill id so the output is byte-identical on repeat runs — the
 * plan makes determinism an acceptance criterion, not an aspiration.
 */
export function rankSkills(input: PlannerInput): RankResult {
  const ctx = buildContext(input);

  const eligible = input.graph.skills
    .map((s) => s.id)
    .filter((id) => isEligible(ctx, id))
    .sort();

  const behindSchedule = isBehindSchedule(input, ctx, eligible);
  const multiplier = behindSchedule ? DEADLINE_CRITICALITY_MULTIPLIER : 1;

  // Step 3 — when compressed, non-essential skills leave eligibility entirely.
  const essential = new Set(
    behindSchedule
      ? eligible.filter((id) => ctx.distances.get(id) === 0)
      : eligible,
  );
  const dropped = behindSchedule
    ? eligible.filter((id) => !essential.has(id))
    : [];

  const ranked = eligible
    .filter((id) => essential.has(id))
    .map((skillId) => {
      const components = scoreComponents(
        ctx,
        skillId,
        input.constraints.availableMinutes,
        multiplier,
      );
      return {
        skillId,
        score: totalScore(components),
        components,
        effectiveMastery: ctx.effectiveById.get(skillId)!,
      };
    })
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : a.skillId.localeCompare(b.skillId),
    );

  return {
    ranked,
    compressionApplied: behindSchedule,
    droppedSkillIds: dropped,
  };
}

/**
 * §16.1 step 3 — projected completion vs the deadline. Remaining work is the
 * estimated hours still owed on every eligible skill, weighted by how much of
 * each is left; capacity is the learner's weekly hours until the deadline.
 */
export function isBehindSchedule(
  input: PlannerInput,
  ctx: EligibilityContext,
  eligibleIds: string[],
): boolean {
  const { deadline, weeklyHours } = input.constraints;
  if (!deadline || weeklyHours <= 0) return false;

  const weeksAvailable =
    (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(input.now)) /
    (7 * 86_400_000);
  if (Number.isNaN(weeksAvailable)) return false;
  if (weeksAvailable <= 0) return true;

  const remainingHours = eligibleIds.reduce((sum, id) => {
    const skill = ctx.skillsById.get(id);
    if (!skill) return sum;
    return sum + remainingHoursFor(skill, ctx.effectiveById.get(id)!);
  }, 0);

  return remainingHours > weeksAvailable * weeklyHours;
}
