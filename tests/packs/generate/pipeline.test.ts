import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  PACK_GRAPH_PROMPT,
  buildGraphContext,
  generatePackGraph,
} from "@/lib/packs/generate/graph";
import {
  MAX_SKILLS_PER_BATCH,
  PACK_ITEMS_PROMPT,
  batchSkills,
  buildItemsContext,
  generateItems,
} from "@/lib/packs/generate/items";
import {
  PACK_RUBRICS_PROMPT,
  buildRubricsContext,
  generateRubrics,
} from "@/lib/packs/generate/rubrics";
import { generatePack, withRefs } from "@/lib/packs/generate";
import { skillRef } from "@/lib/packs/generate/derive";
import type {
  DraftSkill,
  PackGraphDraft,
  RubricsDraft,
} from "@/lib/contracts/pack";

/**
 * A db stub: swallows the AgentRun write, and reports no prior spend.
 *
 * `values(...)` is awaited directly for the run row and chained through
 * `onConflictDoUpdate` for the spend ledger, so it returns something that
 * answers to both.
 */
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

/** Returns the queued tool inputs in order, one per call. */
function modelReturning(inputs: unknown[]) {
  const create = vi.fn(async (_body: Anthropic.MessageCreateParamsNonStreaming) => ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: "tool_use", id: "t", name: "submit", input: inputs.shift() }],
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const skill = (i: number, over: Partial<DraftSkill> = {}): DraftSkill => ({
  name: `Skill ${i}`,
  description: `A description for skill ${i} that is long enough.`,
  level: "core",
  area: `area-${i % 3}`,
  estimatedHours: 5,
  canDoStatement: `Do thing ${i} and produce something you can look at.`,
  observableEvidence: ["an artefact"],
  prerequisites: [],
  selfReportOnly: false,
  ...over,
});

const EIGHT = Array.from({ length: 8 }, (_, i) => skill(i));

const GRAPH: PackGraphDraft = {
  name: "Probe Subject",
  taxonomyParent: "technology",
  workspace: "code",
  skills: EIGHT,
  rationale: "because",
};

const RUBRICS: RubricsDraft = {
  rubrics: [
    {
      name: "The rubric",
      criteria: [1, 2, 3, 4].map((n) => ({
        name: `Criterion ${n}`,
        description: `What criterion ${n} judges, at length.`,
        weight: n,
        bands: {
          absent: "absent",
          developing: "developing",
          competent: "competent",
          strong: "strong",
        },
      })),
    },
  ],
  projects: [
    {
      title: "The project",
      brief: "A brief comfortably past the forty character minimum for briefs.",
      rubric: "The rubric",
      targetSkills: [skillRef(0)],
      evidenceType: "repo",
      difficulty: 0.5,
      estimatedMinutes: 120,
      acceptanceCriteria: ["it runs"],
    },
  ],
};

/** Three items per skill in one batch's worth of response. */
const itemsFor = (refs: string[]) => ({
  items: refs.flatMap((ref) =>
    (["short_text", "explain", "micro_artifact"] as const).map((type, n) => ({
      skill: ref,
      type,
      difficulty: 0.2 + n * 0.2,
      prompt: `Prompt ${n} for ${ref}, comfortably past the minimum.`,
      concepts: ["a checkable claim"],
    })),
  ),
});

describe("prompts are versioned files in git (§14.9.6)", () => {
  it("each carries a name and version an AgentRun row can record", () => {
    for (const prompt of [
      PACK_GRAPH_PROMPT,
      PACK_ITEMS_PROMPT,
      PACK_RUBRICS_PROMPT,
    ]) {
      expect(prompt.name).toMatch(/^[a-z_]+$/);
      expect(prompt.version).toBeGreaterThanOrEqual(1);
      expect(prompt.text.length).toBeGreaterThan(100);
    }
  });

  it("tells the item author to use the reference and not the name", () => {
    // The instruction that fixed two wasted generations.
    expect(PACK_ITEMS_PROMPT.text).toContain("not the skill's name");
  });

  it("never asks the rubric author for weights that add up", () => {
    expect(PACK_RUBRICS_PROMPT.text).toContain("handled for you");
  });
});

