import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { createClient } from "@/db";
import { user } from "@/db/schema";
import {
  browseTable,
  CELL_LIMIT,
  clampPage,
  defaultSort,
  formatCell,
  PAGE_SIZE,
  redactCell,
  tableCounts,
} from "@/lib/admin/browse";
import { findTable, REDACTED } from "@/lib/admin/tables";

/**
 * Reading rows out of an arbitrary table.
 *
 * The projection and the ordering run against the real Postgres, because what
 * is being asserted is the SQL the query builder produced — that the credential
 * columns are genuinely absent from the statement rather than filtered
 * afterwards, and that `"user"` came out quoted rather than parsed as the
 * reserved word. A fake would only agree with itself about both.
 */

describe("clampPage", () => {
  it.each([
    ["1", 5, 1],
    ["3", 5, 3],
    ["5", 5, 5],
    // Past the end lands on the last page rather than an empty one.
    ["99", 5, 5],
    ["0", 5, 1],
    ["-4", 5, 1],
    [undefined, 5, 1],
    ["not a number", 5, 1],
    ["2", 0, 1],
  ])("%o of %i pages → %i", (raw, pages, expected) => {
    expect(clampPage(raw, pages)).toBe(expected);
  });
});

describe("defaultSort", () => {
  it("prefers newest-first on created_at", () => {
    // The row an operator is looking for is nearly always the one that just
    // appeared.
    expect(defaultSort(findTable("user")!)).toEqual({
      sort: "created_at",
      direction: "desc",
    });
  });

  it("falls back to the primary key when there is no timestamp", () => {
    // Not cosmetic: without an ORDER BY, Postgres may return the same row on
    // two different pages.
    const sort = defaultSort(findTable("progress")!);

    expect(sort).toEqual({ sort: "id", direction: "asc" });
  });

  it("never sorts by a column it is not allowed to select", () => {
    const sessions = findTable("session")!;
    expect(defaultSort(sessions).sort).not.toBe("token");
  });

  it("falls back to the first column on a table with neither", () => {
    // `internal_link` is a join table: the edge is the identity, so there is
    // no primary key and no timestamp. It still has to page deterministically.
    const info = findTable("internal_link")!;
    expect(info.primaryKey).toEqual([]);

    const sort = defaultSort(info);
    expect(sort.sort).toBe(info.columns[0]!.name);
    expect(sort.direction).toBe("asc");
  });
});

describe("formatCell", () => {
  it.each([
    [null, "null"],
    [undefined, "null"],
    ["plain", "plain"],
    [42, "42"],
    [false, "false"],
  ])("%o → %s", (value, expected) => {
    expect(formatCell(value)).toBe(expected);
  });

  it("renders a timestamp to the second, in UTC", () => {
    expect(formatCell(new Date("2027-06-15T12:34:56.789Z"))).toBe(
      "2027-06-15 12:34:56",
    );
  });

  it("renders json compactly", () => {
    expect(formatCell({ a: [1, 2] })).toBe('{"a":[1,2]}');
  });

  it("truncates long text with an ellipsis", () => {
    const long = "x".repeat(CELL_LIMIT + 40);
    const cell = formatCell(long);

    expect(cell).toHaveLength(CELL_LIMIT + 1);
    expect(cell.endsWith("…")).toBe(true);
  });

  it("leaves text exactly at the limit alone", () => {
    const exact = "x".repeat(CELL_LIMIT);
    expect(formatCell(exact)).toBe(exact);
  });

  it("takes a caller-supplied limit", () => {
    expect(formatCell("abcdef", 3)).toBe("abc…");
  });
});

describe("redactCell", () => {
  it("blanks a secret without ever formatting it", () => {
    expect(redactCell(true, "a-real-token")).toBe(REDACTED);
  });

  it("formats anything else", () => {
    expect(redactCell(false, 12)).toBe("12");
  });
});

