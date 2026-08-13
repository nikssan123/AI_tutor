import { describe, expect, it, vi } from "vitest";
import { EVENTS, inngest } from "@/lib/inngest/client";
import {
  buildPack,
  buildPackHandler,
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
    expect(functions).toHaveLength(2);
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
vi.mock("@/db", () => ({ getDb: () => ({ db: true }) }));
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
    expect(generatePack).toHaveBeenCalledWith(
      { client: { client: true }, db: { db: true }, userId: "u1" },
      { slug: "rust", subject: "Rust", rawGoal: null },
    );
    expect(seedPack).toHaveBeenCalledWith({ db: true }, { slug: "rust" });
    expect(finishBuild).toHaveBeenCalledWith({ db: true }, "rust", {
      status: "ready",
    });
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