describe("buildGraphContext", () => {
  it("carries the subject", () => {
    expect(buildGraphContext({ subject: "Rust", rawGoal: null })).toContain(
      "Subject: Rust",
    );
  });

  it("includes the learner's own words when there are any", () => {
    const context = buildGraphContext({
      subject: "Rust",
      rawGoal: "I want to stop fighting the borrow checker",
    });
    expect(context).toContain("borrow checker");
  });

  it("omits the line entirely when there are none", () => {
    expect(buildGraphContext({ subject: "Rust", rawGoal: null })).not.toContain(
      "described what they want",
    );
  });
});

describe("buildItemsContext", () => {
  it("puts the reference where the model will quote it", () => {
    const context = buildItemsContext({
      subject: "Rust",
      skills: withRefs(GRAPH).slice(0, 2),
    });
    expect(context).toContain("s0:");
    expect(context).toContain("s1:");
  });

  it("keeps the level off the name's line", () => {
    /*
     * The bug this format exists to prevent: with `- Name (level)` the item
     * author returned "Name (level)" as the skill and every item was dropped.
     */
    const context = buildItemsContext({
      subject: "Rust",
      skills: withRefs(GRAPH).slice(0, 1),
    });
    expect(context).toContain("name: Skill 0");
    expect(context).not.toContain("Skill 0 (core)");
  });
});

describe("batchSkills", () => {
  it("groups by area so related skills are written together", () => {
    const batches = batchSkills(withRefs(GRAPH));
    // Three areas across eight skills.
    expect(batches).toHaveLength(3);
  });

  it("splits an area larger than one call should carry", () => {
    const many = Array.from({ length: MAX_SKILLS_PER_BATCH + 2 }, (_, i) =>
      skill(i, { area: "one-area" }),
    );
    const batches = batchSkills(
      many.map((s, i) => ({ ref: skillRef(i), skill: s })),
    );
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MAX_SKILLS_PER_BATCH);
  });

  it("keeps a reference pointing at the same skill in every batch", () => {
    const refs = batchSkills(withRefs(GRAPH)).flat();
    for (const { ref, skill: s } of refs) {
      expect(GRAPH.skills[Number(ref.slice(1))]!.name).toBe(s.name);
    }
  });
});

describe("buildRubricsContext", () => {
  it("leaves out skills nothing could be submitted for", () => {
    const skills = withRefs({
      ...GRAPH,
      skills: [skill(0), skill(1, { selfReportOnly: true, name: "Feel good" })],
    });
    expect(buildRubricsContext({ subject: "Rust", skills })).not.toContain(
      "Feel good",
    );
  });
});

describe("the three calls", () => {
  it("returns a parsed graph", async () => {
    const { client } = modelReturning([GRAPH]);
    const result = await generatePackGraph(client, {
      subject: "Rust",
      rawGoal: null,
    });
    expect(result.status).toBe("ok");
  });

  it("reports a graph that does not satisfy the contract", async () => {
    // Too few skills: the contract requires eight, and a pack of three is not
    // a subject, it is a chapter.
    const { client } = modelReturning([
      { ...GRAPH, skills: EIGHT.slice(0, 3) },
      { ...GRAPH, skills: EIGHT.slice(0, 3) },
    ]);
    const result = await generatePackGraph(client, {
      subject: "Rust",
      rawGoal: null,
    });
    expect(result.status).toBe("invalid");
  });

  it("returns parsed items and rubrics", async () => {
    const { client } = modelReturning([itemsFor(["s0"]), RUBRICS]);
    expect(
      (await generateItems(client, { subject: "R", skills: withRefs(GRAPH) }))
        .status,
    ).toBe("ok");
    expect(
      (await generateRubrics(client, { subject: "R", skills: withRefs(GRAPH) }))
        .status,
    ).toBe("ok");
  });
});

