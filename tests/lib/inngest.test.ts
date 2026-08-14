import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, inngest } from "@/lib/inngest/client";
import {
  buildPack,
  buildPackHandler,
  evaluate,
  evaluateHandler,
  type EvaluateResult,
  functions,
  ping,
  pingHandler,
} from "@/lib/inngest/functions";

describe("the Inngest client", () => {
  it("is registered under a stable app id", () => {
    // Changing this orphans in-flight runs, so it is pinned by a test.
    expect(inngest.id).toBe("online-uni");
  });

  it("names every pipeline it has, and nothing it does not", () => {
    expect(EVENTS).toEqual({
      ping: "system/ping",
      buildPath: "goal/path.requested",
      evaluate: "submission/evaluate.requested",
      planNightly: "planner/nightly.requested",
      buildPack: "pack/generate.requested",
    });
  });

  it("namespaces every event so a name cannot collide", () => {
    for (const name of Object.values(EVENTS)) {
      expect(name).toMatch(/^[a-z]+\/[a-z.-]+$/);
    }
  });
});

describe("the ping function — E1's durability proof", () => {
  it("is registered", () => {
    expect(functions).toContain(ping);
    expect(functions).toContain(buildPack);
    expect(functions).toContain(evaluate);
    expect(functions).toHaveLength(3);
  });

  it("triggers on the ping event", () => {
    expect(ping.opts.triggers).toEqual([{ event: EVENTS.ping }]);
  });

  it("carries a stable id", () => {
    expect(ping.opts.id).toBe("system-ping");
  });

  it("runs both steps and threads the payload through", async () => {
    // Two steps rather than one, because the property worth proving is
    // durability — a single-step function proves only that the handler ran.
    const executed: string[] = [];
    const step = {
      run: async <T,>(name: string, fn: () => T | Promise<T>): Promise<T> => {
        executed.push(name);
        return fn();
      },
    };

    const result = await pingHandler({
      event: { data: { message: "hello" } },
      step,
    });

    expect(executed).toEqual(["record-receipt", "acknowledge"]);
    expect(result.message).toBe("hello");
    expect(result.acknowledged).toBe(true);
    expect(Date.parse(result.at)).not.toBeNaN();
  });

  it("defaults the message when the event carries no data", async () => {
    const step = {
      run: async <T,>(_n: string, fn: () => T | Promise<T>): Promise<T> => fn(),
    };

    expect((await pingHandler({ event: {}, step })).message).toBe("ping");
    expect((await pingHandler({ event: { data: {} }, step })).message).toBe(
      "ping",
    );
  });
});

/**
 * The registered function's own wiring. `buildPackHandler` is injectable so the
 * interesting half is testable, but the closures that connect it to the real
 * generator, seeder and build row are code too, and nothing else runs them.
 */
let submissionRows: unknown[] = [{ userId: "u1" }];

/**
 * The submission lookup ends in `.limit()`; the entitlement lookup adds an
 * `.orderBy()` before it and, for grants, resolves straight off `.where()`.
 * Both shapes are `await`-able at the point they stop, which is what lets one
 * fake serve all three without knowing which query it is answering.
 */
vi.mock("@/db", () => {
  const rows = () => {
    const result: Record<string, unknown> = {
      limit: async () => submissionRows,
      orderBy: () => ({ limit: async () => [] }),
      then: (resolve: (value: unknown[]) => unknown) => resolve([]),
    };
    return result;
  };

  return {
    getDb: () => ({
      db: true,
      select: () => ({ from: () => ({ where: rows }) }),
    }),
  };
});
vi.mock("@/lib/content/resolve", () => ({
  resolvePack: async () => packStub,
}));
vi.mock("@/lib/goals/store", () => ({
  masteryFor: async () => heldMastery,
}));
/**
 * Whether the course is finished is `markAchievedIfComplete`'s question and is
 * tested against a real database in tests/lib/goal-store.test.ts. What this file
 * owes is that the handler asks it, and asks it *after* the evaluation is
 * recorded — a marked hand-in is the only thing that can complete a course, so
 * asking first would always get last week's answer.
 */
