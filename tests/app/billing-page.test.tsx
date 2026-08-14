// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CANCELLATION_REASONS } from "@/db/schema";
import { PLANS } from "@/lib/billing/catalog";

/**
 * `/account/billing`.
 *
 * The assertions worth having are about the sentences. This screen exists to
 * answer "what am I on, what does it cost, when does it stop" without making
 * anyone read a database column — so the tests check the copy says the
 * consequence rather than the mechanism, and that cancelling cannot happen
 * without the one answer §25.1 marks mandatory.
 */

const requireUserMock = vi.fn();
const subscriptionMock = vi.fn();
const entitlementsMock = vi.fn();
const usedMock = vi.fn(async () => 0);
const remainingMock = vi.fn(async () => 10);

vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/account/session", () => ({
  requireUser: () => requireUserMock(),
}));
vi.mock("@/lib/billing/store", () => ({
  latestSubscription: (...a: unknown[]) => subscriptionMock(...(a as [])),
  entitlementsForUser: (...a: unknown[]) => entitlementsMock(...(a as [])),
}));
vi.mock("@/lib/billing/quota", () => ({
  evaluationsUsed: (...a: unknown[]) => usedMock(...(a as [])),
  evaluationsRemaining: (...a: unknown[]) => remainingMock(...(a as [])),
}));
vi.mock("@/app/(app)/account/billing/actions", () => ({
  cancelSubscriptionAction: async () => undefined,
  openPortalAction: async () => undefined,
  resumeSubscriptionAction: async () => undefined,
}));

const { default: BillingPage } = await import(
  "@/app/(app)/account/billing/page"
);

const PERIOD_END = new Date("2026-08-20T00:00:00.000Z");

const resolved = (over: Record<string, unknown> = {}) => ({
  planId: "pro",
  entitlements: PLANS.pro.entitlements,
  spendCapCents: PLANS.pro.spendCapCents,
  source: "subscription",
  ...over,
});

const subscription = (over: Record<string, unknown> = {}) => ({
  id: "sub-row",
  userId: "u1",
  stripeSubscriptionId: "sub_1",
  stripeCustomerId: "cus_1",
  planId: "pro",
  interval: "month",
  currency: "eur",
  amountCents: 2_499,
  status: "active",
  currentPeriodEnd: PERIOD_END,
  cancelAtPeriodEnd: false,
  trialEndsAt: null,
  endedAt: null,
  ...over,
});

