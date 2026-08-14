import { beforeEach, describe, expect, it } from "vitest";
import {
  findTable,
  isSecretColumn,
  isSecretLabel,
  listTables,
  REDACTED,
  resetTables,
  SECRET_COLUMNS,
  visibleColumns,
} from "@/lib/admin/tables";

/**
 * The catalogue, and the list of things it refuses to show.
 *
 * The secret-column assertions are pinned to the actual schema rather than to a
 * fixture on purpose: if someone adds a token column to `session` and does not
 * add it here, that is precisely the regression worth failing a build over, and
 * a fixture would sail past it.
 */

beforeEach(resetTables);

describe("listTables", () => {
  it("finds the schema's tables", () => {
    const tables = listTables();

    expect(tables.length).toBeGreaterThan(20);
    expect(tables.map((t) => t.name)).toContain("user");
  });

  it("is sorted by name, so the index page is scannable", () => {
    const names = listTables().map((t) => t.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("memoizes rather than re-walking every table on each render", () => {
    expect(listTables()).toBe(listTables());
  });

  it("rebuilds after a reset", () => {
    const first = listTables();
    resetTables();
    expect(listTables()).not.toBe(first);
  });

  it("describes columns with the detail the browser needs", () => {
    const users = findTable("user")!;
    const id = users.columns.find((c) => c.name === "id")!;

    expect(id).toMatchObject({ sqlType: "text", primary: true, notNull: true });
    expect(users.primaryKey).toEqual(["id"]);
  });

  it("marks a table's credential columns as secret", () => {
    const sessions = findTable("session")!;
    const token = sessions.columns.find((c) => c.name === "token")!;

    expect(token.secret).toBe(true);
  });
});

describe("findTable", () => {
  it("resolves a known name", () => {
    expect(findTable("user")?.name).toBe("user");
  });

  it("returns nothing for an unknown name, so the route can 404", () => {
    expect(findTable("pg_shadow")).toBeUndefined();
    expect(findTable("user; drop table x")).toBeUndefined();
  });
});

describe("visibleColumns", () => {
  it("drops every credential column", () => {
    for (const [table, secrets] of Object.entries(SECRET_COLUMNS)) {
      const info = findTable(table);
      expect(info, `${table} is named in SECRET_COLUMNS`).toBeDefined();

      const names = visibleColumns(info!).map((column) => column.name);
      for (const secret of secrets) {
        expect(names, `${table}.${secret} must not be selectable`).not.toContain(
          secret,
        );
      }
    }
  });

  it("keeps everything else", () => {
    const account = findTable("account")!;
    const names = visibleColumns(account).map((c) => c.name);

    expect(names).toContain("provider_id");
    expect(names).not.toContain("password");
  });

  it("leaves a table with no credentials untouched", () => {
    const runs = findTable("agent_run")!;
    expect(visibleColumns(runs)).toHaveLength(runs.columns.length);
  });
});

describe("SECRET_COLUMNS", () => {
  it("names columns that actually exist", () => {
    // A typo here is a silent hole: the column stays visible and the list
    // looks like it is doing its job.
    for (const [table, secrets] of Object.entries(SECRET_COLUMNS)) {
      const info = findTable(table)!;
      const names = info.columns.map((column) => column.name);
      for (const secret of secrets) {
        expect(names, `${table}.${secret}`).toContain(secret);
      }
    }
  });

  it("is redacted by the console's label check too", () => {
    // The browser withholds by (table, column); the console only ever sees a
    // label. Anything the browser hides must also be blanked in console output,
    // or `select value from verification` prints a live reset code.
    for (const secrets of Object.values(SECRET_COLUMNS)) {
      for (const secret of secrets) {
        expect(isSecretLabel(secret), secret).toBe(true);
      }
    }
  });

  it("does not require the reverse", () => {
    // The label check is deliberately looser than the column list.
    // `access_token_expires_at` is a timestamp, not a credential: the console
    // blanks it out of caution, and the browser is right to still show it.
    expect(isSecretLabel("access_token_expires_at")).toBe(true);
    expect(isSecretColumn("account", "access_token_expires_at")).toBe(false);
  });
});

describe("isSecretColumn", () => {
  it.each([
    ["session", "token", true],
    ["account", "password", true],
    ["verification", "value", true],
    ["session", "id", false],
    ["user", "email", false],
    ["agent_run", "token", false],
  ])("%s.%s → %s", (table, column, expected) => {
    expect(isSecretColumn(table, column)).toBe(expected);
  });
});

describe("isSecretLabel", () => {
  it.each([
    "token",
    "TOKEN",
    "access_token",
    "session_token",
    "password",
    "user_password",
    "client_secret",
    "hash",
    "api_key",
    "apiKey",
  ])("redacts %s", (label) => {
    expect(isSecretLabel(label)).toBe(true);
  });

  it.each(["id", "email", "created_at", "plan", "status", "cost_cents"])(
    "leaves %s alone",
    (label) => {
      expect(isSecretLabel(label)).toBe(false);
    },
  );

  it("blanks a name that is only a credential by declaration", () => {
    // `value` matches no pattern; it is redacted because SECRET_COLUMNS says
    // verification.value is a reset code.
    expect(isSecretLabel("value")).toBe(true);
    expect(isSecretLabel("VALUE")).toBe(true);
  });

  it("is deliberately over-eager", () => {
    // `token_count` is a number, and losing it to caution is cheaper than one
    // session token reaching a screen.
    expect(isSecretLabel("token_count")).toBe(true);
  });
});

describe("REDACTED", () => {
  it("looks nothing like a value that could be copied", () => {
    expect(REDACTED).not.toMatch(/[a-z0-9]/i);
  });
});
