// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AuditRow } from "@/lib/admin/audit";

/**
 * The audit log's screen.
 *
 * The interesting assertion is the one about refusals: a log that only shows
 * what worked cannot tell a quiet system from a thwarted one, so a `denied`
 * row has to be as visible as an `ok` one.
 */

const requireAdminMock = vi.fn();
const listAuditMock = vi.fn();

vi.mock("@/lib/admin/guard", () => ({
  requireAdmin: () => requireAdminMock(),
}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/admin/audit", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin/audit")>(
      "@/lib/admin/audit",
    );
  return { ...actual, listAudit: (...args: unknown[]) => listAuditMock(...args) };
});

const { default: AuditPage, summarize, toneForOutcome } = await import(
  "@/app/admin/audit/page"
);

function entry(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "a1",
    actorEmail: "admin@example.com",
    action: "sql.read",
    target: null,
    detail: { query: "select 1" },
    outcome: "ok",
    error: null,
    durationMs: 7,
    rowCount: 1,
    createdAt: new Date("2027-06-15T12:00:00.000Z"),
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
  listAuditMock.mockResolvedValue([entry()]);
});

afterEach(cleanup);

describe("toneForOutcome", () => {
  it.each([
    ["ok", "verified"],
    ["denied", "attention"],
    ["error", "problem"],
  ])("%s → %s", (outcome, tone) => {
    expect(toneForOutcome(outcome)).toBe(tone);
  });
});

describe("summarize", () => {
  it("shows the statement for a SQL entry", () => {
    expect(summarize({ query: "select 1" })).toBe("select 1");
  });

  it("shows the change for a quick action", () => {
    expect(summarize({ from: "free", to: "pro" })).toBe(
      '{"from":"free","to":"pro"}',
    );
  });

  it("shows nothing when there is no detail", () => {
    expect(summarize(null)).toBe("");
    expect(summarize(undefined)).toBe("");
  });
});

describe("/admin/audit", () => {
  it("requires an admin", async () => {
    render(await AuditPage());
    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("refuses to render for a non-admin", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(AuditPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows the statement that was run", async () => {
    render(await AuditPage());

    expect(screen.getByText("select 1")).toBeDefined();
    expect(screen.getByText("admin@example.com")).toBeDefined();
    expect(screen.getByText("2027-06-15 12:00:00")).toBeDefined();
  });

  it("shows a refusal and why", async () => {
    listAuditMock.mockResolvedValue([
      entry({
        action: "user.delete",
        outcome: "denied",
        target: "victim@example.com",
        error: "The email you typed does not match this account.",
        detail: null,
      }),
    ]);

    render(await AuditPage());

    expect(screen.getByText("denied")).toBeDefined();
    expect(screen.getByText(/does not match/)).toBeDefined();
  });

  it("prefers the error over the detail when both exist", async () => {
    listAuditMock.mockResolvedValue([
      entry({ outcome: "error", error: "syntax error" }),
    ]);

    render(await AuditPage());

    expect(screen.getByText("syntax error")).toBeDefined();
    expect(screen.queryByText("select 1")).toBeNull();
  });

  it("renders a null duration as null rather than blank", async () => {
    listAuditMock.mockResolvedValue([
      entry({ durationMs: null, rowCount: null }),
    ]);

    render(await AuditPage());
    expect(screen.getAllByText("null").length).toBeGreaterThanOrEqual(2);
  });

  it("says so when nothing has happened yet", async () => {
    listAuditMock.mockResolvedValue([]);
    render(await AuditPage());

    expect(
      screen.getByText("Nothing has been done through the admin console yet."),
    ).toBeDefined();
  });

  it("counts the entries when there are few", async () => {
    render(await AuditPage());
    expect(screen.getByText("1 entries")).toBeDefined();
  });

  it("says it is showing the latest page when the log is full", async () => {
    const { AUDIT_PAGE_SIZE } = await import("@/lib/admin/audit");
    listAuditMock.mockResolvedValue(
      Array.from({ length: AUDIT_PAGE_SIZE }, (_, i) =>
        entry({ id: `a${i}` }),
      ),
    );

    render(await AuditPage());
    expect(screen.getByText(`Latest ${AUDIT_PAGE_SIZE}`)).toBeDefined();
  });
});