const markAchievedMock = vi.fn(async () => false);
vi.mock("@/lib/goals/achievement", () => ({
  markAchievedIfComplete: (...args: unknown[]) =>
    markAchievedMock(...(args as [])),
}));
vi.mock("@/lib/evaluation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/evaluation")>()),
  evaluateSubmission: vi.fn(async () => evaluationOutcome),
}));
vi.mock("@/lib/submissions/store", () => ({
  submissionById: async () => storedSubmission,
  setStatus: vi.fn(async () => undefined),
  recordEvaluation: vi.fn(async () => ({
    evaluationId: "ev-1",
    masteryDelta: 0.1,
  })),
}));
vi.mock("@/lib/ai/client", () => ({ getAnthropic: () => ({ client: true }) }));
vi.mock("@/lib/packs/generate", () => ({
  generatePack: vi.fn(async () => ({
    pack: { slug: "rust" },
    reasons: [],
    report: null,
    source: "generated",
    dropped: [],
    attempts: 1,
  })),
}));
vi.mock("@/lib/packs/seed", () => ({ seedPack: vi.fn(async () => undefined) }));
vi.mock("@/lib/packs/build", () => ({
  finishBuild: vi.fn(async () => undefined),
}));

describe("the registered build function", () => {
  it("triggers on the build event and runs one per subject at a time", () => {
    // Two runs authoring the same slug would both pay, and one would overwrite
    // the other's pack.
    expect(buildPack.opts.triggers).toEqual([{ event: EVENTS.buildPack }]);
    expect(buildPack.opts.concurrency).toMatchObject({
      key: "event.data.slug",
      limit: 1,
    });
  });

  it("wires the generator, the seeder and the build row together", async () => {
    const { generatePack } = await import("@/lib/packs/generate");
    const { seedPack } = await import("@/lib/packs/seed");
    const { finishBuild } = await import("@/lib/packs/build");

    const ran: string[] = [];
    const result = await (
      buildPack as unknown as {
        fn: (c: unknown) => Promise<{ status: string }>;
      }
    ).fn({
      event: { data: { slug: "rust", subject: "Rust", userId: "u1" } },
      step: {
        run: async <T>(name: string, f: () => T | Promise<T>) => {
          ran.push(name);
          return f();
        },
      },
    });

    expect(result.status).toBe("ready");
    // The db stub grew a query surface for the evaluate tests, so these match
    // on the handle being the real one rather than on its exact shape.
    expect(generatePack).toHaveBeenCalledWith(
      expect.objectContaining({ client: { client: true }, userId: "u1" }),
      { slug: "rust", subject: "Rust", rawGoal: null },
    );
    expect(seedPack).toHaveBeenCalledWith(
      expect.objectContaining({ db: true }),
      { slug: "rust" },
    );
    expect(finishBuild).toHaveBeenCalledWith(
      expect.objectContaining({ db: true }),
      "rust",
      { status: "ready" },
    );
  });
});

describe("buildPackHandler", () => {
  /** A step runner that records order, so durability is observable. */
  const recordingStep = () => {
    const ran: string[] = [];
    return {
      ran,
      step: {
        run: async <T>(name: string, fn: () => T | Promise<T>) => {
          ran.push(name);
          return fn();
        },
      },
    };
  };

  const deps = (pack: unknown | null, reasons: string[] = []) => {
    const seeded: unknown[] = [];
    const finished: unknown[] = [];
    return {
      seeded,
      finished,
      handler: buildPackHandler({
        generate: async () => ({ pack, reasons }),
        seed: async (p) => {
          seeded.push(p);
        },
        finish: async (slug, outcome) => {
          finished.push({ slug, outcome });
        },
      }),
    };
  };

  it("seeds a pack it managed to author and marks the build ready", async () => {
    const { seeded, finished, handler } = deps({ slug: "rust" });
    const { ran, step } = recordingStep();

    const result = await handler({
      event: { data: { slug: "rust", subject: "Rust", userId: "u1" } },
      step,
    });

    expect(result).toEqual({ slug: "rust", status: "ready", detail: null });
    expect(seeded).toEqual([{ slug: "rust" }]);
    expect(finished).toEqual([{ slug: "rust", outcome: { status: "ready" } }]);
    expect(ran).toEqual(["author-pack", "seed-pack", "record-ready"]);
  });

  it("records a failure with the generator's own reason", async () => {
    const { seeded, finished, handler } = deps(null, [
      "7 items; a diagnostic needs at least 24",
    ]);
    const { ran, step } = recordingStep();

    const result = await handler({
      event: { data: { slug: "rust", subject: "Rust", userId: null } },
      step,
    });

    expect(result.status).toBe("failed");
    expect(result.detail).toBe("7 items; a diagnostic needs at least 24");
    // Nothing is seeded from a failed build — there is no half-pack.
    expect(seeded).toEqual([]);
    expect(finished).toHaveLength(1);
    expect(ran).toEqual(["author-pack", "record-failure"]);
  });

  it("says something a learner can read when the generator gave no reason", async () => {
    const { handler } = deps(null, []);
    const { step } = recordingStep();

    const result = await handler({
      event: { data: { slug: "rust", subject: "Rust" } },
      step,
    });
    expect(result.detail).toContain("could not build");
  });

  it("tolerates an event with no data at all", async () => {
    const { handler } = deps(null);
    const { step } = recordingStep();

    const result = await handler({ event: {}, step });
    expect(result.slug).toBe("");
    expect(result.status).toBe("failed");
  });
});

