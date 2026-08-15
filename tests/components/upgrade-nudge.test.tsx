// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Nudge } from "@/lib/billing/nudge";

/**
 * The one way this product asks somebody to pay from inside the app.
 *
 * Two things are worth guarding and neither is the markup: that `paywall_viewed`
 * is emitted from exactly one place, and that the ask is never the loudest thing
 * on the screen it appears on.
 */

const captureMock = vi.fn();

vi.mock("@/lib/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability")>()),
  capture: (...a: unknown[]) => captureMock(...(a as [])),
}));

const { UpgradeNudge } = await import("@/components/upgrade-nudge");

const nudge: Nudge = {
  reason: "evaluation_landed",
  headline: "That was this month's graded project",
  body: "Pro marks ten a month against the same public rubrics.",
  cta: "See what Pro includes",
  href: "/pricing",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UpgradeNudge", () => {
  it("shows what happened, what a paid plan does, and the way there", () => {
    render(<UpgradeNudge nudge={nudge} />);

    expect(screen.getByRole("heading", { name: nudge.headline })).toBeTruthy();
    expect(screen.getByText(nudge.body)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: nudge.cta }).getAttribute("href"),
    ).toBe("/pricing");
  });

  it("records the paywall being seen, with what triggered it", () => {
    // §25.1's `paywall_viewed`. Emitted here rather than at each call site,
    // because an event fired from four places is one whose count nobody can
    // trust.
    render(<UpgradeNudge nudge={nudge} />);

    expect(captureMock).toHaveBeenCalledWith("paywall_viewed", {
      trigger: "evaluation_landed",
    });
  });

  it("records it once per render, not once per element", () => {
    render(<UpgradeNudge nudge={nudge} />);
    expect(captureMock).toHaveBeenCalledOnce();
  });

  it("is never the loudest thing on the screen", () => {
    // §8.5.5 allows one filled button per screen and it is never this one: the
    // primary action on a session screen is the session. A learner who has just
    // been told they ran out is already paying attention.
    render(<UpgradeNudge nudge={nudge} />);

    const cta = screen.getByRole("link", { name: nudge.cta });
    expect(cta.className).not.toContain("text-on-accent");
  });
});
