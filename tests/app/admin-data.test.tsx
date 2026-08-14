// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { BrowseResult } from "@/lib/admin/browse";
import { findTable, listTables, REDACTED } from "@/lib/admin/tables";

/**
 * The data browser.
 *
 * The guard is stubbed and tested for real in tests/lib/admin-guard.test.ts.
 * What these assert is the other half — that each page *calls* it, that an
 * unknown table 404s rather than reporting itself, and that no credential
 * column reaches the markup.
 */

const requireAdminMock = vi.fn();
const tableCountsMock = vi.fn();
const browseTableMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/lib/admin/guard", () => ({
  requireAdmin: () => requireAdminMock(),
}));
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/admin/browse", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin/browse")>(
      "@/lib/admin/browse",
    );
  return {
    ...actual,
    tableCounts: (...args: unknown[]) => tableCountsMock(...args),
    browseTable: (...args: unknown[]) => browseTableMock(...args),
  };
});

const { default: DataIndexPage } = await import("@/app/admin/data/page");
const { default: TablePage } = await import("@/app/admin/data/[table]/page");

function browseResult(overrides: Partial<BrowseResult> = {}): BrowseResult {
  const info = findTable("user")!;
  const columns = info.columns.filter((column) => !column.secret);

  return {
    columns,
    rows: [
      {
        id: "u1",
        name: "Ada",
        email: "ada@example.com",
        plan: "free",
        role: "user",
        handle: null,
        locale: "en",
        timezone: "UTC",
        stripe_customer_id: null,
        email_verified: true,
        image: null,
        created_at: new Date("2027-06-15T12:00:00.000Z"),
        updated_at: new Date("2027-06-15T12:00:00.000Z"),
      },
    ],
    total: 1,
    page: 1,
    pages: 1,
    sort: "created_at",
    direction: "desc",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    userId: "u0",
    email: "admin@example.com",
    role: "admin",
  });
  // One entry per table, as the real `tableCounts` returns — the page is driven
  // off the catalogue, so a partial fixture would not resemble it.
  const known: Record<string, number> = { user: 9, session: 5, agent_run: 96 };
  tableCountsMock.mockResolvedValue(
    listTables().map((info) => ({
      name: info.name,
      rows: known[info.name] ?? 0,
    })),
  );
  browseTableMock.mockResolvedValue(browseResult());
});

afterEach(cleanup);

