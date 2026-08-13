import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  MAX_ARTEFACT_CHARS,
  MAX_TIER_WITHOUT_EXECUTION,
  evaluateSubmission,
  normaliseArtefact,
  spreadBetween,
  tierFor,
} from "@/lib/evaluation";
import {
  GRADER_PROMPT,
  buildGradeContext,
  gradeSubmission,
  renderRubric,
} from "@/lib/evaluation/grade";
import type { Band, EvaluationDraft } from "@/lib/contracts/evaluation";
import type { EvalTier, RubricCriterion } from "@/lib/packs/types";

/** §14.5 end to end, with the model stubbed. */

const values = () => {
  const chain = Promise.resolve(undefined) as Promise<undefined> & {
    onConflictDoUpdate: () => Promise<undefined>;
  };
  chain.onConflictDoUpdate = async () => undefined;
  return chain;
};

const db = {
  transaction: async (fn: (tx: unknown) => Promise<void>) => {
    await fn({ insert: () => ({ values }) });
  },
} as never;

function modelReturning(inputs: unknown[]) {
  const create = vi.fn(
    async (_body: Anthropic.MessageCreateParamsNonStreaming) => ({
      id: "msg",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
      content: [
        { type: "tool_use", id: "t", name: "submit", input: inputs.shift() },
      ],
    }),
  );
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const criterion = (id: string, weight: number): RubricCriterion => ({
  id,
  name: `Criterion ${id}`,
  description: "What this one judges, at length.",
  weight,
  bands: {
    absent: "nothing of the sort",
    developing: "started but incomplete",
    competent: "does the job",
    strong: "does the job and proves it",
  },
});

const CRITERIA = [criterion("grain", 0.6), criterion("checked", 0.4)];

const ARTEFACT =
  "GROUP BY c.segment keeps one row per segment. I checked the totals against the source.";

const PROJECT = {
  title: "Revenue by channel",
  brief: "Produce monthly revenue by channel without double-counting orders.",
  acceptanceCriteria: ["It runs", "The totals reconcile"],
};

const draft = (
  bands: Array<[string, Band, string]>,
): EvaluationDraft => ({
  criteria: bands.map(([criterionId, band, evidence]) => ({
    criterionId,
    band,
    evidence,
    reasoning: "because of the quoted span",
  })),
  strengths: ["clear naming"],
  gaps: ["no zero-filling"],
  nextActions: ["add a calendar spine"],
});

const GOOD = draft([
  ["grain", "strong", "GROUP BY c.segment keeps one row per segment"],
  ["checked", "competent", "I checked the totals against the source"],
]);

const evaluate = (inputs: unknown[], skillTier: EvalTier = 2) =>
  evaluateSubmission(
    { client: modelReturning(inputs).client, db, userId: null },
    { project: PROJECT, criteria: CRITERIA, skillTier, artefact: ARTEFACT },
  );

describe("the grader's prompt", () => {
  it("is a versioned file an AgentRun row can record (§14.9.6)", () => {
    expect(GRADER_PROMPT.name).toBe("rubric_grader");
    expect(GRADER_PROMPT.version).toBeGreaterThanOrEqual(1);
  });

  it("demands the quote be copied, not paraphrased", () => {
    expect(GRADER_PROMPT.text).toContain("Not a paraphrase");
  });

  it("tells the marker not to self-filter (§14.5)", () => {
    // Conservative-reporting instructions measurably depress recall.
    expect(GRADER_PROMPT.text).toContain("Do not decide something is too minor");
  });

  it("refuses to credit what is not in the work", () => {
    expect(GRADER_PROMPT.text).toContain("it did not happen");
  });
});

describe("gradeSubmission", () => {
  it("defaults to the full-strength model when no degrade is asked for", async () => {
    // The options argument is optional; called bare, it must not silently
    // downgrade the one call the learner is asked to believe.
    const { client, create } = modelReturning([GOOD]);
    const result = await gradeSubmission(client, {
      project: PROJECT,
      criteria: CRITERIA,
      artefact: ARTEFACT,
    });

    expect(result.status).toBe("ok");
    expect(create.mock.calls[0]![0].model).toBe("claude-opus-5");
  });

  it("reports a draft that does not satisfy the contract", async () => {
    const { client } = modelReturning([{ criteria: [] }, { criteria: [] }]);
    const result = await gradeSubmission(client, {
      project: PROJECT,
      criteria: CRITERIA,
      artefact: ARTEFACT,
    });
    expect(result.status).toBe("invalid");
  });
});

describe("renderRubric", () => {
  it("puts every band descriptor in front of the model (§14.5)", () => {
    /*
     * "Never grade without the rubric in the prompt" — an LLM given only a
     * problem and a solution grades markedly worse than one given the rubric.
     */
    const rendered = renderRubric(CRITERIA);
    for (const band of ["nothing of the sort", "does the job and proves it"]) {
      expect(rendered).toContain(band);
    }
    expect(rendered).toContain("weight 0.6");
  });
});

describe("buildGradeContext", () => {
  const base = { project: PROJECT, criteria: CRITERIA, artefact: ARTEFACT };

  it("carries the brief, the checklist, the rubric and the work", () => {
    const context = buildGradeContext(base);
    expect(context).toContain("Revenue by channel");
    expect(context).toContain("The totals reconcile");
    expect(context).toContain("does the job");
    expect(context).toContain(ARTEFACT);
  });

  it("reframes the second pass so agreement means something", () => {
    // A band that only survives one ordering shows up as spread rather than as
    // a number nobody questioned.
    expect(buildGradeContext({ ...base, framing: "second-pass" })).toContain(
      "reverse order",
    );
    expect(buildGradeContext(base)).not.toContain("reverse order");
  });
});

describe("normaliseArtefact", () => {
  it("leaves ordinary work alone", () => {
    expect(normaliseArtefact("  hello\r\nworld  ")).toEqual({
      text: "hello\nworld",
      truncated: false,
    });
  });

  it("discloses truncation rather than silently cutting (§14.9.5)", () => {
    const long = "x".repeat(MAX_ARTEFACT_CHARS + 500);
    const { text, truncated } = normaliseArtefact(long);

    expect(truncated).toBe(true);
    // The marker is left in the text the grader reads, so a learner is never
    // marked as though the missing half did not exist.
    expect(text).toContain("cut off here");
  });
});

describe("tierFor", () => {
  it("refuses to claim tier 1 while nothing executes", () => {
    /*
     * §7.2 tier 1 is "execute + assert" and licenses "Verified: this works".
     * Reading code is not executing it, so a tier-1 skill is assessed at 2 and
     * the screen says 2. The difference between a limit and a lie (§4.2 law 3).
     */
    expect(tierFor(1)).toBe(MAX_TIER_WITHOUT_EXECUTION);
  });

  it("leaves weaker tiers where they are", () => {
    expect(tierFor(3)).toBe(3);
    expect(tierFor(5)).toBe(5);
  });
});

describe("spreadBetween", () => {
  it("is zero when both passes agree", () => {
    expect(spreadBetween(GOOD, GOOD)).toBe(0);
  });

  it("counts the widest disagreement in bands", () => {
    const other = draft([
      ["grain", "absent", "GROUP BY c.segment"],
      ["checked", "competent", "I checked the totals"],
    ]);
    expect(spreadBetween(GOOD, other)).toBe(3);
  });

  it("ignores a criterion only one pass answered", () => {
    const partial = draft([["grain", "strong", "GROUP BY c.segment"]]);
    expect(spreadBetween(GOOD, partial)).toBe(0);
  });
});

describe("evaluateSubmission", () => {
  it("grades, verifies and produces an observation", async () => {
    const outcome = await evaluate([GOOD, GOOD]);
    const result = outcome.result!;

    expect(result.verification.passed).toBe(true);
    expect(result.overall).toBeCloseTo(0.6 * 1 + 0.4 * (2 / 3));
    expect(result.observation.correct).toBe(true);
    expect(result.bandSpread).toBe(0);
  });

  it("refuses an empty submission before spending anything", async () => {
    const { client, create } = modelReturning([]);
    const outcome = await evaluateSubmission(
      { client, db, userId: null },
      { project: PROJECT, criteria: CRITERIA, skillTier: 2, artefact: "   " },
    );

    expect(outcome.result).toBeNull();
    expect(outcome.reason).toContain("nothing in what you handed in");
    expect(create).not.toHaveBeenCalled();
  });

  it("drops a criterion whose quote was invented, and says so", async () => {
    const lying = draft([
      ["grain", "strong", "GROUP BY c.segment keeps one row per segment"],
      ["checked", "strong", "I wrote a property test over ten thousand rows"],
    ]);
    const outcome = await evaluate([lying, lying]);
    const result = outcome.result!;

    expect(result.criteria.map((c) => c.criterionId)).toEqual(["grain"]);
    expect(result.verification.invalidated[0]!.reason).toContain(
      "not in the submitted work",
    );
    // The learner is not failed for the grader's fabrication; the doubt goes
    // into confidence instead.
    expect(result.overall).toBe(1);
    expect(result.verification.passed).toBe(false);
  });

  it("refuses to produce a score when nothing could be traced to the work", async () => {
    /*
     * 0 out of 0 reads to a learner as "your work scored zero" rather than "we
     * could not mark this" — a claim about them rather than about our failure.
     */
    const invented = draft([
      ["grain", "absent", "there is no GROUP BY anywhere in this"],
      ["checked", "absent", "no verification was attempted at all"],
    ]);
    const outcome = await evaluate([invented, invented]);

    expect(outcome.result).toBeNull();
    expect(outcome.reason).toContain("could be traced back");
  });

  it("flags two passes more than a band apart for a person", async () => {
    // §14.5 step 4 — "disagreement > 1 band → flag", whatever the confidence
    // arithmetic happens to produce.
    const other = draft([
      ["grain", "absent", "GROUP BY c.segment keeps one row per segment"],
      ["checked", "absent", "I checked the totals against the source"],
    ]);
    const outcome = await evaluate([GOOD, other]);

    expect(outcome.result!.bandSpread).toBe(3);
    expect(outcome.result!.humanReview).toBe(true);
  });

  it("still returns a result when the second pass failed to run", async () => {
    // Losing self-consistency costs confidence; it does not cost the learner
    // their evaluation.
    const outcome = await evaluate([GOOD, { nonsense: true }, { nonsense: true }]);

    expect(outcome.result).not.toBeNull();
    expect(outcome.result!.bandSpread).toBeUndefined();
  });

  it("gives up when the marker itself could not run", async () => {
    const outcome = await evaluate([{ nonsense: true }, { nonsense: true }]);
    expect(outcome.result).toBeNull();
    expect(outcome.reason).toContain("could not run");
  });

  it("marks tier-5 work as engagement with no confidence (§7.2)", async () => {
    const outcome = await evaluate([GOOD, GOOD], 5);
    const result = outcome.result!;

    expect(result.evalTier).toBe(5);
    expect(result.confidence).toBe(0);
    expect(result.observation.evidenceTier).toBe(5);
    // Zero confidence is below the review threshold by construction.
    expect(result.humanReview).toBe(true);
  });

  it("runs the marker on the deep tier (§14.9.3)", async () => {
    const { client, create } = modelReturning([GOOD, GOOD]);
    await evaluateSubmission(
      { client, db, userId: null },
      { project: PROJECT, criteria: CRITERIA, skillTier: 2, artefact: ARTEFACT },
    );
    expect(create.mock.calls[0]![0].model).toBe("claude-opus-5");
  });

  it("degrades off the deep tier when the learner is over their cap", async () => {
    const capped = {
      transaction: (db as unknown as { transaction: unknown }).transaction,
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ costCents: 100_000 }] }),
        }),
      }),
    } as never;

    const { client, create } = modelReturning([GOOD, GOOD]);
    await evaluateSubmission(
      { client, db: capped, userId: "u1", plan: "free" },
      { project: PROJECT, criteria: CRITERIA, skillTier: 2, artefact: ARTEFACT },
    );
    expect(create.mock.calls[0]![0].model).not.toBe("claude-opus-5");
  });
});
