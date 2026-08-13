import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  canonicalCurriculum,
  MIN_MODULES,
  topologicalOrder,
} from "@/lib/curriculum/canonical";
import { applyRepairs, isRepairable } from "@/lib/curriculum/repair";
import {
  generateValidatedCurriculum,
  MAX_GENERATION_ATTEMPTS,
} from "@/lib/curriculum/generate";
import { runValidator, type SpotChecker } from "@/lib/curriculum/validate";
import { statusFor } from "@/lib/curriculum/store";
import type {
  CurriculumDraft,
  CurriculumModule,
} from "@/lib/contracts/curriculum";
import type {
  EngineSkill,
  EngineSkillGraph,
  MasteryState,
} from "@/lib/engine";

/**
 * §14.6's policy as control flow: generate, validate, repair, and — after two
 * failures — fall back to a path that is built to pass rather than hoping to.
 */

const NOW = "2026-08-13T09:00:00.000Z";
const priors = { pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.25 };

function skill(id: string, level: EngineSkill["level"] = "core"): EngineSkill {
  return {
    id,
    slug: id,
    name: id.toUpperCase(),
    level,
    evalTier: 1,
    estimatedHours: 4,
    bktPriors: priors,
    canDoStatement: `Do ${id}`,
    area: "core",
  };
}

/** alpha → beta → gamma, plus an unrelated delta. */
const GRAPH: EngineSkillGraph = {
  skills: [
    skill("alpha", "foundational"),
    skill("beta", "core"),
    skill("gamma", "advanced"),
    skill("delta", "core"),
  ],
  dependencies: [
    { fromSkillId: "alpha", toSkillId: "beta", type: "hard", strength: 1 },
    { fromSkillId: "beta", toSkillId: "gamma", type: "hard", strength: 1 },
  ],
};

const ALL = ["alpha", "beta", "gamma", "delta"];

const held = (skillId: string, mastery: number): MasteryState => ({
  skillId,
  mastery,
  confidence: 0.8,
  evidenceCount: 3,
  lastSuccessAt: NOW,
  lastPracticedAt: NOW,
  decayHalfLifeDays: 7,
});

function mod(
  order: number,
  targetSkillIds: string[],
  over: Partial<CurriculumModule> = {},
): CurriculumModule {
  return {
    order,
    title: `Module ${order}`,
    targetSkillIds,
    estimatedHours: 4,
    outputArtifact: "exercise",
    acceptanceCriteria: [`Do ${targetSkillIds.join(" and ")}`],
    rubricId: null,
    ...over,
  };
}

const draftOf = (modules: CurriculumModule[]): CurriculumDraft => ({
  modules,
  totalHours: modules.reduce((s, m) => s + m.estimatedHours, 0),
  rationale: "why",
});

const clean: SpotChecker = async () => ({ passed: true, detail: "fine" });

const validate = (draft: CurriculumDraft, mastery: MasteryState[] = []) =>
  runValidator(
    {
      draft,
      graph: GRAPH,
      mastery,
      now: NOW,
      constraints: { weeklyHours: 5, deadline: null },
      rubricCriteria: new Map([["r4", 4]]),
    },
    clean,
  );

/* ── Canonical path ────────────────────────────────────────────────────── */

