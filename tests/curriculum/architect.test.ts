import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  ARCHITECT_PROMPT,
  buildArchitectContext,
  CURRICULUM_TOOL_SCHEMA,
  factualSpotChecker,
  generateCurriculum,
  SPOTCHECK_PROMPT,
  type ArchitectInput,
} from "@/lib/curriculum/architect";
import type { ValidationInput } from "@/lib/curriculum/validate";
import { MODELS } from "@/lib/ai/models";
import type { EngineSkill, EngineSkillGraph } from "@/lib/engine";

const NOW = "2026-08-13T09:00:00.000Z";
const priors = { pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.25 };

function skill(id: string, level: EngineSkill["level"] = "core"): EngineSkill {
  return {
    id,
    slug: id,
    name: id,
    level,
    evalTier: 1,
    estimatedHours: 6,
    bktPriors: priors,
    canDoStatement: `Do ${id}`,
    area: "core",
  };
}

const GRAPH: EngineSkillGraph = {
  skills: [skill("alpha", "foundational"), skill("beta")],
  dependencies: [
    { fromSkillId: "alpha", toSkillId: "beta", type: "hard", strength: 1 },
  ],
};

function architectInput(over: Partial<ArchitectInput> = {}): ArchitectInput {
  return {
    graph: GRAPH,
    goalSkillIds: ["beta"],
    mastery: [],
    now: NOW,
    constraints: { weeklyHours: 4, deadline: "2026-11-01" },
    rubricCriteria: new Map([["shoot-manual", 5]]),
    rawGoal: "shoot in manual",
    ...over,
  };
}

const held = (skillId: string, mastery: number) => ({
  skillId,
  mastery,
  confidence: 0.8,
  evidenceCount: 3,
  lastSuccessAt: NOW,
  lastPracticedAt: NOW,
  decayHalfLifeDays: 7,
});

const validDraft = {
  modules: [
    {
      order: 0,
      title: "Alpha",
      targetSkillIds: ["alpha"],
      estimatedHours: 6,
      outputArtifact: "exercise",
      acceptanceCriteria: ["You can do alpha"],
      rubricId: null,
    },
    {
      order: 1,
      title: "Beta",
      targetSkillIds: ["beta"],
      estimatedHours: 6,
      outputArtifact: "exercise",
      acceptanceCriteria: ["You can do beta"],
      rubricId: null,
    },
    {
      order: 2,
      title: "Both",
      targetSkillIds: ["alpha", "beta"],
      estimatedHours: 6,
      outputArtifact: "project",
      acceptanceCriteria: ["You can do both"],
      rubricId: "shoot-manual",
    },
  ],
  totalHours: 18,
  rationale: "Foundations first.",
};

