<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Tests and coverage

**Every new feature ships with the tests that keep `src/` at 100% coverage — lines, functions, branches, statements. We never fall below that.** The thresholds live in `vitest.config.ts`; they are not negotiable and do not get lowered to make a run pass.

- Untested code is unfinished code. Tests land in the same change as the feature, never in a follow-up.
- Do not buy the number back with exclusions: no new entries in `coverage.exclude`, no `c8 ignore` comments. `pnpm coverage:audit` fails on both and CI runs it. Only `src/**/*.d.ts` is exempt, because it has no runtime statements.
- If a branch is unreachable, delete it rather than ignore it. If a line is genuinely untestable, that is a design problem — restructure it so it can be tested.
- Never make a suite pass by skipping: no `.skip`, no `.only`, no commented-out assertions, no loosened expectations.

**Before every commit, run `pnpm verify`** (typecheck → lint → tokens:check → coverage:audit → packs:validate → coverage) and read the output. Commit only on a clean pass. If it fails, fix the code or the test and re-run — a failing or partial run is never "good enough to commit and clean up later".

The run needs Postgres up (`docker compose up -d`) and `DATABASE_URL` **exported in the shell** — vitest does not read `.env.local`:

```sh
DATABASE_URL=postgres://online_uni:online_uni@localhost:5433/online_uni pnpm verify
```

Without it the DB-backed tests in `tests/packs/seed.test.ts` and `tests/db/` skip, `src/db/migrate.ts` and `src/lib/packs/seed.ts` go uncovered, and coverage reports ~96.5%. That is a misconfigured run, not a coverage regression — set the variable and re-run before concluding anything about coverage.
