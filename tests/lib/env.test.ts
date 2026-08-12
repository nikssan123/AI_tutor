import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "@/lib/env";

/**
 * The env loader only exists for the CLI scripts (migrate, packs:seed) that run
 * outside Next.js. Its one dangerous behaviour is overwriting real process env,
 * so that is what most of these tests pin down.
 */

let dir: string;
let cwd: string;
const TOUCHED = [
  "TEST_PLAIN",
  "TEST_QUOTED",
  "TEST_SINGLE",
  "TEST_EMPTY",
  "TEST_EQUALS",
  "TEST_EXISTING",
  "TEST_SPACED",
  "TEST_SECOND_FILE",
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "online-uni-env-"));
  cwd = process.cwd();
  process.chdir(dir);
  for (const key of TOUCHED) delete process.env[key];
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  for (const key of TOUCHED) delete process.env[key];
});

describe("loadEnv", () => {
  it("reads plain key=value pairs", () => {
    writeFileSync(".env.local", "TEST_PLAIN=hello\n");
    loadEnv();
    expect(process.env.TEST_PLAIN).toBe("hello");
  });

  it("strips surrounding double and single quotes", () => {
    writeFileSync(
      ".env.local",
      'TEST_QUOTED="quoted value"\nTEST_SINGLE=\'single value\'\n',
    );
    loadEnv();
    expect(process.env.TEST_QUOTED).toBe("quoted value");
    expect(process.env.TEST_SINGLE).toBe("single value");
  });

  it("keeps everything after the first equals sign", () => {
    // Connection strings and base64 secrets both contain '='.
    writeFileSync(".env.local", "TEST_EQUALS=a=b=c\n");
    loadEnv();
    expect(process.env.TEST_EQUALS).toBe("a=b=c");
  });

  it("handles an empty value", () => {
    writeFileSync(".env.local", "TEST_EMPTY=\n");
    loadEnv();
    expect(process.env.TEST_EMPTY).toBe("");
  });

  it("trims whitespace around keys and values", () => {
    writeFileSync(".env.local", "  TEST_SPACED  =  padded  \n");
    loadEnv();
    expect(process.env.TEST_SPACED).toBe("padded");
  });

  it("never overwrites an existing variable", () => {
    // CI secrets must win over a stray local file — this is the whole reason
    // the loader checks `key in process.env` first.
    process.env.TEST_EXISTING = "from-ci";
    writeFileSync(".env.local", "TEST_EXISTING=from-file\n");
    loadEnv();
    expect(process.env.TEST_EXISTING).toBe("from-ci");
  });

  it("ignores comments and blank lines", () => {
    writeFileSync(
      ".env.local",
      "# a comment\n\n   \nTEST_PLAIN=kept\n# trailing comment\n",
    );
    loadEnv();
    expect(process.env.TEST_PLAIN).toBe("kept");
  });

  it("ignores lines with no equals sign", () => {
    writeFileSync(".env.local", "NOT_A_PAIR\nTEST_PLAIN=kept\n");
    loadEnv();
    expect(process.env.TEST_PLAIN).toBe("kept");
    expect(process.env.NOT_A_PAIR).toBeUndefined();
  });

  it("does nothing when no env file exists", () => {
    expect(() => loadEnv()).not.toThrow();
    expect(process.env.TEST_PLAIN).toBeUndefined();
  });

  it("reads later files but lets the earlier one win", () => {
    writeFileSync(".env.local", "TEST_PLAIN=local\n");
    writeFileSync(".env", "TEST_PLAIN=fallback\nTEST_SECOND_FILE=only-here\n");
    loadEnv();
    expect(process.env.TEST_PLAIN).toBe("local");
    expect(process.env.TEST_SECOND_FILE).toBe("only-here");
  });

  it("accepts an explicit file list", () => {
    writeFileSync("custom.env", "TEST_PLAIN=custom\n");
    loadEnv(["custom.env"]);
    expect(process.env.TEST_PLAIN).toBe("custom");
  });
});
