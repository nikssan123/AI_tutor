import { describe, expect, it } from "vitest";
import {
  CURSOR_SIZE,
  explainError,
  hasMultipleStatements,
  isCursorable,
  MAX_ROWS,
  renderValue,
  runQuery,
  STATEMENT_TIMEOUT_MS,
  stripQuoted,
  type ConsolePending,
  type ConsoleRows,
  type ConsoleRunner,
  type ConsoleTx,
} from "@/lib/admin/sql";
import { REDACTED } from "@/lib/admin/tables";

/**
 * The SQL console's engine.
 *
 * These are the tests that matter most in this change, for the same reason the
 * guard's are: each one describes a way the console could hand someone
 * something it should not. The read-only transaction and the redaction are
 * asserted directly rather than through a page, because every page depends on
 * them and none of them can restore the property if it is lost here.
 */

interface FakeOptions {
  rows?: Record<string, unknown>[];
  columns?: string[];
  fail?: unknown;
}

interface Fake {
  runner: ConsoleRunner;
  /** Every statement the engine sent, in order, including the SET. */
  sent: string[];
  /** The option string passed to BEGIN. */
  began: string[];
  /** How many rows the cursor was actually asked to produce. */
  produced: number;
}

function makeFake(options: FakeOptions = {}): Fake {
  const rows = options.rows ?? [];
  const fake: Fake = { runner: null as never, sent: [], began: [], produced: 0 };

  const rowsWithMeta = (slice: Record<string, unknown>[]): ConsoleRows => {
    const list = [...slice] as ConsoleRows;
    if (options.columns) {
      list.columns = options.columns.map((name) => ({ name }));
    }
    return list;
  };

  const pending = (query: string): ConsolePending => ({
    then: (resolve, reject) => {
      if (options.fail !== undefined && !query.startsWith("set local")) {
        return Promise.reject(options.fail).then(resolve, reject);
      }
      return Promise.resolve(rowsWithMeta(rows)).then(resolve, reject);
    },
    cursor: async (size, fn) => {
      if (options.fail !== undefined) throw options.fail;
      // Mirrors postgres-js exactly: pages keep being produced until the
      // callback *throws*. Merely returning does not close the cursor, which
      // is the behaviour this fake exists to hold the engine to.
      for (let i = 0; i < rows.length; i += size) {
        const page = rows.slice(i, i + size);
        fake.produced += page.length;
        await fn(rowsWithMeta(page));
      }
    },
  });

  const tx: ConsoleTx = {
    unsafe: (query: string) => {
      fake.sent.push(query);
      return pending(query);
    },
  };

  fake.runner = {
    begin: async (mode, fn) => {
      fake.began.push(mode);
      return fn(tx);
    },
  };

  return fake;
}

describe("stripQuoted", () => {
  it("leaves ordinary SQL alone", () => {
    expect(stripQuoted("select 1 from t")).toBe("select 1 from t");
  });

  it("blanks a line comment but keeps what follows the newline", () => {
    const stripped = stripQuoted("select 1 -- ; drop\nfrom t");

    expect(stripped).not.toContain(";");
    expect(stripped.replace(/[ \t]+/g, " ")).toBe("select 1 \nfrom t");
    // Offsets are preserved so a future error position still lines up.
    expect(stripped).toHaveLength("select 1 -- ; drop\nfrom t".length);
  });

  it("blanks a line comment that runs to the end of input", () => {
    expect(stripQuoted("select 1 -- end").trim()).toBe("select 1");
  });

  it("blanks a block comment", () => {
    expect(stripQuoted("select /* ; */ 1").replace(/\s+/g, " ")).toBe(
      "select 1",
    );
  });

  it("handles nested block comments", () => {
    // Postgres nests these, so a naive scan for the first `*/` reopens the
    // rest of the statement as live SQL.
    expect(stripQuoted("a /* x /* y */ ; */ b").replace(/\s+/g, " ")).toBe(
      "a b",
    );
  });

  it("blanks an unterminated block comment to the end", () => {
    expect(stripQuoted("select /* ; never closed").trim()).toBe("select");
  });

  it("blanks single-quoted strings", () => {
    expect(stripQuoted("select ';'").trim()).toBe("select");
  });

  it("keeps going past a doubled quote inside a string", () => {
    // 'it''s ; here' is ONE string. Treating the doubled quote as a terminator
    // would leave `; here'` looking like a second statement.
    expect(stripQuoted("select 'it''s ; here' , 2").replace(/\s+/g, " ")).toBe(
      "select , 2",
    );
  });

  it("blanks double-quoted identifiers", () => {
    expect(stripQuoted('select "a;b" from t').replace(/\s+/g, " ")).toBe(
      "select from t",
    );
  });

  it("handles a doubled quote inside an identifier", () => {
    expect(stripQuoted('select "a""; b" , 2').replace(/\s+/g, " ")).toBe(
      "select , 2",
    );
  });

  it("blanks an unterminated string to the end", () => {
    expect(stripQuoted("select 'oops ; ").trim()).toBe("select");
  });

  it("blanks a tagged dollar-quoted body", () => {
    expect(stripQuoted("select $fn$ ; anything $fn$ , 2").replace(/\s+/g, " ")).toBe(
      "select , 2",
    );
  });

  it("blanks an untagged dollar-quoted body", () => {
    expect(stripQuoted("select $$ ; $$ , 2").replace(/\s+/g, " ")).toBe(
      "select , 2",
    );
  });

  it("blanks an unterminated dollar quote to the end", () => {
    expect(stripQuoted("select $fn$ ; unclosed").trim()).toBe("select");
  });
});

