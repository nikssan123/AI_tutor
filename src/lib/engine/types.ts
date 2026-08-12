/**
 * Types for the learning engine (§16).
 *
 * The engine is deliberately decoupled from the database and from Domain Packs:
 * it takes plain data in and returns plain data out. That is what makes it
 * unit-testable against 20 hand-written scenarios with no I/O, and what lets
 * §14.1's organising principle hold — deterministic planner, LLM sensors and
 * actuators, with the decision itself in code.
 */

/** §7.2 — evaluation-capability tier. Tier 5 can never raise mastery. */
export type EvalTier = 1 | 2 | 3 | 4 | 5;

export type SkillLevel = "foundational" | "core" | "advanced" | "specialist";

export type DependencyType = "hard" | "soft";

/** §16.2 — four parameters per skill, expert-seeded, refit from data later. */
export interface BktPriors {
  /** Probability the learner already knows the skill before any evidence. */
  pInit: number;
  /** Probability of transitioning from not-known to known per opportunity. */
  pLearn: number;
  /** Probability of answering incorrectly despite knowing the skill. */
  pSlip: number;
  /** Probability of answering correctly without knowing the skill. */
  pGuess: number;
}

export interface EngineSkill {
  id: string;
  slug: string;
  name: string;
  level: SkillLevel;
  evalTier: EvalTier;
  estimatedHours: number;
  bktPriors: BktPriors;
  /** "Write a SQL query joining 3 tables with correct grain" — §14.4 */
  canDoStatement: string;
  /**
   * The skill *area*, not the topic. §16.4's interleaving rule rewards
   * switching area between sessions, so this is what the bonus keys off.
   */
  area: string;
}

/**
 * §14.4 — `from` is the prerequisite, `to` is the skill that depends on it.
 * To find what a skill requires, filter on `toSkillId`.
 */
export interface EngineDependency {
  fromSkillId: string;
  toSkillId: string;
  type: DependencyType;
  /** 0..1 — how strongly the dependency binds. Only `soft` edges use this. */
  strength: number;
}

export interface EngineSkillGraph {
  skills: EngineSkill[];
  dependencies: EngineDependency[];
}

export interface MasteryState {
  skillId: string;
  /** The stored belief, 0..1. Read `effectiveMastery` for the decayed value. */
  mastery: number;
  confidence: number;
  evidenceCount: number;
  /** ISO-8601. Null when the skill has never produced a successful observation. */
  lastSuccessAt: string | null;
  lastPracticedAt: string | null;
  /** Starts at 7 days, doubles per successful spaced retrieval, capped at 180. */
  decayHalfLifeDays: number;
}

/** One completed session, newest first in `SessionHistory`. */
export interface SessionOutcome {
  /** ISO-8601. */
  completedAt: string;
  /** Skills the session targeted, in composition order. */
  skillIds: string[];
  /** Areas touched — used by the interleaving bonus. */
  areas: string[];
  /** Whether the session produced a gradeable artefact (§16.1 step 4). */
  producedArtifact: boolean;
}

/** An observation on a single skill, newest last. */
export interface SkillAttempt {
  skillId: string;
  /** ISO-8601. */
  at: string;
  succeeded: boolean;
  /** §7.2 — which tier of evidence this came from. */
  evidenceTier: EvalTier;
}

export interface RetrievalCandidate {
  skillId: string;
  itemId: string;
  /** ISO-8601 — when this item became (or becomes) due. */
  dueAt: string;
  estMinutes: number;
}

export interface LearnerConstraints {
  /** Minutes available for today's session. */
  availableMinutes: number;
  weeklyHours: number;
  /** ISO date (YYYY-MM-DD), or null when the goal has no deadline. */
  deadline: string | null;
}

export interface PlannerInput {
  /** ISO-8601. Injected, never read from the clock — determinism (§24 E5). */
  now: string;
  goalId: string;
  graph: EngineSkillGraph;
  /** Skills the goal actually requires. Everything else is optional scaffolding. */
  goalSkillIds: string[];
  mastery: MasteryState[];
  /** Newest first. Only the most recent few are read. */
  history: SessionOutcome[];
  /** All attempts the planner should consider, any order. */
  attempts: SkillAttempt[];
  retrievalQueue: RetrievalCandidate[];
  constraints: LearnerConstraints;
  /** Sequence number of the session being planned, 1-based (§16.1 step 4). */
  sessionIndex: number;
}

/** §14.9.2 — SessionBlock, as a discriminated union. */
export type SessionBlock =
  | {
      type: "explain";
      skillId: string;
      content: string;
      estMinutes: number;
    }
  | {
      type: "check";
      skillId: string;
      prompt: string;
      expected: string;
      isRetrieval: boolean;
      estMinutes: number;
    }
  | {
      type: "apply";
      skillId: string;
      brief: string;
      rubricId: string | null;
      evidenceType: string;
      estMinutes: number;
    }
  | {
      type: "review";
      submissionId: string;
      focus: string;
      estMinutes: number;
    }
  | { type: "reflect"; prompt: string; estMinutes: number };

/** The nine components of §16.1's score, kept so `reason` can be truthful. */
export interface ScoreComponents {
  goalCriticality: number;
  masteryGap: number;
  prereqReadiness: number;
  retentionUrgency: number;
  momentum: number;
  interleavingBonus: number;
  frustrationRisk: number;
  timeFit: number;
  recentlyFailedTwice: number;
}

export interface ScoredSkill {
  skillId: string;
  score: number;
  components: ScoreComponents;
  effectiveMastery: number;
}

export interface PlannedSession {
  goalId: string;
  /** ISO date (YYYY-MM-DD) the session is planned for. */
  plannedFor: string;
  sessionIndex: number;
  blocks: SessionBlock[];
  totalMinutes: number;
  /** Skills this session targets, in composition order. */
  targetSkillIds: string[];
  /**
   * §16.1's damper actually firing: the learner has failed this skill twice
   * running and nothing better was available, so the session consolidates with
   * a worked example and asks for no artefact.
   */
  backingOff: boolean;
  /** Template-filled from the score components. Never LLM-generated (§16.1). */
  reason: string;
  /** Present only when the deadline override fired (§16.1 step 3). */
  compression: {
    applied: boolean;
    droppedSkillIds: string[];
    message: string;
  } | null;
  /** Ranked eligible skills, for debugging and for /today's explanation. */
  ranked: ScoredSkill[];
}
