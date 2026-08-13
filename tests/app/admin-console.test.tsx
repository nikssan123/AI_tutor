// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ConsoleSnapshot } from "@/lib/admin/console";

/**
 * `/admin` — the operator's console.
 *
 * The guard is stubbed here and tested for real in tests/lib/admin-guard.test.ts.
 * What these assert is the other half: that the page *calls* it, that it shows
 * the numbers it was given rather than a rounded story about them, and that it
 * stays read-only.
 */

const requireAdminMock = vi.fn();
const consoleSnapshotMock = vi.fn();

vi.mock("@/lib/admin/guard", () => ({
  requireAdmin: () => requireAdminMock(),
}));
vi.mock("@/lib/admin/console", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin/console")>(
      "@/lib/admin/console",
    );
  return { ...actual, consoleSnapshot: () => consoleSnapshotMock() };
});
vi.mock("@/db", () => ({ getDb: () => ({}) }));

const { default: AdminPage, formatCents, toneForStatus, metadata } =
  await import("@/app/admin/page");

function snapshot(overrides: Partial<ConsoleSnapshot> = {}): ConsoleSnapshot {
  return {
    spend: { todayCents: 1234, monthCents: 56789, cappedLearners: 2 },
    runs: {
      counts: [
        { status: "ok", runs: 40, costCents: 900 },
        { status: "failed", runs: 3, costCents: 120 },
      ],
      failures: [
        {
          id: "r1",
          agentName: "curriculum-architect",
          promptVersion: "3",
          model: "claude-opus-5",
          status: "failed",
          error: "overloaded_error",
          createdAt: new Date("2027-06-15T11:00:00.000Z"),
        },
      ],
    },
    learners: { total: 91, newThisWeek: 7, activeGoals: 55 },
    generatedAt: new Date("2027-06-15T12:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    userId: "u1",
    email: "admin@example.com",
    role: "admin",
  });
  consoleSnapshotMock.mockResolvedValue(snapshot());
});

afterEach(cleanup);

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [1, "$0.01"],
    [1234, "$12.34"],
    // Model calls cost fractions of a cent, which is why the column is `real`.
    [0.4, "$0.00"],
    [56789, "$567.89"],
  ])("renders %d cents as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});

describe("toneForStatus", () => {
  it("treats a refusal as attention, not failure", () => {
    // A refusal is the model declining, not the system breaking. Colouring it
    // red would train the operator to ignore red.
    expect(toneForStatus("refusal")).toBe("attention");
  });

  it.each([["ok", "verified"], ["failed", "problem"], ["schema_invalid", "problem"]])(
    "maps %s to %s",
    (status, tone) => {
      expect(toneForStatus(status)).toBe(tone);
    },
  );
});

describe("/admin", () => {
  it("is guarded", async () => {
    render(await AdminPage());
    expect(requireAdminMock).toHaveBeenCalledTimes(1);
  });

  it("does not render when the guard rejects", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    // The snapshot query must not have run — a guard that fires after the data
    // is fetched has already lost.
    expect(consoleSnapshotMock).not.toHaveBeenCalled();
  });

  it("is noindexed in its own right as well as by the layout", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("shows spend as money, both windows", async () => {
    render(await AdminPage());
    expect(screen.getByText("$12.34")).toBeDefined();
    expect(screen.getByText("$567.89")).toBeDefined();
  });

  it("names how many learners have hit their cap", async () => {
    render(await AdminPage());
    expect(screen.getByText("Learners at their cap")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
  });

  it("breaks runs down by status", async () => {
    render(await AdminPage());
    expect(screen.getByText("ok")).toBeDefined();
    expect(screen.getByText("40")).toBeDefined();
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
  });

  it("lists the failure with the agent and prompt version that caused it", async () => {
    render(await AdminPage());
    expect(screen.getByText(/curriculum-architect/)).toBeDefined();
    expect(screen.getByText(/v3 · claude-opus-5/)).toBeDefined();
    expect(screen.getByText("overloaded_error")).toBeDefined();
  });

  it("says so when a failure carried no error text", async () => {
    const base = snapshot();
    consoleSnapshotMock.mockResolvedValue({
      ...base,
      runs: {
        ...base.runs,
        failures: [{ ...base.runs.failures[0]!, error: null }],
      },
    });
    render(await AdminPage());
    expect(screen.getByText("No error recorded.")).toBeDefined();
  });

  it("shows an empty state rather than a wall of zeroes when nothing ran", async () => {
    consoleSnapshotMock.mockResolvedValue(
      snapshot({ runs: { counts: [], failures: [] } }),
    );
    render(await AdminPage());
    expect(screen.getByText(/No model calls in the last 24 hours/)).toBeDefined();
  });

  it("omits the failure list when every run succeeded", async () => {
    consoleSnapshotMock.mockResolvedValue(
      snapshot({
        runs: { counts: [{ status: "ok", runs: 5, costCents: 10 }], failures: [] },
      }),
    );
    render(await AdminPage());
    expect(screen.getByText("ok")).toBeDefined();
    expect(screen.queryByText("overloaded_error")).toBeNull();
  });

  it("shows the learner counts", async () => {
    render(await AdminPage());
    expect(screen.getByText("91")).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
    expect(screen.getByText("55")).toBeDefined();
  });

  it("stamps when the numbers were taken, in UTC", async () => {
    render(await AdminPage());
    expect(screen.getByText("2027-06-15 12:00")).toBeDefined();
  });

  it("stays read-only — no buttons, no forms", async () => {
    // The scope choice that makes this page safe. A console with no writes has
    // no CSRF surface and needs no audit log; the day it grows a button, both
    // become required.
    const { container } = render(await AdminPage());
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });
});
