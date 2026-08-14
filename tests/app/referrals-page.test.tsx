// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { REWARD_DAYS } from "@/lib/referral/store";

/**
 * `/account/referrals`.
 *
 * Two of these assertions are about what the page refuses to do: it does not
 * list the addresses somebody invited, and it does not ship six share buttons.
 * Both are decisions rather than omissions, and both are the sort of thing a
 * later pass adds back without noticing.
 */

const requireUserMock = vi.fn();
const codeMock = vi.fn(async () => "abcd2345");
const summaryMock = vi.fn();

vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/account/session", () => ({
  requireUser: () => requireUserMock(),
}));
vi.mock("@/lib/referral/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/referral/store")>()),
  codeFor: (...a: unknown[]) => codeMock(...(a as [])),
  summaryFor: (...a: unknown[]) => summaryMock(...(a as [])),
}));

const { default: ReferralsPage } = await import(
  "@/app/(app)/account/referrals/page"
);

const empty = { invited: 0, paying: 0, rewardedDays: 0, recent: [] };

beforeEach(() => {
  requireUserMock.mockResolvedValue({ id: "u1" });
  codeMock.mockResolvedValue("abcd2345");
  summaryMock.mockResolvedValue(empty);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderPage = async () => render(await ReferralsPage());

describe("the link", () => {
  it("shows the whole URL, selectable", async () => {
    await renderPage();

    const field = screen.getByLabelText("Your referral link") as HTMLInputElement;
    expect(field.value).toContain("/r/abcd2345");
    expect(field.readOnly).toBe(true);
  });

  it("ships no share buttons", async () => {
    // Six third-party URL schemes to keep working, all reachable by pasting the
    // link that is already on the page.
    await renderPage();
    const text = document.body.textContent ?? "";
    for (const network of ["WhatsApp", "Telegram", "Messenger", "LinkedIn"]) {
      expect(text).not.toContain(network);
    }
  });
});

describe("how it is going", () => {
  it("says nothing has happened yet, without sounding like a failure", async () => {
    await renderPage();
    expect(screen.getByText(/Nobody yet/)).toBeTruthy();
  });

  it("counts signups, subscribers and days earned", async () => {
    summaryMock.mockResolvedValue({
      invited: 3,
      paying: 2,
      rewardedDays: REWARD_DAYS * 2,
      recent: [
        { name: "Bo", status: "rewarded", signupAt: new Date("2026-08-01") },
        { name: "Cy", status: "pending", signupAt: new Date("2026-08-02") },
      ],
    });
    await renderPage();

    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText(String(REWARD_DAYS * 2))).toBeTruthy();
    expect(screen.getByText("Bo")).toBeTruthy();
    expect(screen.getByText("Signed up")).toBeTruthy();
  });

  it("shows first names, never addresses", async () => {
    // A share page is not a contact export.
    summaryMock.mockResolvedValue({
      ...empty,
      invited: 1,
      recent: [
        { name: "Bo", status: "pending", signupAt: new Date("2026-08-01") },
      ],
    });
    await renderPage();

    expect(document.body.textContent).not.toMatch(/@/);
  });

  it("falls back to the raw status for one it has no phrase for", async () => {
    summaryMock.mockResolvedValue({
      ...empty,
      invited: 1,
      recent: [
        { name: "Bo", status: "surprising", signupAt: new Date("2026-08-01") },
      ],
    });
    await renderPage();
    expect(screen.getByText("surprising")).toBeTruthy();
  });
});

describe("the rules", () => {
  it("states that the reward comes on payment, not on signup", async () => {
    await renderPage();
    expect(
      screen.getByText(/not when they sign up/),
    ).toBeTruthy();
  });

  it("states that a refund takes both sides back", async () => {
    await renderPage();
    expect(screen.getByText(/both sets of days come back/)).toBeTruthy();
  });

  it("says self-referral does not work", async () => {
    await renderPage();
    expect(screen.getByText(/Inviting yourself does not work/)).toBeTruthy();
  });
});
