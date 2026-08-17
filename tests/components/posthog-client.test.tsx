// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

/**
 * PostHog in the browser.
 *
 * The behaviour under test is not "does it send events" — that is the library's
 * job — but the three things around it that are ours, and that all fail
 * silently: it must not load for someone who has not agreed, it must not be
 * initialised twice, and signing out on a shared machine must not leave the
 * next person attached to the last person's id.
 */

const posthog = {
  init: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
};

vi.mock("posthog-js", () => ({ default: posthog }));

const { PostHogClient, resetPostHogForTests } = await import(
  "@/components/posthog-client"
);

/** Renders, then lets the dynamic import inside the effect settle. */
async function show(props: Parameters<typeof PostHogClient>[0]) {
  const result = render(<PostHogClient {...props} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

const consented = {
  consent: "granted",
  apiKey: "phc_test",
  apiHost: "https://ph.test",
  userId: undefined,
} as const;

beforeEach(() => {
  posthog.init.mockReset();
  posthog.identify.mockReset();
  posthog.reset.mockReset();
  resetPostHogForTests();
});

afterEach(cleanup);

describe("before the question is answered", () => {
  it("loads nothing at all", async () => {
    await show({ ...consented, consent: undefined });
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("loads nothing after a no", async () => {
    await show({ ...consented, consent: "denied" });
    expect(posthog.init).not.toHaveBeenCalled();
  });

  /**
   * The banner is not shown without a key, so this is the state of every deploy
   * until a PostHog project exists — and of every developer's machine.
   */
  it("loads nothing when no key is configured", async () => {
    await show({ ...consented, apiKey: undefined });
    expect(posthog.init).not.toHaveBeenCalled();
  });
});

describe("after a yes", () => {
  it("initialises once, with the configured host", async () => {
    await show(consented);
    expect(posthog.init).toHaveBeenCalledTimes(1);
    const [key, config] = posthog.init.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(key).toBe("phc_test");
    expect(config.api_host).toBe("https://ph.test");
  });

  /**
   * The cookie, not localStorage — and this is the line the promise on
   * /privacy rests on. Withdrawing consent is answered by a server action, and
   * a server can delete a cookie; it cannot reach into localStorage. Flip this
   * and "saying no deletes it" quietly becomes false.
   */
  it("keeps its id somewhere the server can delete", async () => {
    await show(consented);
    const [, config] = posthog.init.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(config.persistence).toBe("cookie");
    // And for no longer than the permission to hold it: 180 days, in days.
    expect(config.cookie_expiration).toBe(180);
  });

  /**
   * Both halves of the recording promise. `maskAllInputs` covers everything
   * typed anywhere; the selector is what `(app)/layout.tsx` marks its whole
   * tree with, so every signed-in screen is blanked without each one having to
   * remember.
   */
  it("records no typing, and no text inside the signed-in app", async () => {
    await show(consented);
    const [, config] = posthog.init.mock.calls[0] as [
      string,
      { session_recording: Record<string, unknown> },
    ];
    expect(config.session_recording.maskAllInputs).toBe(true);
    expect(config.session_recording.maskTextSelector).toBe("[data-private]");
  });

  it("does not initialise a second time on a re-render", async () => {
    const { rerender } = await show(consented);
    rerender(<PostHogClient {...consented} userId="u1" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(posthog.init).toHaveBeenCalledTimes(1);
  });
});

describe("who it thinks you are", () => {
  it("identifies a signed-in learner", async () => {
    await show({ ...consented, userId: "u1" });
    expect(posthog.identify).toHaveBeenCalledWith("u1");
  });

  /**
   * A client-side navigation can unmount and remount the layout subtree, which
   * runs the effect again for the same learner. Identifying on every one of
   * those is a request per navigation for a fact PostHog already has.
   */
  it("does not re-send an id that has not changed", async () => {
    await show({ ...consented, userId: "u1" });
    cleanup();
    await show({ ...consented, userId: "u1" });
    expect(posthog.identify).toHaveBeenCalledTimes(1);
  });

  it("identifies the new account when one learner replaces another", async () => {
    const { rerender } = await show({ ...consented, userId: "u1" });
    rerender(<PostHogClient {...consented} userId="u2" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(posthog.identify).toHaveBeenLastCalledWith("u2");
  });

  /**
   * A shared laptop. Signing out has to mint a fresh anonymous id, or the next
   * person's visit is filed against the last person's account.
   */
  it("resets on sign-out", async () => {
    const { rerender } = await show({ ...consented, userId: "u1" });
    rerender(<PostHogClient {...consented} userId={undefined} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });

  it("does not reset for a visitor who was never signed in", async () => {
    await show(consented);
    expect(posthog.reset).not.toHaveBeenCalled();
  });

  it("renders nothing into the page", async () => {
    const { container } = await show(consented);
    expect(container.innerHTML).toBe("");
  });
});