describe("hasMultipleStatements", () => {
  it.each([
    ["select 1", false],
    ["select 1;", false],
    ["  select 1 ;  ", false],
    ["select 1; select 2", true],
    ["select ';'", false],
    ["select 1 -- ; not a statement", false],
    ["select /* ; */ 1", false],
    ["select $$;$$", false],
    ['select "a;b"', false],
    ["select 1; delete from \"user\"", true],
  ])("%s → %s", (query, expected) => {
    expect(hasMultipleStatements(query)).toBe(expected);
  });
});

describe("isCursorable", () => {
  it.each([
    ["select 1", true],
    ["SELECT 1", true],
    ["  with x as (select 1) select * from x", true],
    ["table users", true],
    ["values (1)", true],
    ["explain select 1", false],
    ["show timezone", false],
    ["update t set a = 1", false],
  ])("%s → %s", (query, expected) => {
    expect(isCursorable(query)).toBe(expected);
  });

  it("says no when there is no word at all", () => {
    expect(isCursorable("   ")).toBe(false);
  });

  it("ignores a leading comment when finding the keyword", () => {
    expect(isCursorable("-- a note\nselect 1")).toBe(true);
  });
});

describe("explainError", () => {
  it("points at the checkbox when Postgres refuses a write", () => {
    expect(
      explainError("cannot execute UPDATE in a read-only transaction", false),
    ).toMatch(/Allow writes/);
  });

  it("names the limit when a statement times out", () => {
    expect(explainError("canceling statement due to statement timeout", false))
      .toBe(`Cancelled after ${STATEMENT_TIMEOUT_MS / 1000}s. Narrow the query or add a LIMIT.`);
  });

  it("explains that column grants are why select * failed", () => {
    expect(explainError("permission denied for table session", false)).toMatch(
      /column-level grants/,
    );
  });

  it("sends a refused write to the right explanation", () => {
    // Read and write denials have different causes and different fixes, and
    // the read message sends you looking at the wrong one.
    const message = explainError("permission denied for table user", true);

    expect(message).toMatch(/user\.role/);
    expect(message).toMatch(/--allow-writes/);
    expect(message).not.toMatch(/Name the columns you need/);
  });

  it("reassures that a failed write changed nothing", () => {
    expect(
      explainError('violates foreign key constraint "x"', true),
    ).toMatch(/rolled back, nothing changed/);
  });

  it("leaves a constraint error alone in read mode", () => {
    // There is nothing to reassure about: read mode could not have written.
    expect(explainError("violates check constraint", false)).toBe(
      "violates check constraint",
    );
  });

  it("passes anything else through unchanged", () => {
    expect(explainError('syntax error at or near "slect"', false)).toBe(
      'syntax error at or near "slect"',
    );
  });
});

