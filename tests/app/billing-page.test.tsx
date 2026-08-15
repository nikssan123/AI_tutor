// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CANCELLATION_REASONS } from "@/db/schema";
import { PLANS } from "@/lib/billing/catalog";
import { PLAN_COPY } from "@/lib/billing/plan-copy";

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

  it("makes what is left the loudest thing on the screen", async () => {
    remainingMock.mockResolvedValue(7);
    await renderPage();

    // The `Figure` — the one number a learner opens this page to check.
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("of 10")).toBeTruthy();
    expect(screen.getByText("graded projects left this month")).toBeTruthy();
  });

  it("says so plainly when the month is spent", async () => {
    remainingMock.mockResolvedValue(0);
    await renderPage();

    expect(
      screen.getByText(/used all 10 of this month's graded projects/),
    ).toBeTruthy();
  });

  it("says when the count starts again", async () => {
    // Not "monthly": somebody who has just run out has to know whether that
    // means days or weeks.
    remainingMock.mockResolvedValue(0);
    await renderPage();

    const reset = new Date();
    const next = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
    }).format(
      new Date(Date.UTC(reset.getUTCFullYear(), reset.getUTCMonth() + 1, 1)),
    );

    expect(
      screen.getByText(new RegExp(`count starts again on ${next}`)),
    ).toBeTruthy();
  });

  it("does not meter what it does not meter", async () => {
    // Pro puts no ceiling on sessions, so the flat claim is true here.
    await renderPage();
    expect(
      screen.getByText(/Lessons, practice and the tutor are not metered/),
    ).toBeTruthy();
  });

  it("does not tell a capped plan its sessions are unmetered", async () => {
    // Free is three learning sessions a month. Telling somebody their sessions
    // are unmetered and then turning them away on the fourth is the worst way
    // to get this wrong, so the sentence reads the plan rather than asserting
    // over all of them.
    entitlementsMock.mockResolvedValue(
      resolved({ planId: "free", entitlements: PLANS.free.entitlements, source: "plan" }),
    );
    subscriptionMock.mockResolvedValue(undefined);
    remainingMock.mockResolvedValue(1);
    await renderPage();

    expect(document.body.textContent).not.toMatch(/the tutor are not metered/);
    expect(
      screen.getByText(
        new RegExp(
          `Free also covers ${PLANS.free.entitlements.sessionsPerMonth} learning sessions a month`,
        ),
      ),
    ).toBeTruthy();
  });

  it("uses the singular when a one-evaluation plan is spent", async () => {
    entitlementsMock.mockResolvedValue(
      resolved({ planId: "free", entitlements: PLANS.free.entitlements, source: "plan" }),
    );
    subscriptionMock.mockResolvedValue(undefined);
    remainingMock.mockResolvedValue(0);
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

    expect(screen.getByText("graded project left this month")).toBeTruthy();
  });

  it("lists what the plan actually includes", async () => {
    // Read from `PLAN_COPY`, so a card that claims a quota the meter does not
    // allow fails here rather than in a refund.
    await renderPage();

    expect(
      screen.getByRole("heading", { name: "What Pro gives you" }),
    ).toBeTruthy();
    for (const feature of PLAN_COPY.pro.features) {
      expect(screen.getByText(feature)).toBeTruthy();
    }
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

  it("explains a referral grant as costing nothing", async () => {
    entitlementsMock.mockResolvedValue(resolved({ source: "grant" }));
    subscriptionMock.mockResolvedValue(undefined);
    await renderPage();

    expect(screen.getByText(/from a referral/)).toBeTruthy();
  });

  it("still says when it renews if the currency is one we do not sell in", async () => {
    // The column is plain text written from Stripe. Dropping the money is the
    // right failure — the date is still true, and still what somebody came for.
    subscriptionMock.mockResolvedValue(subscription({ currency: "gbp" }));
    await renderPage();

    expect(screen.getByText("renews 20 August")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Free, for as long as/);
  });
});

describe("a payment that failed", () => {
  beforeEach(() => {
    subscriptionMock.mockResolvedValue(subscription({ status: "past_due" }));
  });

  it("says nothing has stopped yet, and what to do", async () => {
    // §5's fourteen-day grace: the card failed, the account still works. The
    // useful thing this screen can do is say so before it stops.
    await renderPage();

    expect(
      screen.getByRole("heading", { name: /last payment did not go through/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update your card" })).toBeTruthy();
  });

  it("is the one state that gets the filled button", async () => {
    await renderPage();

    const filled = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("text-on-accent"));
    expect(filled).toHaveLength(1);
    expect(filled[0]!.textContent).toBe("Update your card");
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
