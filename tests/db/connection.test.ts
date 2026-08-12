import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  getDb,
  poolSize,
  resetDb,
  resolveConnectionString,
} from "@/db";
import { main, runMigrations } from "@/db/migrate";

/**
 * `postgres()` does not dial the server until the first query, so constructing a
 * client is safe without a live database. The one test that genuinely needs
 * Postgres is marked and skipped when DATABASE_URL is absent, so the suite still
 * passes on a laptop with Docker down.
 */

const ORIGINAL = process.env.DATABASE_URL;

beforeEach(() => {
  resetDb();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL;
  resetDb();
});

describe("resolveConnectionString", () => {
  it("returns the configured URL", () => {
    expect(
      resolveConnectionString({ DATABASE_URL: "postgres://x/y" }),
    ).toBe("postgres://x/y");
  });

  it("fails with an actionable message when unset", () => {
    // The message names the exact two commands that fix it, because this is the
    // first error a new contributor will hit.
    expect(() => resolveConnectionString({})).toThrow(/DATABASE_URL is not set/);
    expect(() => resolveConnectionString({})).toThrow(/docker compose up -d/);
  });

  it("reads process.env by default", () => {
    process.env.DATABASE_URL = "postgres://default/db";
    expect(resolveConnectionString()).toBe("postgres://default/db");
  });
});

describe("createDb", () => {
  it("builds a client without connecting", () => {
    const db = createDb("postgres://user:pass@localhost:1/none");
    expect(db).toBeDefined();
    expect(typeof db.select).toBe("function");
  });

  it("accepts an explicit pool size", () => {
    expect(createDb("postgres://user:pass@localhost:1/none", 1)).toBeDefined();
  });
});

describe("getDb", () => {
  it("caches the client across calls", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:1/none";
    expect(getDb()).toBe(getDb());
  });

  it("sizes the pool by environment", () => {
    // Serverless Postgres bills idle connections, so this is a cost decision,
    // not a style one.
    expect(poolSize({ NODE_ENV: "production" })).toBe(10);
    expect(poolSize({ NODE_ENV: "development" })).toBe(5);
    expect(poolSize({})).toBe(5);
  });

  it("reads the ambient environment by default", () => {
    expect(poolSize()).toBeGreaterThan(0);
  });

  it("rebuilds after resetDb", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:1/none";
    const first = getDb();
    resetDb();
    expect(getDb()).not.toBe(first);
  });

  it("throws when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    expect(() => getDb()).toThrow(/DATABASE_URL is not set/);
  });
});

describe("migrations", () => {
  it("refuses to run without a connection string", async () => {
    // `main` calls loadEnv first, so clearing the variable is not enough — the
    // test has to run somewhere that has no .env file to reload it from.
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = mkdtempSync(join(tmpdir(), "online-uni-noenv-"));
    const cwd = process.cwd();
    delete process.env.DATABASE_URL;
    process.chdir(dir);

    try {
      await expect(main()).rejects.toThrow(/DATABASE_URL is not set/);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const live = ORIGINAL ? it : it.skip;

  live("applies cleanly and is idempotent against the real database", async () => {
    // Running migrations twice must be a no-op — otherwise every deploy that
    // retries would be a hazard.
    await runMigrations(ORIGINAL!);
    await runMigrations(ORIGINAL!);
    await expect(main()).resolves.toBe("Migrations applied.");
  }, 60_000);

  live("creates the pgvector extension", async () => {
    const { default: postgres } = await import("postgres");
    const sql = postgres(ORIGINAL!, { max: 1 });
    try {
      const rows = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
      expect(rows).toHaveLength(1);
    } finally {
      await sql.end();
    }
  }, 30_000);
});