/** §7.1's resource index, as the researcher would return it. */
const RESOURCES = {
  resources: [
    {
      url: "https://doc.rust-lang.org/book/",
      title: "The Rust Programming Language",
      publisher: "Rust project",
      kind: "book" as const,
      skills: [skillRef(0)],
      assessment: "The canonical introduction; assumes no Rust and some code.",
      publishedAt: "2025-02-20",
    },
    {
      url: "https://doc.rust-lang.org/std/",
      title: "The standard library",
      publisher: "Rust project",
      kind: "reference" as const,
      skills: [skillRef(1)],
      assessment: "A reference, not a tutorial — useless as a starting point.",
      publishedAt: null,
    },
    {
      url: "https://rustlings.cool/",
      title: "Rustlings",
      publisher: "Rust project",
      kind: "tutorial" as const,
      skills: [skillRef(2)],
      assessment: "Small exercises; good for compiler fluency, not for design.",
      publishedAt: "2025-06-01",
    },
    {
      url: "https://this-week-in-rust.org/",
      title: "This Week in Rust",
      publisher: "TWiR",
      kind: "reference" as const,
      skills: [skillRef(3)],
      assessment: "A newsletter — worth following, never worth learning from.",
      publishedAt: "2026-01-05",
    },
  ],
};

/** Every link answers, so nothing is dropped for being dead. */
const reachable = { fetch: async () => ({ status: 200 }) };

/** Queue this to have the model decline a call rather than answer it badly. */
const REFUSED = Symbol("refused");

/**
 * A model that answers by *which* tool it was asked for.
 *
 * `generatePack` makes three calls concurrently — items, rubrics and resources
 * — and a schema retry on any one of them interleaves with the others, so a
 * positional queue stopped describing what these tests meant the moment there
 * were three. Keying on the submit tool says "asked for rubrics, answer this"
 * and holds however the calls land.
 *
 * Queues repeat their last entry rather than running dry: a test that wants a
 * call to keep failing says so once. Items are a function of the refs asked
 * for, because which batch a skill lands in is `batchSkills`'s business and not
 * something a fixture should have to predict.
 */
