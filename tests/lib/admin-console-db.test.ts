import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  databaseName,
  getConsoleConnection,
  resetConsoleConnection,
  resolveConsoleUrl,
} from "@/lib/admin/console-db";

/**
 * Which connection the console runs on, and whether it admits to it.
 *
 * The fallback is the interesting case. It has to work — one database URL on a
 * laptop is the normal case — but it must never quietly present itself as the
 * hardened path, because on this deployment the application's role is a
 * superuser.
 */

beforeEach(resetConsoleConnection);
afterEach(resetConsoleConnection);

describe("resolveConsoleUrl", () => {
  it("prefers the dedicated role when it is configured", () => {
    expect(
      resolveConsoleUrl({
        CONSOLE_DATABASE_URL: "postgres://console:p@h/db",
        DATABASE_URL: "postgres://app:p@h/db",
      }),
    ).toEqual({ url: "postgres://console:p@h/db", leastPrivilege: true });
  });

  it("falls back to the application connection and says so", () => {
    expect(
      resolveConsoleUrl({ DATABASE_URL: "postgres://app:p@h/db" }),
    ).toEqual({ url: "postgres://app:p@h/db", leastPrivilege: false });
  });

  it("fails the way the rest of the app does when nothing is configured", () => {
    expect(() => resolveConsoleUrl({})).toThrow(/DATABASE_URL is not set/);
  });
});

describe("databaseName", () => {
  it.each([
    ["postgres://u:p@host:5433/online_uni", "online_uni"],
    ["postgres://u:p@host/my%20db", "my db"],
    ["postgres://u:p@host:5433/online_uni?sslmode=require", "online_uni"],
  ])("%s → %s", (url, expected) => {
    expect(databaseName(url)).toBe(expected);
  });

  it("falls back to a generic word rather than failing the page", () => {
    // The name is a confirmation prompt, not a connection detail. An
    // unparseable URL must not 500 the console.
    expect(databaseName("not a url")).toBe("database");
    expect(databaseName("postgres://u:p@host:5433/")).toBe("database");
  });
});

describe("getConsoleConnection", () => {
  const ENV = {
    CONSOLE_DATABASE_URL: "postgres://console:p@localhost:5433/online_uni",
  };

  it("reports the role and the database it is pointed at", () => {
    const connection = getConsoleConnection(ENV);

    expect(connection.leastPrivilege).toBe(true);
    expect(connection.database).toBe("online_uni");
  });

  it("builds the pool once", () => {
    // Constructing `postgres()` per request would leak a pool per render.
    expect(getConsoleConnection(ENV)).toBe(getConsoleConnection(ENV));
  });

  it("rebuilds after a reset", () => {
    const first = getConsoleConnection(ENV);
    resetConsoleConnection();

    expect(getConsoleConnection(ENV)).not.toBe(first);
  });

  it("flags the fallback connection as not least-privilege", () => {
    expect(
      getConsoleConnection({
        DATABASE_URL: "postgres://app:p@localhost:5433/online_uni",
      }).leastPrivilege,
    ).toBe(false);
  });
});
