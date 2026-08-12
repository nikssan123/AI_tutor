import type {
  BktPriors,
  EngineDependency,
  EngineSkill,
  EngineSkillGraph,
  LearnerConstraints,
  MasteryState,
  PlannerInput,
  RetrievalCandidate,
  SessionOutcome,
  SkillAttempt,
} from "@/lib/engine/types";

/**
 * Fixture builders shared by the engine tests.
 *
 * Deliberately explicit rather than random: §24 E5 requires byte-identical
 * planner output on repeat runs, so a generator with any hidden entropy would
 * undermine the very property under test.
 */

export const DEFAULT_PRIORS: BktPriors = {
  pInit: 0.15,
  pLearn: 0.15,
  pSlip: 0.1,
  pGuess: 0.2,
};

export function skill(
  id: string,
  overrides: Partial<EngineSkill> = {},
): EngineSkill {
  return {
    id,
    slug: id,
    name: `Skill ${id}`,
    level: "core",
    evalTier: 1,
    estimatedHours: 2,
    bktPriors: DEFAULT_PRIORS,
    canDoStatement: `do the thing behind ${id}`,
    area: "general",
    ...overrides,
  };
}

export function dependency(
  fromSkillId: string,
  toSkillId: string,
  type: EngineDependency["type"] = "hard",
  strength = 1,
): EngineDependency {
  return { fromSkillId, toSkillId, type, strength };
}

export function graph(
  skills: EngineSkill[],
  dependencies: EngineDependency[] = [],
): EngineSkillGraph {
  return { skills, dependencies };
}

export function mastery(
  skillId: string,
  overrides: Partial<MasteryState> = {},
): MasteryState {
  return {
    skillId,
    mastery: 0,
    confidence: 0.2,
    evidenceCount: 0,
    lastSuccessAt: null,
    lastPracticedAt: null,
    decayHalfLifeDays: 7,
    ...overrides,
  };
}

export function attempt(
  skillId: string,
  at: string,
  succeeded: boolean,
  evidenceTier: SkillAttempt["evidenceTier"] = 1,
): SkillAttempt {
  return { skillId, at, succeeded, evidenceTier };
}

export function session(
  completedAt: string,
  skillIds: string[],
  areas: string[],
  producedArtifact = false,
): SessionOutcome {
  return { completedAt, skillIds, areas, producedArtifact };
}

export function retrieval(
  skillId: string,
  itemId: string,
  dueAt: string,
  estMinutes = 2,
): RetrievalCandidate {
  return { skillId, itemId, dueAt, estMinutes };
}

export function constraints(
  overrides: Partial<LearnerConstraints> = {},
): LearnerConstraints {
  return {
    availableMinutes: 30,
    weeklyHours: 3,
    deadline: null,
    ...overrides,
  };
}

export function plannerInput(
  overrides: Partial<PlannerInput> = {},
): PlannerInput {
  return {
    now: "2026-08-12T09:00:00.000Z",
    goalId: "goal-1",
    graph: graph([skill("a")]),
    goalSkillIds: ["a"],
    mastery: [],
    history: [],
    attempts: [],
    retrievalQueue: [],
    constraints: constraints(),
    sessionIndex: 1,
    ...overrides,
  };
}
