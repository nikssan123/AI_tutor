import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Node by default; the component tests opt into jsdom per-file with
    // `// @vitest-environment jsdom`, so the engine tests stay fast.
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    // §24 E5 — the planner must run in <50ms. A slow test here is a real
    // signal, so keep the timeout tight enough that a regression shows up.
    testTimeout: 10_000,
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
