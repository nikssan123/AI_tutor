import type {
  EngineItem,
  EngineSkillGraph,
  MasteryState,
  PlannerInput,
} from "@/lib/engine/types";
import {
  attempt,
  constraints,
  dependency,
  graph,
  mastery,
  retrieval,
  session,
  skill,
} from "../support";

/**
 * The 20 hand-written learner scenarios from §24 E5's acceptance criteria.
 *
 * Written as typed TypeScript rather than raw JSON so the compiler catches
 * drift the moment `PlannerInput` changes — a fixture that silently stops
 * matching the shape it is meant to exercise is worse than no fixture. The
 * *outputs* are snapshotted to disk, which is where the regression signal lives.
 */

const NOW = "2026-08-12T09:00:00.000Z";

/** A small SQL-flavoured graph, close enough to the real pack to be meaningful. */
export const SQL_GRAPH: EngineSkillGraph = graph(
  [
    skill("select-basics", {
      name: "SELECT and filtering",
      area: "foundations",
      level: "foundational",
      estimatedHours: 1.5,
    }),
    skill("aggregation", {
      name: "GROUP BY and aggregation",
      area: "foundations",
      level: "core",
      estimatedHours: 2,
    }),
    skill("join-grain", {
      name: "Join grain",
      area: "querying",
      level: "core",
      estimatedHours: 3,
    }),
    skill("subqueries", {
      name: "Subqueries and CTEs",
      area: "querying",
      level: "core",
      estimatedHours: 2.5,
    }),
    skill("window-functions", {
      name: "Window functions",
      area: "analytics",
      level: "advanced",
      estimatedHours: 4,
    }),
    skill("query-tuning", {
      name: "Query tuning",
      area: "performance",
      level: "advanced",
      estimatedHours: 5,
      evalTier: 1,
    }),
    skill("data-modelling", {
      name: "Dimensional modelling",
      area: "modelling",
      level: "specialist",
      estimatedHours: 6,
    }),
  ],
  [
    dependency("select-basics", "aggregation"),
    dependency("select-basics", "join-grain"),
    dependency("aggregation", "window-functions"),
    dependency("join-grain", "window-functions"),
    dependency("join-grain", "subqueries", "soft", 0.6),
    dependency("window-functions", "query-tuning", "soft", 0.4),
    dependency("join-grain", "query-tuning"),
    dependency("join-grain", "data-modelling"),
  ],
);

const GOAL_SKILLS = ["window-functions", "query-tuning"];

/**
 * An item bank for that graph — three questions per skill, at spread
 * difficulties, the way an authored pack has them.
 *
 * Every scenario gets these because production always has them: `todayFor`
 * passes `toEngineItems(pack)` on every plan. Without them the fixtures were
 * exercising a branch no learner is on, and snapshotting the result as if it
 * were the product — which is how a session came to ask somebody to describe
 * a task and then perform the same task, for six months, unnoticed.
 */
export const SQL_ITEMS: EngineItem[] = SQL_GRAPH.skills.flatMap((s) => [
  {
    itemId: `${s.id}-recall`,
    skillId: s.id,
    type: "short_text",
    prompt: `What decides the answer when you ${s.canDoStatement}?`,
    expected: `names what decides it for ${s.id}`,
    answerFormat: "prose",
    difficulty: 0.3,
  },
  {
    itemId: `${s.id}-read`,
    skillId: s.id,
    type: "code_read",
    prompt: `Read this and say what it returns — ${s.name}.`,
    expected: `reads the ${s.id} example correctly`,
    // A code_read question whose *answer* is a sentence — the case that shows
    // why the format is authored rather than inferred from the type.
    answerFormat: "prose",
    difficulty: 0.55,
  },
  {
    itemId: `${s.id}-explain`,
    skillId: s.id,
    type: "explain",
    prompt: `Why does ${s.name} behave that way at the edges?`,
    expected: `explains the ${s.id} edge case`,
    answerFormat: "prose",
    difficulty: 0.8,
  },
]);

/** Every foundational skill demonstrated recently and solidly. */
function foundationsSolid(at = "2026-08-11T09:00:00.000Z"): MasteryState[] {
  return [
    mastery("select-basics", {
      mastery: 0.9,
      confidence: 0.9,
      evidenceCount: 5,
      lastSuccessAt: at,
      lastPracticedAt: at,
      decayHalfLifeDays: 28,
    }),
    mastery("aggregation", {
      mastery: 0.88,
      confidence: 0.85,
      evidenceCount: 4,
      lastSuccessAt: at,
      lastPracticedAt: at,
      decayHalfLifeDays: 28,
    }),
    mastery("join-grain", {
      mastery: 0.86,
      confidence: 0.8,
      evidenceCount: 4,
      lastSuccessAt: at,
      lastPracticedAt: at,
      decayHalfLifeDays: 14,
    }),
  ];
}

