import { afterEach, describe, expect, it } from "vitest";
import {
  capture,
  getSinks,
  MemorySink,
  NoopSink,
  resolveSinks,
  setSinks,
} from "@/lib/observability";

afterEach(() => setSinks(undefined));

describe("resolveSinks", () => {
  it("disables every sink when no keys are configured", () => {
    // The whole point: a contributor can develop with no accounts at all.
    expect(resolveSinks({}).every((s) => !s.enabled)).toBe(true);
  });

  it("enables each sink independently on its own key", () => {
    const sinks = resolveSinks({
      NEXT_PUBLIC_POSTHOG_KEY: "phc_x",
      SENTRY_DSN: "",
      LANGFUSE_PUBLIC_KEY: "pk_x",
    });
    const byName = Object.fromEntries(sinks.map((s) => [s.name, s.enabled]));
    expect(byName).toEqual({ posthog: true, sentry: false, langfuse: true });
  });

  it("covers the three sinks §14.8 and §25 name", () => {
    expect(resolveSinks({}).map((s) => s.name).sort()).toEqual([
      "langfuse",
      "posthog",
      "sentry",
    ]);
  });

  it("reads the ambient environment by default", () => {
    expect(resolveSinks()).toHaveLength(3);
  });
});

describe("capture", () => {
  it("fans out to every enabled sink", () => {
    const a = new MemorySink();
    const b = new MemorySink();
    setSinks([a, b]);

    capture("first_evaluation_received", { tier: 1, confidence: 0.9 });

    for (const sink of [a, b]) {
      expect(sink.events).toEqual([
        {
          event: "first_evaluation_received",
          properties: { tier: 1, confidence: 0.9 },
        },
      ]);
    }
  });

  it("skips disabled sinks", () => {
    const enabled = new MemorySink();
    setSinks([enabled, new NoopSink("off", false)]);
    capture("page_viewed");
    expect(enabled.events).toHaveLength(1);
  });

  it("defaults properties to an empty object", () => {
    const sink = new MemorySink();
    setSinks([sink]);
    capture("session_started");
    expect(sink.events[0]!.properties).toEqual({});
  });

  it("builds the default sinks lazily when none are set", () => {
    setSinks(undefined);
    expect(getSinks()).toHaveLength(3);
    // Nothing is configured in the test environment, so this is a no-op —
    // the assertion is that it does not throw.
    expect(() => capture("page_viewed")).not.toThrow();
  });
});

describe("MemorySink", () => {
  it("records and clears", () => {
    const sink = new MemorySink();
    sink.capture("cta_clicked", { cta_id: "hero" });
    expect(sink.events).toHaveLength(1);
    sink.clear();
    expect(sink.events).toEqual([]);
  });
});

describe("NoopSink", () => {
  it("accepts events without recording anything", () => {
    const sink = new NoopSink("posthog", true);
    expect(sink.name).toBe("posthog");
    expect(sink.enabled).toBe(true);
    expect(() => sink.capture()).not.toThrow();
  });
});