function modelByTool(answers: {
  graph?: unknown[];
  items?: (refs: string[]) => unknown;
  rubrics?: unknown[];
  resources?: unknown[];
}) {
  const queues: Record<string, unknown[]> = {
    submit_skill_graph: [...(answers.graph ?? [GRAPH])],
    submit_rubrics: [...(answers.rubrics ?? [RUBRICS])],
    submit_resources: [...(answers.resources ?? [RESOURCES])],
  };
  const items = answers.items ?? ((refs: string[]) => itemsFor(refs));

  const create = vi.fn(
    async (body: Anthropic.MessageCreateParamsNonStreaming) => {
      // The submit tool is last: any server tool renders ahead of it.
      const tools = body.tools as Array<{ name: string }>;
      const asked = tools[tools.length - 1]!.name;
      const queue = queues[asked];
      const input = queue
        ? queue.length > 1
          ? queue.shift()
          : queue[0]
        : items([...String(body.messages[0]!.content).matchAll(/^(s\d+):/gm)].map(
            (m) => m[1]!,
          ));

      // The sentinel a test uses to say "this call is declined", which is a
      // different outcome from a schema failure and takes a different path.
      if (input === REFUSED) {
        return {
          id: "msg",
          type: "message",
          role: "assistant",
          model: body.model,
          stop_reason: "refusal",
          stop_details: { type: "refusal", explanation: "declined" },
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
          content: [],
        };
      }

      return {
        id: "msg",
        type: "message",
        role: "assistant",
        model: body.model,
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
        content: [{ type: "tool_use", id: "t", name: asked, input }],
      };
    },
  );

  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe("generatePack", () => {
  const deps = (over: Record<string, unknown> = {}) => ({
    db,
    userId: null,
    linkCheck: reachable,
    ...over,
  });

  it("returns a validated pack on a clean run", async () => {
    const { client } = modelByTool({});
    const outcome = await generatePack(deps({ client }) as never, {
      slug: "rust",
      subject: "Rust",
      rawGoal: null,
    });

    expect(outcome.source).toBe("generated");
    expect(outcome.attempts).toBe(1);
    expect(outcome.pack!.slug).toBe("rust");
    expect(outcome.report!.passed).toBe(true);
    expect(outcome.pack!.resources).toHaveLength(4);
  });

  it("asks for the graph on the deep tier and the rest on standard", async () => {
    // §14.8 — "never default everything to Opus", and never the reverse either:
    // the graph is the one call the rest cannot correct.
    const { client, create } = modelByTool({});
    await generatePack(deps({ client }) as never, {
      slug: "rust",
      subject: "Rust",
      rawGoal: null,
    });

    const models = create.mock.calls.map(
      (c) => c[0].model,
    );
    expect(models[0]).toBe("claude-opus-5");
    expect(models.slice(1).every((m) => m === "claude-sonnet-5")).toBe(true);
  });

  it("retries once when the graph cannot be written", async () => {
    const bad = { ...GRAPH, skills: EIGHT.slice(0, 2) };
    const { client } = modelByTool({ graph: [bad, bad, GRAPH] });

    const outcome = await generatePack(deps({ client }) as never, {
      slug: "rust",
      subject: "Rust",
      rawGoal: null,
    });
    expect(outcome.attempts).toBe(2);
    expect(outcome.source).toBe("generated");
  });

  it("gives up after two attempts rather than spending a third", async () => {
    const bad = { ...GRAPH, skills: EIGHT.slice(0, 2) };
    const { client } = modelByTool({ graph: [bad] });

    const outcome = await generatePack(deps({ client }) as never, {
      slug: "rust",
      subject: "Rust",
      rawGoal: null,
    });
    expect(outcome.source).toBe("none");
    expect(outcome.pack).toBeNull();
    expect(outcome.attempts).toBe(2);
    expect(outcome.reasons.join(" ")).toContain("skill graph");
  });

  it("fails rather than shipping a pack too thin to place anyone", async () => {
    /*
     * There is no canonical fallback for a subject nobody curated, so the
     * honest outcome is "we could not build this", never a pack of eleven
     * skills and four questions.
     */
    // Valid responses, just far too few items — one per batch rather than three
    // per skill. An empty `items` array would fail the contract instead, which
    // is a different path (and burns a schema retry).
    const { client } = modelByTool({
      items: (refs) => ({
        items: [
          {
            skill: refs[0],
            type: "short_text" as const,
            difficulty: 0.5,
            prompt: `The only question written for ${refs[0]}, long enough to pass.`,
            concepts: ["a claim"],
          },
        ],
      }),
    });

    const outcome = await generatePack(deps({ client }) as never, {
      slug: "rust",
      subject: "Rust",
      rawGoal: null,
    });
    expect(outcome.source).toBe("none");
    expect(outcome.reasons.join(" ")).toContain("diagnostic needs at least");
  });

  it("keeps the drop log on a failure, because it is the explanation", async () => {
    // The defect the live probe exposed: a pack failing the floor with the
    // reasons thrown away leaves "7 items" and no way to find out why.
    const { client } = modelByTool({
      items: (refs) =>
        refs.includes("s0")
          ? { items: itemsFor(["s0"]).items.map((i) => ({ ...i, skill: "s99" })) }
          : { items: [] },
    });

    const outcome = await generatePack(deps({ client }) as never, {
      slug: "rust",
      subject: "Rust",
      rawGoal: null,
    });
    expect(outcome.source).toBe("none");
    expect(outcome.dropped.join(" ")).toContain("unknown skill");
  });

  it("carries on after a failed item batch rather than aborting the attempt", async () => {
    /*
     * A batch is one area's questions. Losing it makes a thinner pack, and
     * whether that is fatal is the quality floor's call at the end — not the
     * batch's. What must not happen is the attempt stopping there, because the
     * graph call it would throw away is the expensive one.
     */
    const batches = batchSkills(withRefs(GRAPH));
    const { client, create } = modelByTool({
      items: (refs) => (refs.includes("s0") ? { nonsense: true } : itemsFor(refs)),
    });

    await generatePack(deps({ client }) as never, {
      slug: "rust",
      subject: "Rust",
      rawGoal: null,
    });

    // Every remaining batch, the rubrics call and the research call still went
    // out — the failing batch took none of them with it.
    const tools = create.mock.calls.map((c) => {
      const declared = c[0].tools as Array<{ name: string }>;
      return declared[declared.length - 1]!.name;
    });
    expect(tools.filter((t) => t === "submit_items").length).toBeGreaterThan(
      batches.length - 1,
    );
    expect(tools).toContain("submit_rubrics");
    expect(tools).toContain("submit_resources");
  });

  it("ships the pack without a reading list when the research fails", async () => {
    /*
     * Resources are additive: nothing in the diagnostic, the planner or the
     * grader reads them, so a pack without them teaches exactly what it would
     * have taught anyway and simply cannot point anywhere else. Failing here
     * would throw away the graph — the expensive call — over the cheap one.
     */
    const { client } = modelByTool({ resources: [{ resources: [] }] });

    const outcome = await generatePack(deps({ client }) as never, {
      slug: "rust",
      subject: "Rust",
      rawGoal: null,
    });

    expect(outcome.source).toBe("generated");
    expect(outcome.pack!.resources).toEqual([]);
    // §14.6 wants drops shown: a pack with no reading list says why it has none
    // rather than looking like a subject nobody had anything to recommend for.
    expect(outcome.dropped.join(" ")).toContain("returned nothing usable");
  });

  it("distinguishes a declined search from an unusable one", async () => {
    const { client } = modelByTool({ resources: [REFUSED] });

    const outcome = await generatePack(deps({ client }) as never, {
      slug: "rust",
      subject: "Rust",
      rawGoal: null,
    });

    expect(outcome.source).toBe("generated");
    expect(outcome.dropped.join(" ")).toContain("was declined");
  });

  it("fails when the rubrics cannot be written", async () => {
    const { client } = modelByTool({ rubrics: [{ rubrics: [] }] });

    const outcome = await generatePack(deps({ client }) as never, {
      slug: "rust",
      subject: "Rust",
      rawGoal: null,
    });
    expect(outcome.source).toBe("none");
    expect(outcome.reasons.join(" ")).toContain("rubrics");
  });

  it("degrades the deep tier when the learner is over their cap", async () => {
    // §14.9.7 limit 1 — checked before the first call, not after the bill lands.
    const capped = {
      transaction: (db as unknown as { transaction: unknown }).transaction,
      select: () => ({
        from: () => ({
          where: () => ({
            // spentThisPeriod reads one ledger row; well past the free cap.
            limit: async () => [{ costCents: 100_000 }],
          }),
        }),
      }),
    } as never;

    const { client, create } = modelByTool({});
    await generatePack(
      deps({ client, db: capped, userId: "u1", plan: "free" }) as never,
      { slug: "rust", subject: "Rust", rawGoal: null },
    );

    const models = create.mock.calls.map(
      (c) => c[0].model,
    );
    expect(models.every((m) => m !== "claude-opus-5")).toBe(true);
  });

  it("degrades a plan without the deep tier without reading the ledger (E13)", async () => {
    // `degradesGeneration` short-circuits the `||`: a Learner gets standard
    // models however little they have spent, so the cap is never consulted.
    let ledgerReads = 0;
    const unspent = {
      transaction: (db as unknown as { transaction: unknown }).transaction,
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              ledgerReads += 1;
              return [{ costCents: 0 }];
            },
          }),
        }),
      }),
    } as never;

    const { client, create } = modelByTool({});
    await generatePack(
      deps({ client, db: unspent, userId: "u1", plan: "learner" }) as never,
      { slug: "rust", subject: "Rust", rawGoal: null },
    );

    expect(create.mock.calls.every((c) => c[0].model !== "claude-opus-5")).toBe(
      true,
    );
    expect(ledgerReads).toBe(0);
  });

  it("keeps authoring on the deep tier for a plan that pays for it", async () => {
    // The other side of the same `||`, and the one that matters: §14.9.3 gives
    // `packAuthor` the deep tier because every later step reads the graph and
    // cannot correct it.
    const unspent = {
      transaction: (db as unknown as { transaction: unknown }).transaction,
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ costCents: 0 }] }),
        }),
      }),
    } as never;

    const { client, create } = modelByTool({});
    await generatePack(
      deps({ client, db: unspent, userId: "u1", plan: "pro" }) as never,
      { slug: "rust", subject: "Rust", rawGoal: null },
    );

    expect(create.mock.calls.some((c) => c[0].model === "claude-opus-5")).toBe(
      true,
    );
  });
});
