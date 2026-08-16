// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PlanCard } from "@/components/plan-card";
import { PLAN_COPY } from "@/lib/billing/plan-copy";
import { PLAN_IDS } from "@/lib/billing/catalog";

/**
 * What a learner is on.
 *
 * The assertions worth having are about what the card does *not* do: it never
 * grows a button that changes anything, and it never invents a renewal date for
 * an account that has no paid-for window. Both are `ASSISTANT-PLAN.md` §9.2 —
 * the surface that renders this can only read.
 */

afterEach(cleanup);

describe("PlanCard", () => {
  it("names the plan and says what it is for", () => {
    render(<PlanCard planId="pro" renewsOn={null} />);

    expect(screen.getByText(PLAN_COPY.pro.name)).toBeDefined();
    expect(screen.getByText(PLAN_COPY.pro.pitch)).toBeDefined();
  });

  it("lists what the plan includes, from the one place that wording lives", () => {
    render(<PlanCard planId="learner" renewsOn={null} />);

    for (const feature of PLAN_COPY.learner.features) {
      expect(screen.getByText(feature)).toBeDefined();
    }
  });

  /** A billing date wants the year and no weekday — the opposite of what a
      study date wants, which is why this is not `shortDate`. */
  it("says when the window ends, when there is one", () => {
    render(<PlanCard planId="pro" renewsOn="2026-10-01" />);

    expect(screen.getByText("Renews 1 October 2026")).toBeDefined();
    expect(screen.queryByText(/Thu/)).toBeNull();
  });

  /** No date at all rather than a date nobody can stand behind. */
  it("says nothing about renewal on an account with no window", () => {
    render(<PlanCard planId="free" renewsOn={null} />);
    expect(screen.queryByText(/Renews/)).toBeNull();
  });

  /**
   * §9.2 — the assistant cannot cancel, upgrade or refund, so the card ends at
   * a link. A button here would be the read-only surface growing an action.
   */
  it("ends at the billing page rather than at a control", () => {
    render(<PlanCard planId="pro" renewsOn={null} />);

    const link = screen.getByRole("link", { name: /Change or cancel it/ });
    expect(link.getAttribute("href")).toBe("/account/billing");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders every plan in the catalogue", () => {
    for (const planId of PLAN_IDS) {
      cleanup();
      render(<PlanCard planId={planId} renewsOn={null} />);
      expect(screen.getByText(PLAN_COPY[planId].name)).toBeDefined();
    }
  });
});