describe("topologicalOrder", () => {
  it("puts every prerequisite before what needs it", () => {
    const order = topologicalOrder(GRAPH, ALL);
    expect(order.indexOf("alpha")).toBeLessThan(order.indexOf("beta"));
    expect(order.indexOf("beta")).toBeLessThan(order.indexOf("gamma"));
  });

  it("is deterministic regardless of input order", () => {
    expect(topologicalOrder(GRAPH, ALL)).toEqual(
      topologicalOrder(GRAPH, [...ALL].reverse()),
    );
  });

  it("ranks a skill the graph has never heard of as foundational", () => {
    // Reached only through the exported helper — canonicalCurriculum filters
    // unknown ids out first — but a stranger sorts to the front rather than
    // throwing.
    expect(topologicalOrder(GRAPH, ["ghost", "alpha"])).toEqual([
      "alpha",
      "ghost",
    ]);
  });

  it("emits the remainder rather than looping on a cyclic graph", () => {
    // Packs are cycle-checked at build time, so this can only be a graph that
    // never passed validation — but hanging is not an acceptable response.
    const cyclic: EngineSkillGraph = {
      skills: [skill("x"), skill("y")],
      dependencies: [
        { fromSkillId: "x", toSkillId: "y", type: "hard", strength: 1 },
        { fromSkillId: "y", toSkillId: "x", type: "hard", strength: 1 },
      ],
    };
    expect(topologicalOrder(cyclic, ["x", "y"]).sort()).toEqual(["x", "y"]);
  });
});