beforeEach(() => {
  requireUserMock.mockResolvedValue({ id: "u1", plan: "pro" });
  subscriptionMock.mockResolvedValue(subscription());
  entitlementsMock.mockResolvedValue(resolved());
  usedMock.mockResolvedValue(0);
  remainingMock.mockResolvedValue(10);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const params = (value: Record<string, string> = {}) => Promise.resolve(value);

async function renderPage(search: Record<string, string> = {}) {
  render(await BillingPage({ searchParams: params(search) }));
}

describe("what you are on", () => {
  it("names the plan, the price and the renewal date", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: "Pro" })).toBeTruthy();
    expect(screen.getByText(/€24\.99 a month/)).toBeTruthy();
    expect(screen.getByText(/renews 20 August/)).toBeTruthy();
  });

  it("says what is left this month", async () => {
    remainingMock.mockResolvedValue(7);
    usedMock.mockResolvedValue(3);
    await renderPage();

    expect(screen.getByText(/7 of 10 graded projects left this month/)).toBeTruthy();
    expect(screen.getByText(/Used 3 so far/)).toBeTruthy();
  });

  it("says so plainly when the month is spent", async () => {
    remainingMock.mockResolvedValue(0);
    usedMock.mockResolvedValue(10);
    await renderPage();

    expect(
      screen.getByText(/used all 10 of this month's graded projects/),
    ).toBeTruthy();
  });

  it("uses the singular when a one-evaluation plan is spent", async () => {
    entitlementsMock.mockResolvedValue(
      resolved({ planId: "free", entitlements: PLANS.free.entitlements, source: "plan" }),
    );
    subscriptionMock.mockResolvedValue(undefined);
    remainingMock.mockResolvedValue(0);
    usedMock.mockResolvedValue(1);
    await renderPage();

    expect(
      screen.getByText(/used all 1 of this month's graded project\./),
    ).toBeTruthy();
  });

  it("uses the singular for a plan with one evaluation", async () => {
    entitlementsMock.mockResolvedValue(
      resolved({ planId: "free", entitlements: PLANS.free.entitlements, source: "plan" }),
    );
    subscriptionMock.mockResolvedValue(undefined);
    remainingMock.mockResolvedValue(1);
    await renderPage();

    expect(screen.getByText(/1 of 1 graded project left this month/)).toBeTruthy();
  });

  it("tells a free account it is free, and points at the plans", async () => {
    entitlementsMock.mockResolvedValue(
      resolved({ planId: "free", entitlements: PLANS.free.entitlements, source: "plan" }),
    );
    subscriptionMock.mockResolvedValue(undefined);
    await renderPage();

    expect(screen.getByText("Free, for as long as you like.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "See the plans" }).getAttribute("href"),
    ).toBe("/pricing");
  });

  it("says a year when the subscription is annual", async () => {
    subscriptionMock.mockResolvedValue(
      subscription({ interval: "year", amountCents: 19_900 }),
    );
    await renderPage();
    expect(screen.getByText(/€199 a year/)).toBeTruthy();
  });

  it("does not say 'used 0 so far'", async () => {
    await renderPage();
    expect(document.body.textContent).not.toMatch(/Used 0 so far/);
  });

  it("explains a referral grant as costing nothing", async () => {
    entitlementsMock.mockResolvedValue(resolved({ source: "grant" }));
    subscriptionMock.mockResolvedValue(undefined);
    await renderPage();

    expect(screen.getByText(/from a referral/)).toBeTruthy();
  });
});

describe("a cancellation that has not taken effect", () => {
  beforeEach(() => {
    subscriptionMock.mockResolvedValue(subscription({ cancelAtPeriodEnd: true }));
  });

  it("says what you still have, and until when", async () => {
    // The memory note on user copy: the consequence, never the mechanism.
    await renderPage();

    expect(screen.getByText(/you still have Pro until 20 August/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/cancel_at_period_end/);
  });

  it("offers a way back", async () => {
    await renderPage();
    expect(
      screen.getByRole("button", { name: "Keep my subscription" }),
    ).toBeTruthy();
  });

  it("does not offer to cancel twice", async () => {
    await renderPage();
    expect(screen.queryByRole("link", { name: "Cancel" })).toBeNull();
  });
});

describe("the exit survey", () => {
  it("is not shown until asked for", async () => {
    await renderPage();
    expect(screen.queryByText("Before you go")).toBeNull();
  });

  it("asks the one question §25.1 makes mandatory", async () => {
    await renderPage({ cancel: "1" });

    expect(screen.getByText("Why are you leaving?")).toBeTruthy();
    for (const reason of CANCELLATION_REASONS) {
      const input = document.querySelector(`input[value="${reason}"]`);
      expect(input).toBeTruthy();
      // Required at the markup level, so the browser refuses before the action
      // has to.
      expect(input!.hasAttribute("required")).toBe(true);
    }
  });

  it("says what happens after cancelling, before it happens", async () => {
    await renderPage({ cancel: "1" });
    expect(screen.getByText(/keep Pro until 20 August/)).toBeTruthy();
  });

  it("offers a way out of the way out", async () => {
    await renderPage({ cancel: "1" });
    expect(screen.getByRole("link", { name: "Never mind" })).toBeTruthy();
  });
});

describe("status messages", () => {
  it("shows an outcome from the query string", async () => {
    await renderPage({ ok: "Cancelled." });
    expect(screen.getByText("Cancelled.")).toBeTruthy();
  });

  it("shows a refusal from the query string", async () => {
    await renderPage({ error: "There is no subscription to cancel." });
    expect(screen.getByText("There is no subscription to cancel.")).toBeTruthy();
  });
});

describe("the upgrade nudge", () => {
  it("is absent on Pro", async () => {
    await renderPage();
    expect(screen.queryByText("More graded work")).toBeNull();
  });

  it("is present below it", async () => {
    entitlementsMock.mockResolvedValue(
      resolved({ planId: "learner", entitlements: PLANS.learner.entitlements }),
    );
    await renderPage();
    expect(screen.getByText("More graded work")).toBeTruthy();
  });
});
