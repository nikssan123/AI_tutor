import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The action behind the SQL console.
 *
 * This is a public POST endpoint whatever the page around it looked like, so
 * the first assertion is that it establishes who is calling before it does
 * anything. The rest is about the audit log: it must record the attempt, not
 * merely the successes, and it must be written on a connection the console
 * cannot roll back or reach.
 */

const requireAdminMock = vi.fn();
const runQueryMock = vi.fn();
const recordAuditMock = vi.fn();
const getConsoleConnectionMock = vi.fn();
const appDb = { marker: "application-connection" };

vi.mock("@/lib/admin/guard", () => ({
  requireAdmin: () => requireAdminMock(),
}));
vi.mock("@/db", () => ({ getDb: () => appDb }));
vi.mock("@/lib/admin/console-db", () => ({
  getConsoleConnection: () => getConsoleConnectionMock(),
}));
vi.mock("@/lib/admin/audit", () => ({
  recordAudit: (...args: unknown[]) => recordAuditMock(...args),
}));
vi.mock("@/lib/admin/sql", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin/sql")>("@/lib/admin/sql");
  return { ...actual, runQuery: (...args: unknown[]) => runQueryMock(...args) };
});

const { runQueryAction } = await import("@/app/admin/sql/actions");

const INITIAL = { outcome: null, query: "", allowWrites: false };
const consoleRunner = { marker: "console-connection" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    userId: "u1",
    email: "admin@example.com",
    role: "admin",
  });
  getConsoleConnectionMock.mockReturnValue({
    runner: consoleRunner,
    leastPrivilege: true,
    database: "online_uni",
  });
  runQueryMock.mockResolvedValue({
    ok: true,
    columns: ["n"],
    rows: [["1"]],
    rowCount: 1,
    truncated: false,
    durationMs: 7,
    redacted: [],
  });
});

describe("runQueryAction", () => {
  it("establishes the caller before running anything", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(
      runQueryAction(INITIAL, form({ query: "select 1" })),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(runQueryMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("runs read-only by default", async () => {
    await runQueryAction(INITIAL, form({ query: "select 1" }));

    expect(runQueryMock).toHaveBeenCalledWith(consoleRunner, "select 1", false);
  });

  it("echoes the query back so the textarea survives", async () => {
    const state = await runQueryAction(INITIAL, form({ query: "select 1" }));
    expect(state.query).toBe("select 1");
  });

  it("treats a missing query as empty rather than crashing", async () => {
    await runQueryAction(INITIAL, form({}));
    expect(runQueryMock).toHaveBeenCalledWith(consoleRunner, "", false);
  });

  it("logs a successful read with its cost", async () => {
    await runQueryAction(INITIAL, form({ query: "select 1" }));

    expect(recordAuditMock).toHaveBeenCalledWith(appDb, {
      actorId: "u1",
      actorEmail: "admin@example.com",
      action: "sql.read",
      detail: { query: "select 1" },
      outcome: "ok",
      error: null,
      durationMs: 7,
      rowCount: 1,
    });
  });

  it("writes the audit row on the application connection, not the console's", async () => {
    // The console's transaction rolls back in read mode and would take the
    // log entry with it, and the console role has no grant to write the table.
    await runQueryAction(INITIAL, form({ query: "select 1" }));

    expect(recordAuditMock.mock.calls[0]![0]).toBe(appDb);
    expect(recordAuditMock.mock.calls[0]![0]).not.toBe(consoleRunner);
  });

  it("logs a failure as an error, with the message", async () => {
    runQueryMock.mockResolvedValue({
      ok: false,
      error: "syntax error",
      durationMs: 2,
    });

    await runQueryAction(INITIAL, form({ query: "slect 1" }));

    expect(recordAuditMock).toHaveBeenCalledWith(
      appDb,
      expect.objectContaining({
        outcome: "error",
        error: "syntax error",
        rowCount: null,
      }),
    );
  });

  describe("write mode", () => {
    const writeForm = (confirm: string) =>
      form({ query: "delete from t", allowWrites: "on", confirm });

    it("runs when the database name is typed", async () => {
      const state = await runQueryAction(INITIAL, writeForm("online_uni"));

      expect(runQueryMock).toHaveBeenCalledWith(
        consoleRunner,
        "delete from t",
        true,
      );
      expect(state.allowWrites).toBe(true);
    });

    it("accepts a differently-cased or padded name", async () => {
      await runQueryAction(INITIAL, writeForm("  ONLINE_UNI "));
      expect(runQueryMock).toHaveBeenCalled();
    });

    it("refuses without the confirmation, and runs nothing", async () => {
      const state = await runQueryAction(INITIAL, writeForm("wrong"));

      expect(runQueryMock).not.toHaveBeenCalled();
      expect(state.outcome).toMatchObject({ ok: false });
      expect(state.outcome?.ok === false && state.outcome.error).toMatch(
        /Nothing was executed/,
      );
    });

    it("refuses when the confirmation is missing entirely", async () => {
      // The checkbox and the field are both just strings in a POST body that
      // anyone with an admin cookie can assemble by hand.
      await runQueryAction(
        INITIAL,
        form({ query: "delete from t", allowWrites: "on" }),
      );

      expect(runQueryMock).not.toHaveBeenCalled();
    });

    it("logs the refusal as denied, with the statement that was not run", async () => {
      await runQueryAction(INITIAL, writeForm("wrong"));

      expect(recordAuditMock).toHaveBeenCalledWith(
        appDb,
        expect.objectContaining({
          action: "sql.write",
          outcome: "denied",
          detail: { query: "delete from t" },
        }),
      );
    });

    it("logs a write under its own action name", async () => {
      await runQueryAction(INITIAL, writeForm("online_uni"));

      expect(recordAuditMock).toHaveBeenCalledWith(
        appDb,
        expect.objectContaining({ action: "sql.write" }),
      );
    });

    it("is not entered by a checkbox value other than on", async () => {
      await runQueryAction(
        INITIAL,
        form({ query: "select 1", allowWrites: "true", confirm: "" }),
      );

      expect(runQueryMock).toHaveBeenCalledWith(
        consoleRunner,
        "select 1",
        false,
      );
    });
  });
});