describe("renderValue", () => {
  it.each([
    [null, "null"],
    [undefined, "null"],
    ["text", "text"],
    [42, "42"],
    [true, "true"],
  ])("%o → %s", (value, expected) => {
    expect(renderValue(value)).toBe(expected);
  });

  it("renders a date as ISO", () => {
    expect(renderValue(new Date("2027-06-15T12:00:00.000Z"))).toBe(
      "2027-06-15T12:00:00.000Z",
    );
  });

  it("renders an object as JSON", () => {
    expect(renderValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("runQuery", () => {
  it("refuses an empty statement without opening a transaction", async () => {
    const fake = makeFake();
    const outcome = await runQuery(fake.runner, "   ");

    expect(outcome).toMatchObject({ ok: false, error: "Nothing to run." });
    expect(fake.began).toEqual([]);
  });

  it("refuses more than one statement without running the first", async () => {
    // The dangerous shape: the first statement is innocent and the second is
    // not, and a console showing one grid would never reveal the second ran.
    const fake = makeFake();
    const outcome = await runQuery(
      fake.runner,
      'select 1; delete from "user"',
      true,
    );

    expect(outcome.ok).toBe(false);
    expect(fake.began).toEqual([]);
    expect(fake.sent).toEqual([]);
  });

  it("opens a READ ONLY transaction by default", async () => {
    const fake = makeFake({ rows: [{ n: 1 }] });
    await runQuery(fake.runner, "select 1");

    expect(fake.began).toEqual(["read only"]);
  });

  it("opens a read write transaction only when writes are allowed", async () => {
    const fake = makeFake({ rows: [] });
    await runQuery(fake.runner, "select 1", true);

    expect(fake.began).toEqual(["read write"]);
  });

  it("sets a statement timeout local to the transaction", async () => {
    // LOCAL matters: a plain SET leaks onto the pooled connection and silently
    // caps some later request that never asked for it.
    const fake = makeFake({ rows: [] });
    await runQuery(fake.runner, "select 1");

    expect(fake.sent[0]).toBe(
      `set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`,
    );
  });

  it("returns rows and column labels from the cursor path", async () => {
    const fake = makeFake({
      rows: [{ id: "a", email: "x@example.com" }],
      columns: ["id", "email"],
    });

    const outcome = await runQuery(fake.runner, "select id, email from t");

    expect(outcome).toMatchObject({
      ok: true,
      columns: ["id", "email"],
      rows: [["a", "x@example.com"]],
      rowCount: 1,
      truncated: false,
      redacted: [],
    });
  });

  it("falls back to the first row's keys when the driver gives no metadata", () => {
    const fake = makeFake({ rows: [{ a: 1, b: 2 }] });
    return expect(runQuery(fake.runner, "select a, b")).resolves.toMatchObject({
      columns: ["a", "b"],
    });
  });

  it("reports no columns for an empty result with no metadata", async () => {
    const fake = makeFake({ rows: [] });
    const outcome = await runQuery(fake.runner, "select 1 where false");

    expect(outcome).toMatchObject({ ok: true, columns: [], rowCount: 0 });
  });

  it("takes the direct path for a statement a cursor cannot serve", async () => {
    const fake = makeFake({ rows: [{ "QUERY PLAN": "Seq Scan" }] });
    const outcome = await runQuery(fake.runner, "explain select 1");

    expect(outcome).toMatchObject({ ok: true, rowCount: 1 });
    // Not the cursor: EXPLAIN returns its rows through a path a cursor misses,
    // which is how it silently returned nothing before.
    expect(fake.produced).toBe(0);
  });

  it("takes the direct path in write mode even for a select", async () => {
    const fake = makeFake({ rows: [{ n: 1 }] });
    await runQuery(fake.runner, "select 1", true);

    expect(fake.produced).toBe(0);
  });

  it("stops fetching once the row cap is reached", async () => {
    const rows = Array.from({ length: MAX_ROWS + CURSOR_SIZE * 3 }, (_, i) => ({
      n: i,
    }));
    const fake = makeFake({ rows });

    const outcome = await runQuery(fake.runner, "select n from big");

    expect(outcome).toMatchObject({ rowCount: MAX_ROWS, truncated: true });
    // The point of the cursor: the rest of the table is never generated. One
    // page of overshoot is the cost of noticing there was more.
    expect(fake.produced).toBeLessThanOrEqual(MAX_ROWS + CURSOR_SIZE);
    expect(fake.produced).toBeLessThan(rows.length);
  });

  it("truncates an oversized direct-path result too", async () => {
    const rows = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ n: i }));
    const outcome = await runQuery(
      makeFake({ rows }).runner,
      "explain select 1",
    );

    expect(outcome).toMatchObject({ rowCount: MAX_ROWS, truncated: true });
  });

  it("blanks a column whose label reads like a credential", async () => {
    const fake = makeFake({
      rows: [{ id: "s1", token: "a-real-session-token" }],
      columns: ["id", "token"],
    });

    const outcome = await runQuery(fake.runner, "select id, token from session");

    expect(outcome).toMatchObject({
      rows: [["s1", REDACTED]],
      redacted: ["token"],
    });
    expect(JSON.stringify(outcome)).not.toContain("a-real-session-token");
  });

  it("blanks a credential hidden behind an alias", async () => {
    // `select token as t` defeats a table-and-column denylist, which is why
    // the console redacts on the label it is about to print.
    const fake = makeFake({
      rows: [{ user_password: "$2b$10$hash" }],
      columns: ["user_password"],
    });

    const outcome = await runQuery(fake.runner, "select password as user_password from account");

    expect(outcome).toMatchObject({ rows: [[REDACTED]] });
  });

  it("reports a driver error through explainError", async () => {
    const fake = makeFake({
      fail: new Error("cannot execute DELETE in a read-only transaction"),
    });

    const outcome = await runQuery(fake.runner, "delete from t");

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toMatch(/Allow writes/);
  });

  it("survives a thrown non-Error", async () => {
    const fake = makeFake({ fail: "something odd" });
    const outcome = await runQuery(fake.runner, "select 1");

    expect(outcome).toMatchObject({ ok: false, error: "something odd" });
  });

  it("reports how long it took", async () => {
    const fake = makeFake({ rows: [] });
    const outcome = await runQuery(fake.runner, "select 1");

    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });
});
