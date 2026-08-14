import { describe, expect, it } from "vitest";
import {
  APPEND_ONLY_TABLES,
  consoleRoleScript,
  consoleRoleStatements,
  grantStatements,
  PROTECTED_UPDATE_COLUMNS,
  quoteIdentifier,
  quoteLiteral,
} from "@/lib/admin/grants";
import { listTables, SECRET_COLUMNS } from "@/lib/admin/tables";

/**
 * The console role's privileges.
 *
 * These assert the properties the whole "absolutely protected" claim rests on,
 * and they are worth more than they look: every one of them describes something
 * Postgres will enforce for us, so a failure here is a protection that silently
 * stopped existing.
 */

const OPTIONS = { role: "console", database: "online_uni" };

function statements(allowWrites = false) {
  return grantStatements({ ...OPTIONS, allowWrites });
}

describe("quoteIdentifier", () => {
  it("quotes, because `user` is a reserved word", () => {
    expect(quoteIdentifier("user")).toBe('"user"');
  });

  it("escapes an embedded quote", () => {
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
  });
});

describe("quoteLiteral", () => {
  it("escapes an embedded apostrophe", () => {
    expect(quoteLiteral("it's")).toBe("'it''s'");
  });
});

describe("grantStatements", () => {
  it("revokes before it grants, so re-running converges", () => {
    const sql = statements();

    expect(sql[0]).toMatch(/^revoke all on all tables/);
    expect(sql[1]).toMatch(/^revoke all on schema public/);
  });

  it("never grants a table-wide select on a table holding a credential", () => {
    // This is the trap the module exists to avoid. Postgres accepts
    // `revoke select (token) on session` after a table-wide grant and then
    // still lets the role read `token` — the revoke looks like it worked.
    const sql = statements();

    for (const table of Object.keys(SECRET_COLUMNS)) {
      expect(sql).not.toContain(`grant select on "${table}" to "console";`);
      expect(
        sql.some((line) => line.startsWith(`grant select ("`) && line.includes(`on "${table}"`)),
      ).toBe(true);
    }
  });

  it("leaves every credential column out of the select grant", () => {
    const sql = statements().join("\n");

    for (const [table, secrets] of Object.entries(SECRET_COLUMNS)) {
      const line = sql
        .split("\n")
        .find((l) => l.includes(`on "${table}" to`) && l.startsWith("grant select"))!;

      for (const secret of secrets) {
        expect(line, `${table}.${secret}`).not.toContain(`"${secret}"`);
      }
    }
  });

  it("uses a plain table grant where there is nothing to hide", () => {
    // So that `select *` — the first thing anyone types — keeps working.
    expect(statements()).toContain('grant select on "agent_run" to "console";');
  });

  it("grants no writes at all by default", () => {
    const sql = statements().join("\n");

    expect(sql).not.toMatch(/grant insert/);
    expect(sql).not.toMatch(/grant update/);
    expect(sql).not.toMatch(/grant delete/);
  });

  it("covers every table in the schema", () => {
    const sql = statements().join("\n");

    for (const info of listTables()) {
      expect(sql, info.name).toContain(`on "${info.name}" to "console";`);
    }
  });

  describe("with writes enabled", () => {
    it("never grants update on user.role or user.plan", () => {
      // `role` keeps `pnpm admin:grant` the only path to admin even when the
      // console can write — without it, write mode is a self-service promotion.
      // `plan` is the same argument one step down: a console that can set it
      // hands out paid plans, and it is a derived cache of `subscription`
      // anyway, so a direct write desynchronises it from the row that owns it.
      const line = statements(true).find(
        (l) => l.startsWith("grant update") && l.includes('on "user"'),
      )!;

      expect(line).toBeDefined();
      expect(line).not.toContain('"role"');
      expect(line).not.toContain('"plan"');
      // Still writable: the columns the account holder owns.
      expect(line).toContain('"locale"');
      expect(line).toContain('"timezone"');
    });

    it("never grants update on what Stripe owns", () => {
      // A hand-edited status makes the product disagree with the processor
      // while the money keeps flowing the other way, and the next webhook
      // delivery overwrites the edit regardless.
      const line = statements(true).find(
        (l) => l.startsWith("grant update") && l.includes('on "subscription"'),
      )!;

      expect(line).toBeDefined();
      expect(line).not.toContain('"status"');
      expect(line).not.toContain('"amount_cents"');
      expect(line).toContain('"cancel_at_period_end"');
    });

    it("grants a plain update where no column is protected", () => {
      expect(statements(true)).toContain(
        'grant update on "agent_run" to "console";',
      );
    });

    it("gives the audit log no write privilege of any kind", () => {
      // A console that can delete its own audit trail has no audit trail.
      const sql = statements(true).filter((l) => l.includes('"admin_audit"'));

      expect(sql.some((l) => l.startsWith("grant select"))).toBe(true);
      expect(sql.some((l) => /^grant (insert|update|delete)/.test(l))).toBe(
        false,
      );
    });

    it("does grant writes on an ordinary table", () => {
      expect(statements(true)).toContain(
        'grant insert, delete on "agent_run" to "console";',
      );
    });
  });

  it("names tables that exist", () => {
    const names = listTables().map((info) => info.name);

    for (const table of [
      ...APPEND_ONLY_TABLES,
      ...Object.keys(PROTECTED_UPDATE_COLUMNS),
    ]) {
      expect(names, table).toContain(table);
    }
  });
});

describe("consoleRoleStatements", () => {
  const script = () =>
    consoleRoleStatements({ ...OPTIONS, password: "p'w", allowWrites: false });

  it("keeps the do-block as one statement", () => {
    // Split on newlines it would be four syntax errors.
    const block = script()[0]!;

    expect(block).toContain("do $$ begin");
    expect(block.trimEnd()).toMatch(/end \$\$;$/);
  });

  it("escapes the password", () => {
    expect(script()[0]).toContain("'p''w'");
  });

  it("strips every superuser-adjacent attribute", () => {
    // A superuser can pg_read_file() inside a READ ONLY transaction, because
    // reading a file is not a write. The role must not be one.
    expect(script()[1]).toBe(
      'alter role "console" nosuperuser nocreatedb nocreaterole noreplication nobypassrls;',
    );
  });

  it("creates the role if absent and re-passwords it if present", () => {
    const block = script()[0]!;

    expect(block).toContain("create role");
    expect(block).toContain("alter role");
  });
});

describe("consoleRoleScript", () => {
  it("is the statements with a header, for pasting", () => {
    const text = consoleRoleScript({
      ...OPTIONS,
      password: "x",
      allowWrites: false,
    });

    expect(text.startsWith("--")).toBe(true);
    expect(text).toContain('grant usage on schema public to "console";');
  });
});