const DATABASE_URL = process.env.DATABASE_URL;
const live = DATABASE_URL ? describe : describe.skip;

live("against a real database", () => {
  const { db, close } = createClient(DATABASE_URL!, 2);
  afterAll(() => close());

  const IDS = Array.from({ length: 4 }, (_, i) => `browse-test-${i}`);

  beforeEach(async () => {
    await db.delete(user).where(inArray(user.id, IDS));
    await db.insert(user).values(
      IDS.map((id, i) => ({
        id,
        name: `Browse ${i}`,
        email: `${id}@browse-test.local`,
        plan: i % 2 === 0 ? "free" : "pro",
        createdAt: new Date(`2027-07-0${i + 1}T12:00:00.000Z`),
      })),
    );
  });

  it("counts every table in one round trip", async () => {
    const counts = await tableCounts(db);

    // `user` is the reserved word, so this also proves the identifier was
    // quoted rather than interpolated raw.
    const users = counts.find((row) => row.name === "user")!;
    expect(users.rows).toBeGreaterThanOrEqual(IDS.length);
    expect(counts.map((row) => row.name)).toContain("admin_audit");
  });

  it("selects only the visible columns", async () => {
    const result = await browseTable(db, findTable("session")!);

    expect(result.columns.map((c) => c.name)).not.toContain("token");
    for (const row of result.rows) {
      expect(Object.keys(row)).not.toContain("token");
    }
  });

  it("orders newest-first by default", async () => {
    const result = await browseTable(db, findTable("user")!);
    const mine = result.rows.filter((row) =>
      String(row.email).endsWith("@browse-test.local"),
    );

    const dates = mine.map((row) => (row.created_at as Date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(result.sort).toBe("created_at");
    expect(result.direction).toBe("desc");
  });

  it("sorts by a requested column", async () => {
    const result = await browseTable(db, findTable("user")!, {
      sort: "email",
      direction: "asc",
    });

    expect(result.sort).toBe("email");
    const emails = result.rows.map((row) => String(row.email));
    expect(emails).toEqual([...emails].sort());
  });

  it("defaults a chosen column to descending", async () => {
    const result = await browseTable(db, findTable("user")!, { sort: "email" });
    expect(result).toMatchObject({ sort: "email", direction: "desc" });
  });

  it("ignores an unknown sort column instead of failing", async () => {
    // The name lives in a shareable URL; a stale link should not 500.
    const result = await browseTable(db, findTable("user")!, {
      sort: "no_such_column",
    });

    expect(result.sort).toBe("created_at");
  });

  it("refuses to sort by a withheld column", async () => {
    // The lookup is against the *visible* columns, so this falls through to
    // the default rather than putting `token` in an ORDER BY.
    const result = await browseTable(db, findTable("session")!, {
      sort: "token",
    });

    expect(result.sort).not.toBe("token");
  });

  it("cannot be made to interpolate a sort column", async () => {
    const result = await browseTable(db, findTable("user")!, {
      sort: 'email" desc; drop table "user',
    });

    expect(result.sort).toBe("created_at");

    // And the table is still there. The sort name is looked up in the column
    // list rather than interpolated, so this string never reaches Postgres.
    const survivors = await db.select({ id: user.id }).from(user).limit(1);
    expect(survivors).toHaveLength(1);
  });

  it("pages", async () => {
    const first = await browseTable(db, findTable("user")!, { page: "1" });

    expect(first.page).toBe(1);
    expect(first.rows.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(first.pages).toBe(Math.max(Math.ceil(first.total / PAGE_SIZE), 1));
  });

  it("clamps a page past the end", async () => {
    const result = await browseTable(db, findTable("user")!, { page: "9999" });
    expect(result.page).toBe(result.pages);
  });

  it("reports one page for an empty table", async () => {
    const result = await browseTable(db, findTable("misconception")!);

    expect(result.pages).toBeGreaterThanOrEqual(1);
    expect(result.page).toBe(1);
  });
});
