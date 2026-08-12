# Implementation Pass 1 — Foundation, Domain Packs, and the Learning Engine

## Context

`/Users/nixon/Code/online_uni` currently contains one file: `PLAN.md`, a 1,897-line startup and engineering plan for an adaptive-learning SaaS. Nothing has been built. The plan's §24 sequences the MVP into 13 epics (E1–E13) over 30 days, ordered by dependency, with an explicit instruction that if the schedule slips you cut SEO pages and free tools — **never E5 (the planner) or E8 (the evaluation agent)**.

This pass builds **E1 (Foundation) + E2 (Domain Pack system) + E5 (Mastery model + planner)**, plus a drafted SQL Curated pack for Phase 0/D3.

Why this grouping: it is the entire part of the product that needs no API key, no SaaS account, and no network — so all of it is unit-testable and verifiable today — and it contains the piece the plan calls "the product's brain and it is pure code." E3/E4/E6 (goal intake, diagnostic, curriculum generation) are deliberately deferred until an `ANTHROPIC_API_KEY` exists, so that the LLM steps can be verified against real calls rather than written blind.

Intended outcome at the end of this pass: a signed-in user reaches an empty `/today`; the SQL pack loads and validates (and a deliberately broken pack fails the build with a clear error); and the deterministic planner produces a byte-identical `PlannedSession` with a human-readable reason across 20 hand-written learner scenarios in under 50ms, with zero LLM calls in that path.

---

## Stated deviations from PLAN.md

Two, both flagged rather than quietly applied:

1. **Next.js 16.3 instead of 15** (§18.1 says 15). 16 is the current stable major and still App Router; the plan's concern about 15 was a metadata-streaming regression that put `<head>` tags after body content. That risk is handled directly by the `curl`-based head-order test in the verification section, which is a better guard than a version pin on either major. The Next version is pinned exactly in `package.json` either way.
2. **Tailwind v4 CSS-first tokens instead of a `tailwind.config` plugin** (§8.5.8 describes deleting the default palette from `tailwind.config` and emitting both theme blocks from a plugin). Tailwind v4 has no JS palette config to delete; the equivalent is `@theme { --color-*: initial; }`. The plan's real requirement — *author the palette once, emit both dark blocks* — is preserved by generating `tokens.css` from a single TS source (below).

Everything else follows the plan as written.

---

## Step 0 — Repo setup

- `git init`, `.gitignore`, and an initial commit of the scaffold (the directory is not currently a git repo).
- Copy this plan to `/Users/nixon/Code/online_uni/IMPLEMENTATION.md` so it lives beside `PLAN.md` as a project artifact.

## Step 1 — E1 Foundation (§24 E1, §13.1, §18.1)

**App shell.** Next.js 16.3 + TypeScript + React 19, App Router, with the two-world split from §13.1:

- `src/app/(marketing)/` — static/ISR, no auth provider in the React tree, `<80KB` JS budget.
- `src/app/(app)/layout.tsx` — dynamic, `robots: { index: false, follow: false }` set at the layout level so no authenticated route can leak into the index.
- `src/app/api/auth/[...all]/route.ts`, `src/app/api/inngest/route.ts`, `src/app/robots.ts`, `src/app/sitemap.ts` (indexable-only query, empty for now).

**Database.** Postgres 17 + pgvector via `docker-compose.yml` (`pgvector/pgvector:pg17`) so nothing needs a Neon account yet — production swaps `DATABASE_URL` only. Drizzle ORM + drizzle-kit; `CREATE EXTENSION vector` in the first migration.