function stub(inputs: unknown[]) {
  const create = vi.fn(async (_body: Anthropic.MessageCreateParamsNonStreaming) => {
    const input = inputs.shift();
    return {
      id: "msg",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
      content: [{ type: "tool_use", id: "t", name: "submit", input }],
    } as unknown as Anthropic.Message;
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe("prompts are versioned files in git (§14.9.6)", () => {
  it("carries a name and version that an AgentRun row can record", () => {
    for (const prompt of [ARCHITECT_PROMPT, SPOTCHECK_PROMPT]) {
      expect(prompt.name).toMatch(/^[a-z_]+$/);
      expect(prompt.version).toBeGreaterThanOrEqual(1);
      expect(prompt.text.length).toBeGreaterThan(100);
    }
  });

  it("tells the spot-check not to self-filter for importance", () => {
    // Conservative-reporting instructions measurably depress recall on current
    // models — the filtering belongs in a later deterministic step.
    expect(SPOTCHECK_PROMPT.text).toMatch(/do not filter for importance/i);
  });
});

describe("the tool schema", () => {
  it("closes the object so the model cannot invent fields", () => {
    expect(CURRICULUM_TOOL_SCHEMA.additionalProperties).toBe(false);
    const item = CURRICULUM_TOOL_SCHEMA.properties.modules.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toContain("rubricId");
  });
});

describe("buildArchitectContext", () => {
  it("names the goal, the budget and the graph", () => {
    const context = buildArchitectContext(architectInput());
    expect(context).toContain("shoot in manual");
    expect(context).toContain("4 hours per week");
    expect(context).toContain("Deadline: 2026-11-01");
    expect(context).toContain("needs first: alpha");
    expect(context).toContain("shoot-manual (5 criteria)");
  });

  it("marks what the learner has already demonstrated", () => {
    const context = buildArchitectContext(
      architectInput({ mastery: [held("alpha", 0.95)] }),
    );
    expect(context).toContain("ALREADY DEMONSTRATED");
    expect(context).toContain("do not teach this");
  });

  it("distinguishes partial progress from a demonstrated skill", () => {
    const context = buildArchitectContext(
      architectInput({ mastery: [held("alpha", 0.5)] }),
    );
    expect(context).toContain("partially held (0.50)");
    expect(context).not.toContain("ALREADY DEMONSTRATED");
  });

  it("says plainly when there is no deadline and no rubric", () => {
    const context = buildArchitectContext(
      architectInput({
        constraints: { weeklyHours: 2, deadline: null },
        rubricCriteria: new Map(),
      }),
    );
    expect(context).toContain("Deadline: none");
    expect(context).toContain("- none");
  });

  it("sorts rubrics, so Map insertion order cannot change the bytes", () => {
    const forward = buildArchitectContext(
      architectInput({
        rubricCriteria: new Map([
          ["alpha-rubric", 4],
          ["zeta-rubric", 6],
        ]),
      }),
    );
    const reversed = buildArchitectContext(
      architectInput({
        rubricCriteria: new Map([
          ["zeta-rubric", 6],
          ["alpha-rubric", 4],
        ]),
      }),
    );

    expect(forward).toBe(reversed);
    expect(forward.indexOf("alpha-rubric")).toBeLessThan(
      forward.indexOf("zeta-rubric"),
    );
  });

  it("is byte-identical for identical learner state", () => {
    // It sits behind a cache breakpoint's volatile half; two learners in the
    // same state must produce the same bytes or nothing downstream caches.
    expect(buildArchitectContext(architectInput())).toBe(
      buildArchitectContext(architectInput()),
    );
  });
});

describe("generateCurriculum", () => {
  it("returns a parsed draft and routes to the generation tier", async () => {
    const { client, create } = stub([validDraft]);
    const result = await generateCurriculum(client, architectInput());

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.value.modules).toHaveLength(3);

    const body = create.mock.calls[0]![0];
    // §14.9.3 — generation is Sonnet's job, not Opus's.
    expect(body.model).toBe(MODELS.standard);
  });

  it("rejects a draft the contract refuses, naming the field", async () => {
    // Two modules is below the contract's floor of three. Structured outputs
    // cannot express that bound, which is exactly why the Zod contract runs.
    const short = { ...validDraft, modules: validDraft.modules.slice(0, 2) };
    const { client } = stub([short, short]);

    const result = await generateCurriculum(client, architectInput());
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.detail).toContain("modules");
  });

  it("can be degraded to the cheaper model (§14.9.7 limit 1)", async () => {
    const { client, create } = stub([validDraft]);
    await generateCurriculum(client, architectInput(), { degraded: true });

    const body = create.mock.calls[0]![0];
    expect(body.model).toBe(MODELS.standard);
  });
});

describe("the factual spot-check", () => {
  const validationInput = {
    draft: validDraft,
    graph: GRAPH,
    mastery: [],
    now: NOW,
    constraints: { weeklyHours: 4, deadline: null },
    rubricCriteria: new Map(),
  } as unknown as ValidationInput;

  it("passes when the auditor finds nothing", async () => {
    const { client, create } = stub([{ issues: [] }]);
    const result = await factualSpotChecker(client)(validationInput);

    expect(result.passed).toBe(true);
    expect(result.detail).toBe("No factual problems found.");

    const body = create.mock.calls[0]![0];
    // §14.9.3 — the adversarial pass is the expensive one, deliberately.
    expect(body.model).toBe(MODELS.deep);
  });

  it("fails with every issue the auditor reported", async () => {
    const { client } = stub([
      { issues: ["Module 0 misstates the exposure triangle", "Module 2 hours are not credible"] },
    ]);
    const result = await factualSpotChecker(client)(validationInput);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("exposure triangle");
    expect(result.detail).toContain("not credible");
  });

  it("fails — not passes — when the check itself could not run", async () => {
    // A spot-check that errored is not a spot-check that found nothing. Passing
    // here would let a silent failure look like a clean bill of health.
    const { client } = stub([{ issues: "nope" }, { issues: 42 }]);
    const result = await factualSpotChecker(client)(validationInput);

    expect(result.passed).toBe(false);
    expect(result.detail).toContain("did not complete");
    expect(result.detail).toContain("issues must be an array of strings");
  });
});
