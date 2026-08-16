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

/**
 * How much of a pack a goal is for. Set at intake, changeable afterwards.
 *
 * Depth moves two things: **scope** — which levels count as required — and the
 * **artefact cadence**, because someone in a hurry needs to produce gradeable
 * work sooner, not later.
 *
 * It deliberately does *not* move `MASTERY_TARGET`. Lowering the bar for a
 * sprint would be the obvious way to make a short course finish faster, and it
 * would make two learners' ledgers incomparable — a skill claimed at 0.7 and
 * the same skill claimed at 0.85 would print identically on a Proof Page.
 * §4.2 law 1 is that nothing is claimed without evidence, and evidence that
 * means different things per learner is not evidence. **A sprint claims fewer
 * skills, never weaker ones.**
 */
export const COURSE_DEPTHS = ["sprint", "standard", "mastery"] as const;
export type CourseDepth = (typeof COURSE_DEPTHS)[number];

/** What a goal gets when nobody chose — today's behaviour, unchanged. */
export const DEFAULT_COURSE_DEPTH: CourseDepth = "standard";

/**
 * The levels each depth is *for*, before the hard-prerequisite closure adds
 * back anything they depend on. `mastery` lists every level, so its closure is
 * a no-op and the specialist tail is required rather than optional.
 */
export const DEPTH_LEVELS: Record<CourseDepth, readonly SkillLevel[]> = {
  sprint: ["foundational", "core"],
  standard: ["foundational", "core", "advanced"],
  mastery: ["foundational", "core", "advanced", "specialist"],
};

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

/**
 * One authored question the composer may serve as a check.
 *
 * The item bank existed from the first pack and no session could reach it: a
 * learn session templated its check off the skill's can-do statement and set
 * `itemId: null`, so the only blocks that ever carried a real item were the
 * retrieval ones — and the retrieval queue is written *only* by answering a
 * block that already had an item. A closed loop that could never start. The
 * .NET pack had 69 authored questions and served none of them; a learner was
 * asked to restate the objective instead, and then asked to do the same thing
 * again as the session's `apply`.
 *
 * Flattened from the pack rather than passed as `PackItem` because the engine
 * is pure and knows nothing about pack storage — `expected` is resolved on the
 * way in, by the one function that already knew how (`expectedFor`).
 */
export interface EngineItem {
  itemId: string;
  skillId: string;
  /** The authored kind. `mcq` and `micro_artifact` never reach a check. */
  type: string;
  prompt: string;
  /** What a correct answer establishes — what the grader marks against. */
  expected: string;
  /**
   * How the answer is typed, as the item's author declared it. Not derivable
   * from `type`: "list the exact CLI commands" is `short_text` and all code.
   */
  answerFormat: "prose" | "code";
  /** 0..1, as the diagnostic uses it. */
  difficulty: number;
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
  /**
   * Skill ids the tutor recently heard the learner struggle with — one entry
   * per signal, so a skill named twice counts twice (PLAN-ADAPTATION step 3).
   *
   * Not evidence, and deliberately not shaped like it: these carry no verdict
   * and no tier, because they are a model's reading of a conversation and §7.2
   * puts that at tier 5. They feed `frustrationRisk` and nothing else, so their
   * only possible effect is to make the planner back off sooner.
   */
  stuckSignals?: string[] | undefined;
  retrievalQueue: RetrievalCandidate[];
  /**
   * The pack's item bank. Omitted plans a session with no authored questions in
   * it — which is what every caller did before there was a way to pass them.
   */
  items?: EngineItem[] | undefined;
  constraints: LearnerConstraints;
  /** Sequence number of the session being planned, 1-based (§16.1 step 4). */
  sessionIndex: number;
  /** The goal's depth. Omitted means `standard`, which is §16.1 as written. */
  depth?: CourseDepth | undefined;
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
      /** What a correct answer demonstrates — what a grader marks against. */
      expected: string;
      isRetrieval: boolean;
      /**
       * The item bank entry this recall came from, when it came from one.
       *
       * Beyond §14.9.2's shape, and needed for the loop to close: the runner has
       * to reschedule *the item it served*, not merely the skill, or a learner
       * with two queued items for one skill answers once and both come back.
       */
      itemId: string | null;
      /**
       * How the answer is typed, not what it is about.
       *
       * `code` turns the browser's prose habits off and the monospace on. A
       * learner answering "state the CLI command" into a proof-reading box gets
       * `dotnet new` capitalised and underlined for their trouble. Optional
       * because sessions planned before this field exists have no opinion, and
       * those default to prose.
       */
      answerFormat?: "prose" | "code";
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