**Schema** (`src/db/schema/*.ts`, split by §15's groupings): every entity marked **bold** in §15 — `User`, `LearnerProfile`, `LearningGoal`, `DomainPack`, `Skill`, `SkillDependency`, `LearnerSkillMastery` (unique on `(userId, skillId)`), `Curriculum`, `CurriculumModule`, `LearningPlan`, `LearningSession`, `AssessmentItem`, `Assessment`/`AssessmentResult`, `Project`, `Rubric`, `Submission`, `Artifact`, `Evaluation`, `MasteryUpdate`, `Interaction`, `AgentRun`, `Feedback`, `Progress`, and the SEO entities. Tables for later epics are created now but only written to by the epics that own them — the schema is what the pack loader and planner are typed against.

**Auth.** Better Auth, Postgres-backed via the Drizzle adapter, email+password only. No external service.

**Background jobs.** Inngest client + route handler, with one trivial durable function to prove the wiring. Local dev via `pnpm dlx inngest-cli dev` — no account needed.

**Observability.** PostHog, Sentry and Langfuse wrapped behind thin env-guarded modules in `src/lib/observability/` that no-op when their env vars are absent. This keeps §25's event names in code from day one without requiring three signups today.

**Design system** (§8.5, built in week 1 *before* product screens, as §8.5.8 requires):
- `src/lib/theme.ts` — the light and dark palettes as a single TS object; the only place a colour is written.
- `scripts/build-tokens.ts` — emits `src/styles/tokens.css` with all three selector blocks (`:root`, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, `:root[data-theme="dark"]`) plus `color-scheme`. Checked in; CI re-runs it and fails if the output drifts, which is the mechanism that stops the two dark blocks diverging.
- Inline anti-FOUC script in `<head>` (<400 bytes, blocking, not a module), cookie + `localStorage` mirror, `suppressHydrationWarning` on `<html>`.
- `src/app/design/page.tsx` — the reference route rendering the full component set; doubles as the visual-regression and contrast-check target.
- ~18 components in `src/components/ui/` from §8.5.5 (Row list, Toggle group, Panel, Switch, Status dot, Confidence meter, skeletons, empty state…), Radix primitives restyled to tokens only. Self-hosted Instrument Sans, two weights, metric-matched fallback via `size-adjust`.

**CI** (`.github/workflows/ci.yml`): typecheck → lint → `build-tokens` drift check → `packs:validate` → `vitest` → `drizzle-kit` migration check → build.

**Accept:** a signed-in user reaches an empty `/today`; `curl` on `/` shows fully server-rendered HTML with metadata in `<head>`; the trivial Inngest job runs.

## Step 2 — Phase 0/D3: the SQL Curated pack

Hand-authored data, not code, at `packs/sql-data-analysis/`. Per §23 Phase 0 and §7.1: ~25 skills with `canDoStatement`, `evalTier`, `estimatedHours` and expert-seeded `bktPriors`; the `hard`/`soft` dependency graph; ~40 diagnostic items spanning MCQ, short free-text, "explain this", code-read and one micro-artefact task; 4 project briefs each with a full ≥4-criterion rubric. Written as YAML against the §7.1 shape.

I draft it; you review and edit. It is the seed data E2 loads and the graph E5 plans over, so its shape settles every schema in the system — which is exactly why the plan wanted it done first.

## Step 3 — E2 Domain Pack system (§24 E2, §7.1, §7.2)

- `src/lib/packs/types.ts` — Zod schema for `DomainPack` per §7.1, including `evalTier` 1–5 and the `evidenceType → workspace` mapping so that adding a domain stays a data change (§7.3 rule 1).
- `src/lib/packs/validate.ts` — the build-time gate: DAG acyclicity (a cycle is a build failure), no orphan skills, rubric coverage (every project has a rubric with ≥4 criteria), item-count minimum per skill, and the §16.4 pack rule that free-text/produce-an-answer items outnumber MCQ ≥2:1.
- `src/lib/packs/loader.ts` + `src/lib/packs/seed.ts` — `pnpm packs:validate` (CI gate) and `pnpm packs:seed` (idempotent upsert into Postgres).
- `src/app/admin/packs/[slug]/page.tsx` — renders the skill graph as a layered DAG (grouped by `Skill.level`, plain SVG, no graph library) with tier badges and the pack's maturity badge.

**Accept:** the SQL pack loads; a deliberately cyclic fixture pack fails with a clear error naming the cycle; `/admin/packs/sql-data-analysis` renders the graph.

## Step 4 — E5 Mastery model + deterministic planner (§24 E5, §16) — the core of this pass

All pure functions in `src/lib/engine/`, no I/O, no LLM call anywhere in the path.

- `bkt.ts` — the four-parameter update from §16.2 exactly as specified, with the observation-confidence blend `p_new = p + c·(p' − p)`. **Hard rule from §7.2 enforced here, not in a prompt: a Tier 5 observation can never raise mastery** — it returns the prior unchanged and is logged as engagement.
- `decay.ts` — `mastery_effective = mastery × 0.5^(days/halfLife)`, half-life starting at 7 days, doubling per successful spaced retrieval, capped at 180. This is what generates `retentionUrgency`, so spaced repetition falls out of the model rather than being bolted on.
- `scoring.ts` — the nine-term score from §16.1 with the weights as written, the eligibility filter (hard prereqs ≥0.7, own mastery <0.85, on a path to a goal skill), and the deadline override (×2.0 on `goalCriticality`, non-essential skills dropped, and the user *told* what was cut).
- `session-composer.ts` — fills available minutes: always opens with 2–4 retrieval items from the spaced queue; every 4th session is an `apply` session producing a gradeable artefact; `explain` blocks capped at 50% of duration. These are code invariants over the `SessionBlock` discriminated union from §14.9.2, not prompt suggestions.
- `reason.ts` — the one-sentence `/today` explanation, **template-filled from the score components**, never LLM-generated, so it is truthful and free.
- `planner.ts` — the composed entry point: `plan(input) → PlannedSession`.

**Determinism is a design constraint, not a hope:** `now` is injected rather than read, no `Math.random`, ties broken by `(score desc, skillId asc)`, and all object keys serialised sorted.

**Accept:** 20 hand-written scenario fixtures (`tests/engine/fixtures/*.json`) covering fresh beginner, expert with one gap, returning after 3 weeks, repeatedly failing one skill, hard deadline, 1h/week, 20h/week, and the tier-5-only learner; snapshot-tested, asserted byte-identical on repeat runs, and executing in <50ms. Property tests on the mastery model: monotonic under repeated correct observations, decays correctly over simulated time, and a Tier 5 observation never moves the number.

## Step 5 — Contracts and model constants for later epics

`src/lib/contracts/` gets the Zod schemas from §14.9.2 that this pass consumes (`SessionBlock`, `MasteryUpdate`, `SkillProjection`) — the rest are added by the epics that own them, so nothing is written speculatively.

`src/lib/ai/models.ts` records the exact model IDs the later epics route to, since the plan names models by friendly name only: `claude-opus-5` (evaluation, validation, authoring), `claude-sonnet-5` (generation, tutoring), `claude-haiku-4-5` (classification, closed-item grading). No client is instantiated and no call is made this pass; `.env.example` documents `ANTHROPIC_API_KEY` as required from E3 onward.

---

## Files that matter most

| Path | Why |
|---|---|
| `src/lib/engine/planner.ts` + `scoring.ts` + `bkt.ts` | The product's brain; the one thing the plan says never to cut |
| `src/lib/packs/validate.ts` | The gate that makes "horizontal" mean declared depth rather than faked depth |
| `packs/sql-data-analysis/pack.yaml` | Seed data whose shape settles every schema in the system |
| `src/db/schema/*.ts` | §15's bold entities; `LearnerSkillMastery` is called out as the single most important table |
| `src/lib/theme.ts` + `scripts/build-tokens.ts` | Single source for both themes; the drift check is what stops them diverging |
| `src/app/(app)/layout.tsx` | Layout-level `noindex` — the structural reason app routes can't leak into the index |

---

## Verification

Run in order; each is a real check, not a smoke test.

1. `docker compose up -d && pnpm db:migrate && pnpm packs:seed` — schema applies, pgvector extension present, SQL pack seeds.
2. `pnpm packs:validate` — passes on the SQL pack; then `pnpm packs:validate --fixture cyclic` fails and names the cycle. Also fixtures for an orphan skill, a rubric with 3 criteria, and an MCQ-heavy item bank.
3. `pnpm test` — the 20 planner scenarios (snapshot + byte-identical repeat + <50ms), and the BKT property tests including the Tier-5-never-raises-mastery assertion.
4. `pnpm dev`, then:
   - `curl -s localhost:3000/ | head -60` — `<title>`, description and canonical appear inside `<head>`, before any body content. Checked against raw HTML, not the browser DOM.
   - `curl -s localhost:3000/today | grep -i noindex` and `curl -s localhost:3000/robots.txt` — app routes noindexed and disallowed.
   - `/design` in light, dark, and system, plus the toggle overriding the OS in both directions; run `axe` against it in both themes.
5. Sign up through the UI → land on an empty `/today`. Trigger the trivial Inngest function from the dev server UI and see it complete.
6. `pnpm build && pnpm lint && pnpm typecheck` — and confirm the marketing route's JS payload is under the 80KB budget from §13.3.

## Explicitly not in this pass

Goal intake, adaptive diagnostic, curriculum generation and validator, session engine, tutor, submissions, the Evaluation Agent, SEO pages, free tools, billing, emails. These are E3–E13 and depend on either an API key or the primitives built here.

---

# Delivery record — pass 1

Written after the fact. The plan above is what was approved; this is what was
actually built, what changed along the way, and what is still open.

## Delivered

| Epic | State | Notes |
|---|---|---|
| **E1 Foundation** | Done | Next 16.3 with the `(marketing)`/`(app)` split, 39-table Drizzle schema, Postgres 17 + pgvector via Docker, Better Auth, Inngest, env-guarded observability, design system, CI |
| **E2 Domain Packs** | Done | Zod schema, validator with 13 checks, loader, idempotent seeder, `/admin/packs/[slug]` DAG viewer |
| **Phase 0 SQL pack** | Drafted — **needs your review** | 26 skills, 42 dependencies, 52 items, 4 projects, 4 rubrics. Set `quality.reviewedBy` in `pack.yaml` once you have read it end to end |
| **E5 Mastery + planner** | Done | BKT with decay, nine-term deterministic scorer, session composer, template-filled reason, 20 scenario fixtures |

733 tests, 100% coverage (statements, branches, functions, lines) across `src/`.

## Defects found and fixed while building

Each of these was caught by a test rather than by inspection:

1. **The hard damper did not damp.** §16.1 says "back off, don't grind", but a
   twice-failed skill still ranked first when nothing else was eligible, so the
   planner scheduled *more of the same* — and the reason told the learner "you've
   got the groundwork in place". Now a backed-off session serves a worked example
   with no artefact to submit, and says so.
2. **The reason sentence could contradict the evidence.** It ranked score
   components by signed value, so the largest *positive* term led even when a
   large negative term had actually decided the choice. Now ranked by magnitude,
   with a separate set of honest negative phrasings.
3. **`internal_link` had no primary key.** A table with no addressable row.
4. **`--ink-faint` failed WCAG AA** at 2.64:1 on white — below even the 3:1
   large-text bar, and §8.5.4 names this exact pair as the most likely to fail.
   Both themes retuned to clear 4.5:1 on every surface they appear on.
5. **A dangling dependency edge was accepted** by the graph index when only one
   endpoint existed.
6. **Sign-in hung forever on a network error.** A rejected promise skipped
   `setPending(false)`, leaving the button disabled with no message. Found by
   chasing the last uncovered branch.

## Deviations from the plan

- **Next 16.3, not 15** (flagged at plan time). The metadata-streaming risk that
  motivated the plan's version pin does not occur — verified by `curl` on raw
  HTML, and now a CI gate.
- **Tailwind v4 CSS-first tokens**, not a `tailwind.config` plugin (flagged at
  plan time). The palette is authored once in `src/lib/theme.ts` and emitted to
  `src/styles/tokens.css`; CI fails if the checked-in file drifts.
- **A JS-free theme control on marketing routes.** The Radix version pulled the
  client runtime into the landing page, which §8.5.8 forbids.

## Open — needs a decision

**§13.3's 80KB marketing JS budget is not reachable on Next 16 App Router.**
Measured on both Turbopack and webpack production builds: an empty static page
costs ~166KB gzipped first-load (React 19.2 + the App Router client runtime).
The landing page adds ~3.5KB of our own code on top. Options: accept the floor
and restate the budget, pin an older Next major, or serve the marketing surface
from something other than React. This is an architecture call, not a code fix.

## Not in this pass

E3 (goal intake), E4 (diagnostic), E6 (curriculum + validator), E7 (session +
tutor), E8 (evaluation agent), E9–E13. All either need `ANTHROPIC_API_KEY` or
build on the primitives above. `src/lib/ai/models.ts` records the model IDs the
later epics route to.
