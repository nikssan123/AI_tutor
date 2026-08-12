import { describe, expect, it } from "vitest";
import { EVENTS, inngest } from "@/lib/inngest/client";
import { functions, ping, pingHandler } from "@/lib/inngest/functions";

describe("the Inngest client", () => {
  it("is registered under a stable app id", () => {
    // Changing this orphans in-flight runs, so it is pinned by a test.
    expect(inngest.id).toBe("online-uni");
  });

  it("names the four pipelines §14.9.1 describes", () => {
    expect(EVENTS).toEqual({
      ping: "system/ping",
      buildPath: "goal/path.requested",
      evaluate: "submission/evaluate.requested",
      planNightly: "planner/nightly.requested",
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
    expect(functions).toHaveLength(1);
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