/** The registered evaluate function's own wiring to the real collaborators. */
const packStub = {
  slug: "photography",
  projects: [
    {
      slug: "p1",
      rubric: "r1",
      title: "A brief",
      brief: "do the thing",
      acceptanceCriteria: ["it exists"],
      targetSkills: ["s1"],
    },
  ],
  rubrics: [{ slug: "r1", version: 1, criteria: [] }],
  skills: [
    {
      slug: "s1",
      name: "A skill",
      evalTier: 2,
      bktPriors: { pInit: 0.1, pLearn: 0.2, pSlip: 0.1, pGuess: 0.2 },
    },
  ],
} as never;

let heldMastery: unknown[] = [];

let storedSubmission: unknown = {
  id: "s1",
  userId: "u1",
  packSlug: "photography",
  projectSlug: "p1",
  skillSlug: "s1",
  status: "queued",
  artefact: "some work",
  truncated: false,
};

let evaluationOutcome: unknown = {
  result: {
    overall: 0.8,
    confidence: 0.8,
    evalTier: 2,
    humanReview: false,
    observation: { correct: true, confidence: 0.8, evidenceTier: 2 },
    criteria: [],
    strengths: [],
    gaps: [],
    nextActions: [],
    bandSpread: 0,
    verification: { upheld: [], invalidated: [], missing: [], passed: true },
  },
  reason: null,
};

describe("the registered evaluate function", () => {
  const run = async () => {
    const ran: string[] = [];
    const result = await (
      evaluate as unknown as { fn: (c: unknown) => Promise<EvaluateResult> }
    ).fn({
      event: { data: { submissionId: "s1", userId: "u1" } },
      step: {
        run: async <T>(name: string, f: () => T | Promise<T>) => {
          ran.push(name);
          return f();
        },
      },
    });
    return { ran, result };
  };

  beforeEach(() => {
    heldMastery = [];
    submissionRows = [{ userId: "u1" }];
    storedSubmission = {
      id: "s1",
      userId: "u1",
      packSlug: "photography",
      projectSlug: "p1",
      skillSlug: "s1",
      status: "queued",
      artefact: "some work",
      truncated: false,
    };
    evaluationOutcome = {
      result: {
        overall: 0.8,
        confidence: 0.8,
        evalTier: 2,
        humanReview: false,
        observation: { correct: true, confidence: 0.8, evidenceTier: 2 },
        criteria: [],
        strengths: [],
        gaps: [],
        nextActions: [],
        bandSpread: 0,
        verification: { upheld: [], invalidated: [], missing: [], passed: true },
      },
      reason: null,
    };
  });

  it("marks a submission and records it", async () => {
    const { result } = await run();
    expect(result).toMatchObject({ submissionId: "s1", status: "complete" });
  });

  it("asks whether that hand-in finished the course", async () => {
    markAchievedMock.mockClear();
    await run();
    expect(markAchievedMock).toHaveBeenCalledTimes(1);
  });

  /** Nothing was marked, so nothing can have been proved by it. */
  it("does not ask when there was nothing to mark", async () => {
    markAchievedMock.mockClear();
    storedSubmission = undefined;
    await run();
    expect(markAchievedMock).not.toHaveBeenCalled();
  });

  it("moves the mastery the learner already had, rather than starting fresh", async () => {
    heldMastery = [
      {
        skillId: "s1",
        mastery: 0.4,
        confidence: 0.5,
        evidenceCount: 2,
        lastSuccessAt: null,
        lastPracticedAt: null,
        decayHalfLifeDays: 7,
      },
    ];
    expect((await run()).result.status).toBe("complete");
  });

  it("passes a human-review verdict through", async () => {
    (evaluationOutcome as { result: { humanReview: boolean } }).result.humanReview =
      true;
    expect((await run()).result.status).toBe("human_review");
  });

  it("fails a submission row that is not there", async () => {
    submissionRows = [];
    const { result } = await run();
    expect(result.status).toBe("failed");
  });

  it("fails when the work itself cannot be read back", async () => {
    storedSubmission = undefined;
    const { result } = await run();
    expect(result.reason).toContain("vanished");
  });

  it("fails when the brief it was handed in against has gone", async () => {
    // A pack edited under a queued submission is a deployment event, and the
    // learner is told rather than left waiting.
    storedSubmission = { ...(storedSubmission as object), projectSlug: "gone" };
    const { result } = await run();
    expect(result.reason).toContain("no longer available");
  });

  it("marks a submission failed rather than leaving it in grading", async () => {
    // §24 E8 — "never a silent loss". The fail closure is the half of that
    // which runs after the marker has already given up.
    evaluationOutcome = { result: null, reason: "nothing to quote" };
    const { ran } = await run();
    expect(ran).toContain("record-failure");
  });

  it("passes the marker's own reason through when it could not mark", async () => {
    evaluationOutcome = { result: null, reason: "nothing to quote" };
    const { result } = await run();
    expect(result.reason).toBe("nothing to quote");
  });

  it("says something rather than nothing when no reason came back", async () => {
    evaluationOutcome = { result: null, reason: null };
    const { result } = await run();
    expect(result.reason).toContain("could not be marked");
  });
});