function base(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    now: NOW,
    goalId: "goal-sql",
    graph: SQL_GRAPH,
    goalSkillIds: GOAL_SKILLS,
    mastery: [],
    history: [],
    attempts: [],
    retrievalQueue: [],
    items: SQL_ITEMS,
    constraints: constraints({ availableMinutes: 30, weeklyHours: 4 }),
    sessionIndex: 1,
    ...overrides,
  };
}

export interface Scenario {
  name: string;
  /** What this scenario is actually testing, in one line. */
  intent: string;
  input: PlannerInput;
}

export const SCENARIOS: Scenario[] = [
  {
    name: "01-fresh-beginner",
    intent:
      "No history at all: only the unblocked foundational skill should be reachable.",
    input: base(),
  },
  {
    name: "02-expert-with-one-gap",
    intent:
      "Everything mastered except window functions — the plan must go straight there, not restart at basics.",
    input: base({
      mastery: [
        ...foundationsSolid(),
        mastery("subqueries", {
          mastery: 0.9,
          evidenceCount: 4,
          lastSuccessAt: "2026-08-11T09:00:00.000Z",
          decayHalfLifeDays: 28,
        }),
        mastery("window-functions", {
          mastery: 0.2,
          evidenceCount: 1,
          lastSuccessAt: "2026-08-01T09:00:00.000Z",
        }),
      ],
    }),
  },
  {
    name: "03-returning-after-three-weeks",
    intent:
      "Mastery was high three weeks ago; decay should re-open skills and drive retention urgency.",
    input: base({
      now: "2026-09-02T09:00:00.000Z",
      mastery: foundationsSolid("2026-08-11T09:00:00.000Z"),
      history: [
        session("2026-08-11T09:00:00.000Z", ["join-grain"], ["querying"]),
      ],
      retrievalQueue: [
        retrieval("select-basics", "r-basics", "2026-08-18T09:00:00.000Z", 2),
        retrieval("aggregation", "r-agg", "2026-08-20T09:00:00.000Z", 2),
      ],
    }),
  },
  {
    name: "04-repeatedly-failing-one-skill",
    intent:
      "Two failures running on join grain must trigger the hard damper and move the learner elsewhere.",
    input: base({
      mastery: [
        ...foundationsSolid(),
        mastery("join-grain", {
          mastery: 0.72,
          evidenceCount: 6,
          lastSuccessAt: "2026-08-05T09:00:00.000Z",
        }),
      ],
      attempts: [
        attempt("join-grain", "2026-08-10T09:00:00.000Z", false),
        attempt("join-grain", "2026-08-11T09:00:00.000Z", false),
      ],
    }),
  },
  {
    name: "05-hard-deadline-compressed",
    intent:
      "Deadline unreachable at current pace: compression must fire and say what was cut.",
    input: base({
      mastery: foundationsSolid(),
      constraints: constraints({
        availableMinutes: 30,
        weeklyHours: 2,
        deadline: "2026-08-26",
      }),
    }),
  },
  {
    name: "06-one-hour-per-week",
    intent: "A 20-minute slot: time fit should dominate block sizing.",
    input: base({
      mastery: foundationsSolid(),
      constraints: constraints({ availableMinutes: 20, weeklyHours: 1 }),
    }),
  },
  {
    name: "07-twenty-hours-per-week",
    intent: "A 90-minute slot: the session must still respect the explain cap.",
    input: base({
      mastery: foundationsSolid(),
      constraints: constraints({ availableMinutes: 90, weeklyHours: 20 }),
    }),
  },
  {
    name: "08-tier-5-observations-only",
    intent:
      "A learner whose only evidence is self-reported: mastery stays at the prior, so the plan is a beginner's.",
    input: base({
      attempts: [
        attempt("select-basics", "2026-08-10T09:00:00.000Z", true, 5),
        attempt("select-basics", "2026-08-11T09:00:00.000Z", true, 5),
      ],
      mastery: [mastery("select-basics", { mastery: 0.15 })],
    }),
  },
  {
    name: "09-apply-session",
    intent:
      "Session 4 must produce a gradeable artefact — the rule that makes mastery move.",
    input: base({
      sessionIndex: 4,
      mastery: foundationsSolid(),
      constraints: constraints({ availableMinutes: 45, weeklyHours: 4 }),
    }),
  },
  {
    name: "10-everything-mastered",
    intent:
      "Nothing left to teach: the planner must say so honestly rather than invent work.",
    input: base({
      mastery: SQL_GRAPH.skills.map((s) =>
        mastery(s.id, {
          mastery: 0.95,
          evidenceCount: 6,
          lastSuccessAt: "2026-08-11T09:00:00.000Z",
          decayHalfLifeDays: 180,
        }),
      ),
    }),
  },
  {
    name: "11-blocked-by-prerequisite",
    intent:
      "Foundations half-learned: advanced skills must stay locked behind the 0.7 gate.",
    input: base({
      mastery: [
        mastery("select-basics", {
          mastery: 0.5,
          evidenceCount: 2,
          lastSuccessAt: "2026-08-11T09:00:00.000Z",
        }),
      ],
    }),
  },
  {
    name: "12-empty-retrieval-queue",
    intent:
      "No items due: the session opens with new material rather than fabricating recall.",
    input: base({ mastery: foundationsSolid(), retrievalQueue: [] }),
  },
  {
    name: "13-overdue-retrieval-heavy",
    intent:
      "Eight overdue items: the opening must be capped at four items and eight minutes.",
    input: base({
      mastery: foundationsSolid(),
      retrievalQueue: Array.from({ length: 8 }, (_, i) =>
        retrieval(
          "select-basics",
          `r-${String(i).padStart(2, "0")}`,
          `2026-08-0${(i % 8) + 1}T09:00:00.000Z`,
          2,
        ),
      ),
    }),
  },
  {
    name: "14-short-session",
    intent: "A 15-minute session must still fit retrieval plus something useful.",
    input: base({
      mastery: foundationsSolid(),
      constraints: constraints({ availableMinutes: 15, weeklyHours: 2 }),
      retrievalQueue: [
        retrieval("select-basics", "r-a", "2026-08-01T09:00:00.000Z", 2),
        retrieval("aggregation", "r-b", "2026-08-02T09:00:00.000Z", 2),
      ],
    }),
  },
  {
    name: "15-long-session",
    intent:
      "A 120-minute session must not become a lecture — the explain cap holds at any length.",
    input: base({
      mastery: foundationsSolid(),
      constraints: constraints({ availableMinutes: 120, weeklyHours: 20 }),
    }),
  },
  {
    name: "16-momentum-continuation",
    intent:
      "Yesterday's skill should carry momentum without overriding a stronger claim.",
    input: base({
      mastery: foundationsSolid(),
      history: [
        session("2026-08-11T09:00:00.000Z", ["window-functions"], ["analytics"]),
        session("2026-08-10T09:00:00.000Z", ["join-grain"], ["querying"]),
      ],
    }),
  },
  {
    name: "17-interleaving-switch",
    intent:
      "After a session in `analytics`, a skill from another area gets the interleaving bonus.",
    input: base({
      mastery: foundationsSolid(),
      history: [
        session("2026-08-11T09:00:00.000Z", ["window-functions"], ["analytics"]),
      ],
    }),
  },
  {
    name: "18-deadline-already-passed",
    intent:
      "A deadline in the past is maximally behind schedule; compression fires immediately.",
    input: base({
      mastery: foundationsSolid(),
      constraints: constraints({
        availableMinutes: 30,
        weeklyHours: 10,
        deadline: "2026-07-01",
      }),
    }),
  },
  {
    name: "19-goal-unreachable",
    intent:
      "A goal skill that is not in the graph leaves nothing eligible — say so, don't guess.",
    input: base({ goalSkillIds: ["not-in-this-pack"] }),
  },
  {
    name: "20-wide-graph",
    intent:
      "A 25-skill graph — the size the plan expects a Curated pack to be — still plans in under 50ms.",
    input: base({
      graph: graph(
        Array.from({ length: 25 }, (_, i) =>
          skill(`s${String(i).padStart(2, "0")}`, {
            name: `Skill ${i}`,
            area: `area-${i % 5}`,
            estimatedHours: 1 + (i % 4),
          }),
        ),
        Array.from({ length: 24 }, (_, i) =>
          dependency(
            `s${String(i).padStart(2, "0")}`,
            `s${String(i + 1).padStart(2, "0")}`,
            i % 3 === 0 ? "soft" : "hard",
            0.5,
          ),
        ),
      ),
      goalSkillIds: ["s24"],
      mastery: Array.from({ length: 25 }, (_, i) =>
        mastery(`s${String(i).padStart(2, "0")}`, {
          mastery: i < 12 ? 0.9 : 0.1,
          evidenceCount: i < 12 ? 3 : 0,
          lastSuccessAt: i < 12 ? "2026-08-11T09:00:00.000Z" : null,
          decayHalfLifeDays: 28,
        }),
      ),
    }),
  },
];