describe("the canonical fallback", () => {
  const canonical = (over: Parameters<typeof canonicalCurriculum>[0] | null = null) =>
    canonicalCurriculum(
      over ?? {
        graph: GRAPH,
        requiredSkillIds: ALL,
        mastery: [],
        now: NOW,
        rubricCriteria: new Map([["r4", 4]]),
      },
    );

  it("passes its own validator — built to pass, and checked anyway", async () => {
    const draft = canonical()!;
    const report = await validate(draft);
    // Every blocking check, on the path a learner gets when generation failed.
    expect(report.checks.filter((c) => c.severity === "blocking" && !c.passed)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("leaves out what the learner already demonstrated", () => {
    const draft = canonicalCurriculum({
      graph: GRAPH,
      requiredSkillIds: ALL,
      mastery: [held("alpha", 0.95)],
      now: NOW,
      rubricCriteria: new Map(),
    })!;
    expect(draft.modules.flatMap((m) => m.targetSkillIds)).not.toContain("alpha");
  });

  it("appends a project only when its rubric would survive the gate", () => {
    const project = {
      rubricId: "r4",
      title: "Ship it",
      targetSkillIds: ["alpha", "beta"],
      estimatedMinutes: 120,
    };

    const withProject = canonicalCurriculum({
      graph: GRAPH,
      requiredSkillIds: ALL,
      mastery: [],
      now: NOW,
      rubricCriteria: new Map([["r4", 4]]),
      projects: [project],
    })!;
    expect(withProject.modules.at(-1)).toMatchObject({
      outputArtifact: "project",
      rubricId: "r4",
      estimatedHours: 2,
    });

    // A three-criterion rubric fails rubric_coverage, so the project is left
    // out rather than emitted and then flagged.
    const thin = canonicalCurriculum({
      graph: GRAPH,
      requiredSkillIds: ALL,
      mastery: [],
      now: NOW,
      rubricCriteria: new Map([["r4", 3]]),
      projects: [project],
    })!;
    expect(thin.modules.some((m) => m.outputArtifact === "project")).toBe(false);
  });

  it("skips a project the learner is not equipped for", () => {
    const draft = canonicalCurriculum({
      graph: GRAPH,
      requiredSkillIds: ["alpha", "beta", "gamma"],
      mastery: [],
      now: NOW,
      rubricCriteria: new Map([["r4", 4]]),
      projects: [
        {
          rubricId: "r4",
          title: "Needs delta",
          targetSkillIds: ["delta"],
          estimatedMinutes: 60,
        },
      ],
    })!;
    expect(draft.modules.some((m) => m.outputArtifact === "project")).toBe(false);
  });

  it("returns null rather than padding when there is too little to teach", () => {
    // Inventing work to reach the three-module floor would be worse than
    // saying there is no path.
    expect(
      canonicalCurriculum({
        graph: GRAPH,
        requiredSkillIds: ["alpha"],
        mastery: [],
        now: NOW,
        rubricCriteria: new Map(),
      }),
    ).toBeNull();
    expect(MIN_MODULES).toBe(3);
  });

  it("ignores a required skill the graph has never heard of", () => {
    const draft = canonical({
      graph: GRAPH,
      requiredSkillIds: [...ALL, "ghost"],
      mastery: [],
      now: NOW,
      rubricCriteria: new Map(),
    })!;
    expect(draft.modules.flatMap((m) => m.targetSkillIds)).not.toContain("ghost");
  });
});

/* ── Repairs ───────────────────────────────────────────────────────────── */

describe("applyRepairs", () => {
  it("drops what the learner already has, and says so", async () => {
    const draft = draftOf([
      mod(0, ["alpha"]),
      mod(1, ["beta"]),
      mod(2, ["gamma"]),
      mod(3, ["delta"]),
    ]);
    const report = await validate(draft, [held("beta", 0.95)]);
    const { draft: fixed, applied } = applyRepairs(draft, report, GRAPH);

    expect(fixed.modules.flatMap((m) => m.targetSkillIds)).not.toContain("beta");
    // §14.6 — "drop it, and *show* the user it was dropped".
    expect(applied[0]).toContain("already showed");
    expect(applied[0]).toContain("BETA");
  });

  it("renumbers and re-totals after removing a module", async () => {
    const draft = draftOf([
      mod(0, ["alpha"]),
      mod(1, ["beta"]),
      mod(2, ["gamma"]),
      mod(3, ["delta"]),
    ]);
    const report = await validate(draft, [held("beta", 0.95)]);
    const { draft: fixed } = applyRepairs(draft, report, GRAPH);

    expect(fixed.modules.map((m) => m.order)).toEqual([0, 1, 2]);
    expect(fixed.totalHours).toBe(12);
  });

  it("inserts a missing prerequisite before the module that needs it", async () => {
    const draft = draftOf([mod(0, ["beta"]), mod(1, ["gamma"]), mod(2, ["delta"])]);
    const report = await validate(draft);
    const { draft: fixed, applied } = applyRepairs(draft, report, GRAPH);

    const order = fixed.modules.flatMap((m) => m.targetSkillIds);
    expect(order.indexOf("alpha")).toBeLessThan(order.indexOf("beta"));
    expect(applied.some((a) => a.includes("ALPHA"))).toBe(true);

    // And the repaired draft actually passes the check that failed.
    const recheck = await validate(fixed);
    expect(
      recheck.checks.find((c) => c.name === "prereq_completeness")!.passed,
    ).toBe(true);
  });

  it("merges duplicate modules by dropping the later one", async () => {
    const duplicate = mod(2, ["gamma"]);
    const draft = draftOf([
      mod(0, ["alpha"]),
      mod(1, ["beta"]),
      duplicate,
      { ...duplicate, order: 3 },
    ]);
    const report = await validate(draft);
    const { draft: fixed, applied } = applyRepairs(draft, report, GRAPH);

    expect(fixed.modules).toHaveLength(3);
    expect(applied.some((a) => a.includes("duplicate"))).toBe(true);
  });

  it("counts more than one merged duplicate correctly", async () => {
    const dup = mod(1, ["beta"]);
    const draft = draftOf([
      mod(0, ["alpha"]),
      dup,
      { ...dup, order: 2 },
      { ...dup, order: 3 },
    ]);
    const report = await validate(draft);
    const { applied } = applyRepairs(draft, report, GRAPH);
    expect(applied.some((a) => a.includes("2 duplicate modules"))).toBe(true);
  });

  it("cannot insert a prerequisite the graph does not contain", async () => {
    // §14.6's own fail action for that is "regenerate" — there is nothing to
    // splice in, so the repair leaves it for the next attempt.
    const draft = draftOf([mod(0, ["beta"]), mod(1, ["gamma"]), mod(2, ["delta"])]);
    const report = await validate(draft);
    const stripped = {
      ...GRAPH,
      skills: GRAPH.skills.filter((sk) => sk.id !== "alpha"),
    };

    const { draft: fixed, applied } = applyRepairs(draft, report, stripped);
    expect(applied).toEqual([]);
    expect(fixed.modules).toHaveLength(3);
  });

  it("inserts a shared prerequisite once, not once per dependent", async () => {
    const draft = draftOf([
      mod(0, ["beta"]),
      mod(1, ["beta"], { title: "More beta" }),
      mod(2, ["delta"]),
    ]);
    const report = await validate(draft);
    const { draft: fixed, applied } = applyRepairs(draft, report, GRAPH);

    const alphaModules = fixed.modules.filter((m) =>
      m.targetSkillIds.includes("alpha"),
    );
    expect(alphaModules).toHaveLength(1);
    expect(applied.filter((a) => a.includes("ALPHA"))).toHaveLength(1);
  });

  it("skips an insert whose dependent module was already dropped", async () => {
    // The drop runs first, so the module that needed the prerequisite may be
    // gone by the time the insert is considered.
    const draft = draftOf([
      mod(0, ["beta"]),
      mod(1, ["delta"]),
      mod(2, ["delta"], { title: "More delta" }),
    ]);
    const report = await validate(draft, [held("beta", 0.95)]);
    const { draft: fixed } = applyRepairs(draft, report, GRAPH);

    expect(fixed.modules.flatMap((m) => m.targetSkillIds)).not.toContain("beta");
    expect(fixed.modules.flatMap((m) => m.targetSkillIds)).not.toContain("alpha");
  });

  it("falls back to the slug for a skill the graph no longer names", async () => {
    // Mastery can outlive the pack entry that produced it.
    const draft = draftOf([mod(0, ["alpha"]), mod(1, ["beta"]), mod(2, ["gamma"])]);
    const report = await validate(draft, [held("beta", 0.95)]);
    const stripped = {
      ...GRAPH,
      skills: GRAPH.skills.filter((sk) => sk.id !== "beta"),
    };

    const { applied } = applyRepairs(draft, report, stripped);
    expect(applied[0]).toContain("beta");
  });

  it("ignores a repair payload that is not the shape it claims", async () => {
    const draft = draftOf([mod(0, ["alpha"]), mod(1, ["beta"]), mod(2, ["gamma"])]);
    const { draft: fixed, applied } = applyRepairs(
      draft,
      {
        passed: false,
        checks: [
          {
            name: "no_already_mastered",
            passed: false,
            severity: "blocking",
            detail: "malformed",
            repair: { drop: "not-an-array" },
          },
          {
            name: "no_redundancy",
            passed: false,
            severity: "warning",
            detail: "orders that do not exist",
            repair: { merge: [{ a: 90, b: 91 }] },
          },
        ],
      },
      GRAPH,
    );

    expect(applied).toEqual([]);
    expect(fixed.modules).toHaveLength(3);
  });

  it("names the dependent by slug when the graph no longer has it", async () => {
    const draft = draftOf([mod(0, ["alpha"]), mod(1, ["beta"]), mod(2, ["gamma"])]);
    const { applied } = applyRepairs(
      draft,
      {
        passed: false,
        checks: [
          {
            name: "prereq_completeness",
            passed: false,
            severity: "blocking",
            detail: "stale",
            repair: { insert: [{ order: 1, skillId: "beta", needs: "alpha" }] },
          },
        ],
      },
      // `beta` is gone from the graph but still named in the draft.
      { ...GRAPH, skills: GRAPH.skills.filter((sk) => sk.id !== "beta") },
    );

    expect(applied[0]).toContain("before beta");
  });

  it("changes nothing when there is nothing to repair", async () => {
    const draft = draftOf([mod(0, ["alpha"]), mod(1, ["beta"]), mod(2, ["gamma"])]);
    const report = await validate(draft);
    const { draft: fixed, applied } = applyRepairs(draft, report, GRAPH);

    expect(applied).toEqual([]);
    expect(fixed.modules).toHaveLength(3);
  });
});

describe("isRepairable", () => {
  it("is false when the only failure is a hallucinated skill", async () => {
    // §14.6's fail action there is "regenerate" — patching cannot invent a
    // skill into the graph, so repairing would loop without changing anything.
    const draft = draftOf([mod(0, ["ghost"]), mod(1, ["alpha"]), mod(2, ["beta"])]);
    const report = await validate(draft);
    expect(report.checks.find((c) => c.name === "no_hallucinated_skills")!.passed).toBe(false);
    expect(isRepairable(report)).toBe(false);
  });

  it("is true when something mechanical failed", async () => {
    const draft = draftOf([mod(0, ["beta"]), mod(1, ["gamma"]), mod(2, ["delta"])]);
    expect(isRepairable(await validate(draft))).toBe(true);
  });
});

/* ── The pipeline ──────────────────────────────────────────────────────── */

function modelReturning(drafts: unknown[]) {
  const create = vi.fn(async (_b: Anthropic.MessageCreateParamsNonStreaming) => {
    const input = drafts.shift();
    return {
      id: "m",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
      content: [{ type: "tool_use", id: "t", name: "submit_curriculum", input }],
    } as unknown as Anthropic.Message;
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

/** A db stub: swallows the AgentRun write, and reports no prior spend. */
const db = {
  transaction: async (fn: (tx: unknown) => Promise<void>) => {
    await fn({ insert: () => ({ values: async () => undefined }) });
  },
} as never;

const architectInput = {
  graph: GRAPH,
  goalSkillIds: ALL,
  mastery: [],
  now: NOW,
  constraints: { weeklyHours: 5, deadline: null },
  rubricCriteria: new Map([["r4", 4]]),
  rawGoal: "learn it",
};

describe("generateValidatedCurriculum", () => {
  it("returns a clean generation untouched", async () => {
    const good = draftOf([mod(0, ["alpha"]), mod(1, ["beta"]), mod(2, ["gamma"])]);
    const { client, create } = modelReturning([good]);

    const outcome = await generateValidatedCurriculum(
      { client, db, userId: null, spotCheck: clean },
      architectInput,
    );

    expect(outcome.source).toBe("generated");
    expect(outcome.attempts).toBe(1);
    expect(outcome.repairs).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("repairs a fixable curriculum rather than regenerating it", async () => {
    // Missing prerequisite — mechanical, so it is patched on the first attempt
    // instead of spending a second generation on it.
    const fixable = draftOf([mod(0, ["beta"]), mod(1, ["gamma"]), mod(2, ["delta"])]);
    const { client, create } = modelReturning([fixable]);

    const outcome = await generateValidatedCurriculum(
      { client, db, userId: null, spotCheck: clean },
      architectInput,
    );

    expect(outcome.source).toBe("repaired");
    expect(outcome.report!.passed).toBe(true);
    expect(outcome.repairs.some((r) => r.includes("ALPHA"))).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("falls back to the canonical path after two failures (§14.9.5)", async () => {
    // Hallucinated skills are not repairable, so both attempts are spent and
    // the learner still gets a working path.
    const broken = draftOf([mod(0, ["ghost"]), mod(1, ["ghoul"]), mod(2, ["wraith"])]);
    const { client, create } = modelReturning([broken, broken]);

    const outcome = await generateValidatedCurriculum(
      { client, db, userId: null, spotCheck: clean },
      architectInput,
    );

    expect(outcome.source).toBe("canonical");
    expect(outcome.attempts).toBe(MAX_GENERATION_ATTEMPTS);
    expect(create).toHaveBeenCalledTimes(MAX_GENERATION_ATTEMPTS);
    expect(outcome.report!.passed).toBe(true);
    expect(outcome.draft!.modules.length).toBeGreaterThanOrEqual(MIN_MODULES);
  });

  it("falls back when the model refuses outright", async () => {
    const create = vi.fn(async () => ({
      id: "m",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      stop_reason: "refusal",
      content: [],
      usage: { input_tokens: 5, output_tokens: 0 },
    }) as unknown as Anthropic.Message);

    const outcome = await generateValidatedCurriculum(
      {
        client: { messages: { create } } as unknown as Anthropic,
        db,
        userId: null,
        spotCheck: clean,
      },
      architectInput,
    );

    expect(outcome.source).toBe("canonical");
  });

  it("checks the spend cap before calling, not after (§14.9.7)", async () => {
    const spent: Array<Record<string, unknown>> = [{ costCents: 99_999 }];
    // `values()` is awaited directly for the AgentRun insert and chained into
    // `.onConflictDoUpdate()` for the ledger upsert, so the stub has to be both.
    const chain = {
      then: (resolve: (v: unknown) => unknown) => resolve(undefined),
      onConflictDoUpdate: async () => undefined,
    };
    const capped = {
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        await fn({ insert: () => ({ values: () => chain }) });
      },
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => spent }) }),
      }),
    } as never;

    const good = draftOf([mod(0, ["alpha"]), mod(1, ["beta"]), mod(2, ["gamma"])]);
    const { client, create } = modelReturning([good]);

    await generateValidatedCurriculum(
      { client, db: capped, userId: "u1", plan: "free", spotCheck: clean },
      architectInput,
    );

    // Over the cap, so the call is degraded to the cheaper model rather than
    // queued or refused — service degrades, it does not stop.
    const body = create.mock.calls[0]![0] as { model: string };
    expect(body.model).toBe("claude-sonnet-5");
  });

  it("falls back when a repair still does not pass", async () => {
    // Repairable *and* unrepairable failures together: the prerequisite gets
    // inserted, the invented skill does not, so the recheck fails anyway.
    const mixed = draftOf([
      mod(0, ["beta"]),
      mod(1, ["ghost"]),
      mod(2, ["delta"]),
    ]);
    const { client } = modelReturning([mixed, mixed]);

    const outcome = await generateValidatedCurriculum(
      { client, db, userId: null, spotCheck: clean },
      architectInput,
    );

    expect(outcome.source).toBe("canonical");
  });

  it("uses the Opus adversarial pass when no spot-check is supplied", async () => {
    // The default is the expensive one on purpose — §14.6 check 9.
    const good = draftOf([mod(0, ["alpha"]), mod(1, ["beta"]), mod(2, ["gamma"])]);
    const { client, create } = modelReturning([good, { issues: [] }]);

    const outcome = await generateValidatedCurriculum(
      { client, db, userId: null },
      architectInput,
    );

    expect(outcome.source).toBe("generated");
    const spotBody = create.mock.calls[1]![0] as { model: string };
    expect(spotBody.model).toBe("claude-opus-5");
  });

  it("reports no path at all rather than inventing one", async () => {
    const broken = draftOf([mod(0, ["ghost"]), mod(1, ["ghoul"]), mod(2, ["wraith"])]);
    const { client } = modelReturning([broken, broken]);

    const outcome = await generateValidatedCurriculum(
      { client, db, userId: null, spotCheck: clean },
      // One skill left to teach: below the floor for a curriculum.
      { ...architectInput, goalSkillIds: ["alpha"] },
    );

    expect(outcome.source).toBe("none");
    expect(outcome.draft).toBeNull();
    expect(outcome.report).toBeNull();
  });
});

describe("stored status", () => {
  it("marks a canonical fallback differently from a tailored path", () => {
    // §14.9.5 asks for the fallback to be logged for pack improvement, and
    // flattening the two into "active" would lose exactly that signal.
    expect(statusFor("generated")).toBe("active");
    expect(statusFor("repaired")).toBe("active");
    expect(statusFor("canonical")).toBe("validated");
  });
});
