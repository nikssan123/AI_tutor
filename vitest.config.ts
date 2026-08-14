import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Every test file that talks to the shared Postgres. See `projects` below. */
const DATABASE_TESTS = [
  "tests/ai/runlog.test.ts",
  "tests/app/api-routes.test.ts",
  "tests/calendar/store.test.ts",
  "tests/curriculum/store.test.ts",
  "tests/db/connection.test.ts",
  "tests/goals/standing.test.ts",
  "tests/lib/admin-console.test.ts",
  "tests/lib/admin-generated.test.ts",
  "tests/lib/auth.test.ts",
  "tests/lib/goal-store.test.ts",
  "tests/mastery/store.test.ts",
  "tests/packs/build.test.ts",
  "tests/packs/read.test.ts",
  "tests/packs/seed.test.ts",
  "tests/session/store.test.ts",
  "tests/submissions/store.test.ts",
];

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // No `include` here: each project below sets its own, and a root-level glob
    // is inherited by both, which runs every file twice.
    // Node by default; the component tests opt into jsdom per-file with
    // `// @vitest-environment jsdom`, so the engine tests stay fast.
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    // §24 E5 — the planner must run in <50ms. A slow test here is a real
    // signal, so keep the timeout tight enough that a regression shows up.
    testTimeout: 10_000,
    /**
     * The integration tests share one local Postgres, so they are run in a
     * project of their own with file parallelism off.
     *
     * They assert on state that is global to the database — how many goals are
     * active, how many packs exist — and two files doing that at once race:
     * one file's insert lands inside another's before/after window and the
     * count is off by exactly the row it did not write. It is a genuine
     * concurrency bug in the tests rather than a flake to retry, and it moves
     * around as the file list changes, so it is fixed by serialising the files
     * that share the resource instead of by loosening what they assert.
     *
     * Only the files listed above pay for it; the rest of the suite still runs
     * in parallel, which is why it stays at roughly its old wall time rather
     * than the ~3x of turning parallelism off everywhere.
     */
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
          exclude: DATABASE_TESTS,
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: DATABASE_TESTS,
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json", "json-summary"],
      reportsDirectory: "coverage",
      // Everything shipped in src/ counts. Vitest 4 reports untested files at
      // 0% by default, so a file with no test cannot vanish from the report.
      include: ["src/**/*.{ts,tsx}"],
      // Only ambient type declarations are excluded — they contain no runtime
      // statements to execute. Nothing else in src/ is exempt, and there are no
      // `c8 ignore` comments in the codebase; `pnpm coverage:audit` enforces both.
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
