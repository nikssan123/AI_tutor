// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MAX_ROWS } from "@/lib/admin/sql";
import { REDACTED } from "@/lib/admin/tables";

/**
 * The SQL console's screen.
 *
 * The engine is tested in tests/lib/admin-sql.test.ts and the guard in
 * tests/lib/admin-guard.test.ts. What these assert is what the operator is
 * told: that read mode says it is read mode, that write mode cannot be reached
 * without typing the database's name, and that the fallback connection admits
 * to being the fallback rather than looking like the hardened path.
 */

const requireAdminMock = vi.fn();
const getConsoleConnectionMock = vi.fn();
const runQueryActionMock = vi.fn();

vi.mock("@/lib/admin/guard", () => ({
  requireAdmin: () => requireAdminMock(),
}));
vi.mock("@/lib/admin/console-db", () => ({
  getConsoleConnection: () => getConsoleConnectionMock(),
}));
vi.mock("@/app/admin/sql/actions", () => ({
  runQueryAction: (...args: unknown[]) => runQueryActionMock(...args),
}));

const { default: SqlPage } = await import("@/app/admin/sql/page");
const { ConsoleForm, Result } = await import(
  "@/app/admin/sql/console-form"
);

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    userId: "u1",
    email: "admin@example.com",
    role: "admin",
  });
  getConsoleConnectionMock.mockReturnValue({
    runner: {},
    leastPrivilege: true,
    database: "online_uni",
  });
});

afterEach(cleanup);

describe("/admin/sql", () => {
  it("requires an admin", async () => {
    render(await SqlPage());
    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("refuses to render for a non-admin", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(SqlPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("names the database, the timeout and the row cap", async () => {
    render(await SqlPage());

    expect(screen.getByText("online_uni")).toBeDefined();
    expect(screen.getByText("5s timeout")).toBeDefined();
    expect(screen.getByText(`${MAX_ROWS} rows max`)).toBeDefined();
  });

  it("links to the audit log, so the logging is not a surprise", async () => {
    render(await SqlPage());

    expect(
      screen
        .getByRole("link", { name: /logged/ })
        .getAttribute("href"),
    ).toBe("/admin/audit");
  });
});

describe("ConsoleForm", () => {
  const setup = (leastPrivilege = true) =>
    render(
      <ConsoleForm database="online_uni" leastPrivilege={leastPrivilege} />,
    );

  it("says the transaction is read-only by default", () => {
    setup();

    expect(screen.getByText(/BEGIN READ ONLY/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Run" })).toBeDefined();
  });

  it("asks nothing extra while it is read-only", () => {
    setup();
    expect(screen.queryByText(/to confirm/)).toBeNull();
  });

  it("demands the database's name once writes are enabled", () => {
    setup();

    fireEvent.click(screen.getByRole("checkbox"));

    expect(screen.getByText(/Type/).textContent).toContain("online_uni");
    expect(screen.getByRole("button", { name: "Run and commit" })).toBeDefined();
  });

  it("keeps the confirmation field out of autofill's reach", () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox"));

    const field = document.querySelector('input[name="confirm"]')!;
    expect(field.getAttribute("autocomplete")).toBe("off");
  });

  it("can be turned back off", () => {
    setup();
    const toggle = screen.getByRole("checkbox");

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Run" })).toBeDefined();
    expect(screen.getByText(/BEGIN READ ONLY/)).toBeDefined();
  });

  it("warns loudly when running on the application's own role", () => {
    // The fallback must never look like the hardened path: on this deployment
    // that role is a superuser, which can read files off the database host.
    setup(false);

    expect(
      screen.getByText(/Running as the application/),
    ).toBeDefined();
    expect(screen.getByText(/CONSOLE_DATABASE_URL/)).toBeDefined();
    expect(screen.getByText(/console:role/)).toBeDefined();
  });

  it("says nothing when the dedicated role is in use", () => {
    setup(true);
    expect(screen.queryByText(/CONSOLE_DATABASE_URL/)).toBeNull();
  });

  it("shows no result before anything has been run", () => {
    setup();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("submits the statement to the action", async () => {
    runQueryActionMock.mockResolvedValue({
      outcome: { ok: true, columns: ["n"], rows: [["1"]], rowCount: 1, truncated: false, durationMs: 3, redacted: [] },
      query: "select 1",
      allowWrites: false,
    });

    const { container } = setup();
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "select 1" } });
    fireEvent.submit(container.querySelector("form")!);

    await vi.waitFor(() => expect(runQueryActionMock).toHaveBeenCalled());

    const formData = runQueryActionMock.mock.calls[0]![1] as FormData;
    expect(formData.get("query")).toBe("select 1");

    // And the result the action returned is what gets rendered.
    await vi.waitFor(() => expect(screen.getByRole("table")).toBeDefined());
    expect(screen.getByText("1 row")).toBeDefined();
  });
});

describe("Result", () => {
  const ok = (overrides = {}) => ({
    ok: true as const,
    columns: ["id", "email"],
    rows: [["u1", "a@example.com"]],
    rowCount: 1,
    truncated: false,
    durationMs: 12,
    redacted: [] as string[],
    ...overrides,
  });

  it("renders the grid and the timing", () => {
    render(<Result outcome={ok()} />);

    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("1 row")).toBeDefined();
    expect(screen.getByText("12 ms")).toBeDefined();
  });

  it("pluralises rows", () => {
    render(<Result outcome={ok({ rowCount: 2, rows: [["a", "b"], ["c", "d"]] })} />);
    expect(screen.getByText("2 rows")).toBeDefined();
  });

  it("says when it stopped early rather than implying that was everything", () => {
    render(<Result outcome={ok({ truncated: true })} />);

    expect(screen.getByText(new RegExp(`Stopped at ${MAX_ROWS}`))).toBeDefined();
  });

  it("names the columns it blanked", () => {
    render(
      <Result
        outcome={ok({
          columns: ["id", "token"],
          rows: [["s1", REDACTED]],
          redacted: ["token"],
        })}
      />,
    );

    expect(screen.getByText("Withheld: token")).toBeDefined();
    expect(screen.getByText(REDACTED)).toBeDefined();
  });

  it("reports a failure without a grid", () => {
    render(
      <Result
        outcome={{ ok: false, error: "syntax error at or near \"slect\"", durationMs: 2 }}
      />,
    );

    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText(/syntax error/)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("distinguishes zero rows from a failure", () => {
    render(<Result outcome={ok({ rows: [], rowCount: 0 })} />);

    expect(screen.getByText("0 rows")).toBeDefined();
    expect(screen.getByText("The statement returned no rows.")).toBeDefined();
  });
});