describe("/admin/data", () => {
  it("requires an admin", async () => {
    render(await DataIndexPage());
    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("refuses to render for a non-admin", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(DataIndexPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lists each table with its row count", async () => {
    render(await DataIndexPage());

    expect(screen.getByRole("link", { name: "user" })).toBeDefined();
    expect(screen.getByText("96")).toBeDefined();
  });

  it("links each table to its browser", async () => {
    render(await DataIndexPage());

    expect(
      screen.getByRole("link", { name: "user" }).getAttribute("href"),
    ).toBe("/admin/data/user");
  });

  it("flags how many columns a table withholds", async () => {
    render(await DataIndexPage());

    // `session` hides its token; `agent_run` hides nothing.
    const rows = screen.getAllByRole("row");
    const sessionRow = rows.find((row) =>
      within(row).queryByRole("link", { name: "session" }),
    )!;
    expect(within(sessionRow).getByText("1")).toBeDefined();
  });
});

describe("/admin/data/[table]", () => {
  const render404 = (table: string) =>
    TablePage({
      params: Promise.resolve({ table }),
      searchParams: Promise.resolve({}),
    });

  const renderPage = async (
    table = "user",
    query: Record<string, string | string[] | undefined> = {},
  ) =>
    render(
      await TablePage({
        params: Promise.resolve({ table }),
        searchParams: Promise.resolve(query),
      }),
    );

  it("requires an admin", async () => {
    await renderPage();
    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("404s an unknown table rather than naming it", async () => {
    // A "no such table" message maps the schema for a prober.
    await expect(render404("pg_shadow")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("404s an injected table name", async () => {
    await expect(render404('user"; drop table x --')).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("renders the rows it was given", async () => {
    await renderPage();
    expect(screen.getByText("ada@example.com")).toBeDefined();
  });

  it("passes the search params through to the browser", async () => {
    await renderPage("user", { page: "2", sort: "email", direction: "asc" });

    expect(browseTableMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "user" }),
      { page: "2", sort: "email", direction: "asc" },
    );
  });

  it("takes the first value when a param repeats", async () => {
    // `?page=1&page=2` arrives as an array and must not reach the query as one.
    await renderPage("user", { page: ["3", "4"] });

    expect(browseTableMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ page: "3" }),
    );
  });

  it("never renders a withheld column", async () => {
    browseTableMock.mockResolvedValue(
      browseResult({
        columns: findTable("session")!.columns.filter((c) => !c.secret),
        rows: [{ id: "s1", user_id: "u1", ip_address: null }],
      }),
    );

    const { container } = await renderPage("session");

    // Scoped to the grid: the explainer card below it names `token` on purpose,
    // which is the point — the column is accounted for rather than just gone.
    expect(container.querySelector("table")!.innerHTML).not.toContain("token");
  });

  it("explains why a column is missing", async () => {
    await renderPage("session");

    expect(screen.getByText(/Not selected: token/)).toBeDefined();
    expect(screen.getByText(new RegExp(REDACTED))).toBeDefined();
  });

  it("says nothing about withholding on a table with no credentials", async () => {
    await renderPage("agent_run");
    expect(screen.queryByText(/Not selected/)).toBeNull();
  });

  it("flips the direction when the current sort column is clicked", async () => {
    await renderPage();

    const header = screen.getByRole("link", { name: /created_at/ });
    expect(header.getAttribute("href")).toContain("direction=asc");
  });

  it("shows which way the current column is sorted", async () => {
    const descending = await renderPage();
    expect(
      screen.getByRole("link", { name: /created_at/ }).textContent,
    ).toContain("↓");
    descending.unmount();

    browseTableMock.mockResolvedValue(browseResult({ direction: "asc" }));
    await renderPage();
    expect(
      screen.getByRole("link", { name: /created_at/ }).textContent,
    ).toContain("↑");
  });

  it("says when a table has no primary key", async () => {
    // `internal_link` is a join table — the edge is the identity. Worth saying,
    // because it is why the row cannot be addressed individually.
    await renderPage("internal_link");

    expect(screen.getByText(/no primary key/)).toBeDefined();
  });

  it("names the key when there is one", async () => {
    await renderPage();
    expect(screen.getByText(/key id/)).toBeDefined();
  });

  it("starts a newly chosen column descending", async () => {
    await renderPage();

    const header = screen.getByRole("link", { name: "email" });
    expect(header.getAttribute("href")).toContain("direction=desc");
  });

  it("resets to page one when the sort changes", async () => {
    browseTableMock.mockResolvedValue(browseResult({ page: 3, pages: 4 }));
    await renderPage();

    expect(
      screen.getByRole("link", { name: "email" }).getAttribute("href"),
    ).toContain("page=1");
  });

  it("offers pagination only when there is more than one page", async () => {
    await renderPage();
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
  });

  it("offers both directions in the middle of a table", async () => {
    browseTableMock.mockResolvedValue(browseResult({ page: 2, pages: 3 }));
    await renderPage();

    expect(screen.getByRole("link", { name: /Previous/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Next/ })).toBeDefined();
  });

  it("omits Previous on the first page and Next on the last", async () => {
    browseTableMock.mockResolvedValue(browseResult({ page: 1, pages: 2 }));
    const first = await renderPage();
    expect(screen.queryByRole("link", { name: /Previous/ })).toBeNull();
    first.unmount();

    browseTableMock.mockResolvedValue(browseResult({ page: 2, pages: 2 }));
    await renderPage();
    expect(screen.queryByRole("link", { name: /Next/ })).toBeNull();
  });

  it("shows a notice after an action", async () => {
    await renderPage("user", { notice: "Deleted x@example.com.", ok: "1" });
    expect(screen.getByText("Deleted x@example.com.")).toBeDefined();
  });

  it("shows a refusal as a problem", async () => {
    const { container } = await renderPage("user", {
      notice: "Nothing was deleted.",
      ok: "0",
    });

    expect(container.innerHTML).toContain("border-l-problem");
  });

  describe("row actions", () => {
    it("offers them on the user table", async () => {
      await renderPage();

      // Twice over: the column header, and the row's own disclosure.
      expect(screen.getAllByText("Actions")).toHaveLength(2);
      expect(screen.getByRole("button", { name: "Move to pro" })).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Sign out everywhere" }),
      ).toBeDefined();
    });

    it("offers the plan the account is not on", async () => {
      browseTableMock.mockResolvedValue(
        browseResult({
          rows: [{ id: "u1", email: "a@b.c", plan: "pro", role: "user" }],
        }),
      );
      await renderPage();

      expect(screen.getByRole("button", { name: "Move to free" })).toBeDefined();
    });

    it("makes delete ask for the email to be typed", async () => {
      await renderPage();

      const field = screen.getByLabelText(/Type ada@example.com to delete/);
      expect(field.getAttribute("required")).not.toBeNull();
      // Autofill must not be able to satisfy a confirmation.
      expect(field.getAttribute("autocomplete")).toBe("off");
    });

    it("refuses to offer delete for an admin", async () => {
      browseTableMock.mockResolvedValue(
        browseResult({
          rows: [{ id: "u1", email: "a@b.c", plan: "free", role: "admin" }],
        }),
      );
      await renderPage();

      expect(screen.queryByRole("button", { name: "Delete account" })).toBeNull();
      expect(screen.getByText(/admin:grant --revoke/)).toBeDefined();
    });

    it("offers none of it on any other table", async () => {
      await renderPage("agent_run");

      expect(screen.queryByText("Actions")).toBeNull();
      expect(screen.getByText(/Read-only/)).toBeDefined();
    });
  });
});