describe("evaluateHandler", () => {
  const recordingStep = () => {
    const ran: string[] = [];
    return {
      ran,
      step: {
        run: async <T>(name: string, fn: () => T | Promise<T>) => {
          ran.push(name);
          return fn();
        },
      },
    };
  };

  const deps = (over: Partial<Parameters<typeof evaluateHandler>[0]> = {}) => {
    const failed: Array<{ id: string; reason: string }> = [];
    return {
      failed,
      handler: evaluateHandler({
        load: async () => ({ userId: "u1", ok: true, reason: null }),
        mark: async () => ({ status: "complete" as const, reason: null }),
        fail: async (id, reason) => {
          failed.push({ id, reason });
        },
        ...over,
      }),
    };
  };

  it("marks a submission and reports it complete", async () => {
    const { failed, handler } = deps();
    const { ran, step } = recordingStep();

    const result = await handler({ event: { data: { submissionId: "s1" } }, step });

    expect(result).toEqual({ submissionId: "s1", status: "complete", reason: null });
    expect(ran).toEqual(["load-submission", "mark"]);
    expect(failed).toEqual([]);
  });

  it("passes a human-review verdict through rather than flattening it", async () => {
    const { handler } = deps({
      mark: async () => ({ status: "human_review" as const, reason: null }),
    });
    const { step } = recordingStep();

    const result = await handler({ event: { data: { submissionId: "s1" } }, step });
    expect(result.status).toBe("human_review");
  });

  it("records a failure rather than leaving it stuck in grading", async () => {
    // §24 E8 — "never a silent loss".
    const { failed, handler } = deps({
      mark: async () => ({ status: "failed" as const, reason: "nothing to quote" }),
    });
    const { ran, step } = recordingStep();

    const result = await handler({ event: { data: { submissionId: "s1" } }, step });

    expect(result).toMatchObject({ status: "failed", reason: "nothing to quote" });
    expect(failed).toEqual([{ id: "s1", reason: "nothing to quote" }]);
    expect(ran).toEqual(["load-submission", "mark", "record-failure"]);
  });

  it("fails a submission that is not there without trying to mark it", async () => {
    const { failed, handler } = deps({
      load: async () => ({ userId: "", ok: false, reason: null }),
      mark: async () => {
        throw new Error("must not be called");
      },
    });
    const { ran, step } = recordingStep();

    const result = await handler({ event: { data: { submissionId: "gone" } }, step });

    expect(result.status).toBe("failed");
    expect(failed[0]!.reason).toContain("could not be found");
    expect(ran).toEqual(["load-submission", "record-missing"]);
  });

  it("uses the loader's own reason when it gives one", async () => {
    const { failed, handler } = deps({
      load: async () => ({ userId: "", ok: false, reason: "already marked" }),
    });
    const { step } = recordingStep();

    await handler({ event: { data: { submissionId: "s1" } }, step });
    expect(failed[0]!.reason).toBe("already marked");
  });

  it("tolerates an event with no data", async () => {
    const { handler } = deps();
    const { step } = recordingStep();

    const result = await handler({ event: {}, step });
    expect(result.submissionId).toBe("");
  });

  it("runs one marking per submission at a time", () => {
    // Two runs marking the same submission would both pay and both write.
    expect(evaluate.opts.concurrency).toMatchObject({
      key: "event.data.submissionId",
      limit: 1,
    });
    expect(evaluate.opts.triggers).toEqual([{ event: EVENTS.evaluate }]);
  });
});
