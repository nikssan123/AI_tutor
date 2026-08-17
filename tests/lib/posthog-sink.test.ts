import { describe, expect, it, vi } from "vitest";
import {
  ANONYMOUS_ACTOR,
  POSTHOG_HOST_DEFAULT,
  PosthogSink,
  posthogHost,
  posthogKey,
} from "@/lib/observability/posthog";

/**
 * The server half of §25.
 *
 * The assertions worth having here are about the two things that are easy to
 * get wrong and impossible to notice: which person an event lands on, and what
 * happens when the endpoint is broken. A funnel with every event on one id is
 * indistinguishable from a funnel with one very busy user, and an analytics
 * call that throws takes down a page that had already done its job.
 */

function spy(response: Promise<Response> = Promise.resolve(new Response("ok"))) {
  return vi.fn(() => response) as unknown as typeof fetch;
}

/** A stub `fetch` that records what it was asked to send. */
function recorder() {
  return vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response("ok")),
  );
}

/** The single call the sink made, parsed. */
function payloadOf(
  send: ReturnType<typeof recorder>,
): Record<string, unknown> {
  const init = send.mock.calls[0]![1];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("posthogKey", () => {
  it("is undefined when unset, and undefined when set to empty", () => {
    // The second case is the one that matters: `.env.example` ships the key as
    // a bare `NEXT_PUBLIC_POSTHOG_KEY=`, so every developer has it defined and
    // empty. `Boolean("")` is false, but a truthiness check written the other
    // way round would have handed `""` to `posthog.init`.
    expect(posthogKey({})).toBeUndefined();
    expect(posthogKey({ NEXT_PUBLIC_POSTHOG_KEY: "" })).toBeUndefined();
    expect(posthogKey({ NEXT_PUBLIC_POSTHOG_KEY: "phc_x" })).toBe("phc_x");
  });
});

describe("posthogHost", () => {
  it("defaults to the European region", () => {
    // /privacy tells readers their analytics goes to European servers. That
    // sentence is only true because of this default.
    expect(posthogHost({})).toBe(POSTHOG_HOST_DEFAULT);
    expect(POSTHOG_HOST_DEFAULT).toContain("eu.");
  });

  it("trims trailing slashes so the path is not doubled", () => {
    expect(posthogHost({ NEXT_PUBLIC_POSTHOG_HOST: "https://ph.test/" })).toBe(
      "https://ph.test",
    );
  });

  it("ignores an empty value rather than posting to a bare path", () => {
    expect(posthogHost({ NEXT_PUBLIC_POSTHOG_HOST: "" })).toBe(
      POSTHOG_HOST_DEFAULT,
    );
  });
});

describe("PosthogSink", () => {
  it("sends the event to the capture endpoint with the key", () => {
    const send = recorder();
    new PosthogSink("phc_x", "https://ph.test", send as unknown as typeof fetch).capture(
      "subscription_created",
      { plan: "pro" },
      "user-1",
    );

    expect(send.mock.calls[0]![0]).toBe("https://ph.test/i/v0/e/");

    const body = payloadOf(send);
    expect(body).toMatchObject({
      api_key: "phc_x",
      event: "subscription_created",
      distinct_id: "user-1",
      properties: { plan: "pro" },
    });
  });

  /**
   * The same id the browser sends from `posthog.identify`. Without this the
   * anonymous visit, the signup and the first mark are three different people.
   */
  it("attaches a person only when there is one", () => {
    const send = recorder();
    const sink = new PosthogSink(
      "phc_x",
      "https://ph.test",
      send as unknown as typeof fetch,
    );

    sink.capture("referral_visit", { code: "abc" });

    const body = payloadOf(send);
    expect(body.distinct_id).toBe(ANONYMOUS_ACTOR);
    // The flag is what keeps the person count from filling with ghosts nobody
    // can act on — one row per anonymous event otherwise.
    expect(body.properties).toMatchObject({ $process_person_profile: false });
  });

  it("does not mark an identified event as person-less", () => {
    const send = recorder();
    new PosthogSink("phc_x", "https://ph.test", send as unknown as typeof fetch).capture(
      "quota_reached",
      {},
      "user-1",
    );
    expect(payloadOf(send).properties).not.toHaveProperty(
      "$process_person_profile",
    );
  });

  it("stamps a timestamp, because the send is not awaited", () => {
    const send = recorder();
    new PosthogSink("phc_x", "https://ph.test", send as unknown as typeof fetch).capture(
      "session_started",
    );
    // A queued request that lands late must still be filed at the moment the
    // thing happened, not the moment PostHog got round to it.
    expect(Date.parse(String(payloadOf(send).timestamp))).not.toBeNaN();
  });

  /**
   * Every call site is in the middle of something the learner asked for.
   * Analytics being down must cost that nothing at all.
   */
  it("swallows a rejected send", async () => {
    const sink = new PosthogSink(
      "phc_x",
      "https://ph.test",
      spy(Promise.reject(new Error("network"))),
    );
    expect(() => sink.capture("evaluation_received")).not.toThrow();
    // Let the rejection settle; an unhandled one would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("swallows a send that throws before it returns a promise", async () => {
    const send = vi.fn(() => {
      throw new Error("no fetch in this runtime");
    }) as unknown as typeof fetch;
    const sink = new PosthogSink("phc_x", "https://ph.test", send);
    expect(() => sink.capture("evaluation_received")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("is always enabled — it only exists when a key was found", () => {
    const sink = new PosthogSink("phc_x", "https://ph.test", spy());
    expect(sink.name).toBe("posthog");
    expect(sink.enabled).toBe(true);
  });

  it("defaults to the real fetch when none is injected", () => {
    // Constructing it must not require a stub; `resolveSinks` builds it with
    // two arguments.
    expect(() => new PosthogSink("phc_x", "https://ph.test")).not.toThrow();
  });
});
