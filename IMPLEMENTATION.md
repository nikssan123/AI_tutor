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

---

# Delivery record — pass 2: the horizontal catalogue

Triggered by a single observation: *"Still feels too tech oriented — the idea is
that all kinds of users can sign up to learn all kinds of skills, not only
technical."*

That was a content problem wearing a copy problem's clothes. The product had one
pack, and it was SQL, so every page the content model derived — every project
brief, every subject card, every autocomplete suggestion — was about databases.
No amount of rewriting the hero could fix a catalogue with one subject in it.

## Two new Curated packs

| Pack | Taxonomy | Tier | Workspace | Skills | Items | Projects |
|---|---|---|---|---|---|---|
| `business-writing` | professional-business | 2 | text | 14 | 33 | 3 |
| `photography` | creative | 3 | media | 15 | 32 | 3 |
| `sql-data-analysis` | technical-entry | 1 | query-sheet | 26 | 52 | 4 |

The tier spread is the point, not a coincidence. §7.3 claims adding a domain is
a data change requiring no code; that claim was untested while every pack shared
one tier and one workspace. It now holds across three of each, and the landing
page shows all three honesty claims stacked together — which is the only way a
reader learns that "verified" means something specific.

Photography is deliberately Tier 3, and its three rubrics contain **no aesthetic
criterion**. §7.2's promise at that tier is "technical feedback; aesthetic
judgement is yours", and a rubric scoring beauty would break it. A test enforces
this: any rubric in a Tier 3+ pack whose criteria mention beauty, artistry or
"pleasing" fails the build.

## Defect found: the briefs overclaimed

`/projects/[slug]` hardcoded the Tier 1 evaluation note, so the photography
brief — graded at Tier 3, where the system explicitly cannot judge the result —
told readers *"Verified: your work is run and checked."* That is §4.2 law 3
("never overclaim") violated on the page whose entire job is to state the
grading contract before the work starts.

Invisible while every pack was Tier 1. Fixed by carrying `evalTier` from the
pack onto `ProjectDetail` and deriving the note from it, with a per-project test
asserting each brief states its own claim *and none of the others*. The landing
page's blanket Tier 1 note is gone for the same reason.

## Tests

864 passing, 0 skipped, 100% statements/branches/functions/lines maintained.

Two additions worth naming, both encoding a promise rather than a behaviour:

- **`spans domains, tiers and workspaces`** — asserts the catalogue covers three
  taxonomies, three tiers and three workspaces. If it ever collapses back to a
  single technical subject, the product has quietly become a developer tool and
  this fails.
- **`tests/app/marketing-indexable.test.tsx`** — every real pack ships
  `reviewedBy: unreviewed`, so the open side of the §12.1 gate was never
  exercised. It now runs against a reviewed fixture, so the path a launch takes
  is tested before launch rather than discovered during one.

Counted assertions ("all four briefs", "26 skills") were replaced with ones
derived from the packs, so pack #4 does not break the suite. One pinned
assertion remains, listing the packs by name, so a pack disappearing from disk
still fails loudly.

## Still open

The 80KB JS budget decision above. And every pack remains `unreviewed`, so
`/learn/*` and `/projects/*` serve as `noindex, follow` and the sitemap lists
only the three hubs — the §12.1 gate working as designed. Setting `reviewedBy`
in each `pack.yaml` after reading it end to end is what opens it.

---

# Delivery record — pass 3: making the landing page legible

*"I don't really understand it — it's like you know what the site is about but
for normal users it's not very clear."*

Correct, and the cause was specific: the page was written in our vocabulary, not
a visitor's. "Deeply supported", "Verified: your work is run and checked",
"4 criteria · 75 min", "Check → Path → Prove" — every one of those is precise
and meaningless to someone meeting the product for the first time. The page
asserted that it was concrete instead of being concrete.

## What changed

- **Headline states the problem, not a slogan.** "Don't just learn it. Prove
  it." → "Anyone can teach you. Almost no one checks whether you learned it."
- **Five steps written as things that happen to you**, replacing the three
  abstract nouns. Step 4 quotes a real task so the promise stays tied to content
  that exists.
- **One real task with its complete marking checklist, reproduced in full** —
  "Tell them the deadline is slipping", with all four criteria, their weights,
  and what full marks means for each. This replaced a list of brief titles. It
  is the most convincing artefact the product has, and it was previously three
  clicks away.
- **Tier and maturity language rewritten in plain English.** "Assessed against
  the published rubric" → "We grade it against a checklist you can read first".
  "Technical feedback; aesthetic judgement is yours" → "We check the technical
  side — whether it's any good is your call". "Deeply supported" → "Written and
  checked by hand".
- **Footer no longer restates the headline.**

§8.5.1's density rule still holds: five things at rest (hero, walkthrough,
checklist, subjects, limits). The budget is the same, spent on concrete things.

## Hydration warning — investigated, not reproduced

Reported mid-pass. Checked properly rather than guessed at:

- SSR output is byte-identical across repeated requests on `/`, `/learn`,
  `/projects`, `/today`, `/sign-in`, `/design` (Next's dev-only request id
  aside), and there is no `Date.now`, `Math.random` or locale formatting
  anywhere in `src/components` or `src/app`.
- Headless Chrome with a clean profile produced **zero** hydration console
  output on every one of those routes, and no unexpected attributes on `<html>`
  or `<body>`.
- The one pre-hydration DOM mutation we make (the anti-FOUC script setting
  `data-theme`) is on `<html>`, which carries `suppressHydrationWarning`.

The remaining likely cause is a browser extension writing attributes onto
`<body>`, which is the classic source of that exact message and which `<body>`
is not currently guarded against. Not fixed blind — the full error text names
the attribute, and that is what would settle it.

## Separately found: the marketing theme toggle lies about its state

`ThemeToggleStatic` renders `aria-pressed` on "system" unconditionally, and its
inline script only updates the pressed state **on click**. So a visitor who has
previously chosen dark sees the correct theme with "system" shown as selected.
Cosmetic, real, and not yet fixed.

---

# Delivery record — pass 4: structure, not just wording

*"There is just too much text and no clear sections — feels like there is just
a long list of stuff."*

Pass 3 fixed the vocabulary but not the shape. Every block was still a
paragraph at the same visual weight, so there was nothing to tell a skimmer
where one idea ended and the next began — five sections of prose read as one
list.

## The rule now enforced on this page

**One line per idea, and never two paragraphs in a row.** Prose is reserved for
the hero. Everything after it is a numbered section with a rule above it, and
rows readable at a glance.

- `SectionHead` — a numbered eyebrow ("01 · How it works") over a rule. Gives
  the eye somewhere to land and tells a skimmer how much is left.
- Steps went from a paragraph each to a bold line plus one short line.
- The marking checklist went from four blocks of description + band text to
  four rows of `criterion — weight`, with a link to the full version. The
  detail still exists on `/projects/[slug]`, which is where someone who has
  decided to care will go.
- Column narrowed from `max-w-3xl` to `max-w-2xl`; section gap 24 → 16.
- Maturity badges dropped from the landing page (they live on `/learn`), so
  each subject row carries one claim rather than two.

Visible copy is now ~385 words for the whole page.

Also fixed: the hero and step 1 opened with the same sentence, and the
Organization structured data still carried the old "AI coach... evidence-backed
record" line, which no longer matched anything a visitor reads.

867 tests, 100% coverage, build clean.

---

# Delivery record — pass 5: the icon set

Six hand-drawn icons in `src/components/icons.tsx`, plus an icon slot on
`SectionHead`.

## Why hand-drawn rather than a package

§8.5.8 caps marketing routes at **zero component-library JavaScript**. Every
icon library — lucide, heroicons, phosphor — ships a React component per glyph
and pulls the client runtime into a route that currently has none. Six inline
paths cost nothing and render in the server HTML, which is verifiable: `curl` on
`/` returns six `<svg viewBox="0 0 24 24">` elements with no script involved.

## House rules, enforced by test rather than review

An icon set decays one addition at a time, so the rules are asserted across
every icon:

- 24×24 viewBox, 1.5 stroke, round caps and joins.
- **`currentColor` only.** An icon that names its own colour needs a second
  definition for dark mode and will be forgotten (§8.5.4). The test greps the
  rendered markup for any hex, `rgb()` or `hsl()` literal and fails on one.
- `aria-hidden` and `focusable="false"` — each sits beside a text label that
  already carries the meaning.
- A passed `className` merges rather than replaces.

## Where they went

| Surface | Icons |
|---|---|
| Landing `SectionHead` | steps, checklist, grid — one per numbered section |
| Landing + `/learn` subject rows | pen / camera / database, by taxonomy |
| `/learn/[topic]` title | the subject's own mark |
| `/design` | all six, so the drift guard covers them |

`SubjectIcon` maps `taxonomyParent` → mark, so adding a Domain Pack picks up the
right icon without touching a component (§7.3 rule 1). Unknown or absent
taxonomy falls back to the neutral grid rather than guessing at a metaphor; both
fallbacks are tested.

Threading `taxonomyParent` onto `TopicSummary` surfaced that it is nullable in
the pack schema — typed through as `string | null` rather than asserted away.

894 tests, 100% coverage, build clean.

## Hydration warning — closed

Confirmed gone by the user, consistent with the investigation in pass 3: nothing
in our render was mismatching. No code change was made for it, and none was
needed.

---

# Delivery record — pass 6: E4, the Skill Check

*"The learn section feels too generic — I don't feel like actually learning."*

Correct, and the honest diagnosis was that `/learn/*` and `/check/*` were a
catalogue and a landing page for a tool that did not exist. The teaching loop
(E4, E6, E7, E8) was all deferred behind `ANTHROPIC_API_KEY`.

E4 is the piece that does not need the key, so it is built.

## What it is

A working adaptive diagnostic at `/check/[topic]`, linked from every subject
page. One route, four states — intro, question, self-mark, result — each
transition a plain form POST to a Server Action. **Zero client JavaScript**:
verified by serving the page and counting script tags, which match the landing
page's baseline exactly. It works with JS disabled.

## The design problem, and the honest answer

A machine with no evaluator can only *verify* a closed item. The packs are
production-heavy by design (§16.4 requires production items to outnumber MCQ
2:1), so across all three packs there are 117 items and only **16** that a
machine can decide.

Pretending otherwise was the one thing not on the table. So:

| Item type | Count | How the check treats it |
|---|---|---|
| `mcq` | 16 | Graded deterministically. Tier 1. Moves mastery. |
| `short_text`, `explain`, `code_read` | 68 | Answer, then the key is revealed and **you** mark it. Tier 5. Recorded, never counted. |
| `micro_artifact` | 33 | Excluded — that is project work, not a ten-minute check. |

The Tier 5 rule is enforced in the BKT, not in the UI, so the result screen
cannot drift from it: a learner can mark themselves correct on every open
question and the result still says *"Nothing here could be machine-marked."*
That is asserted end to end in `tests/engine/diagnostic.test.ts`.

A real photography run reports **2 of 15 skills machine-marked**, everything
else "Not assessed". Thin, and true.

## Notable engineering

- **Selection is coverage-first, information-second.** The first cut was purely
  information-greedy and drilled a single skill, because answering correctly
  moves a posterior *towards* 0.5 — exactly where items are most informative.
  Right for grading one skill, wrong for "find my gaps". Fewest-observations now
  wins outright; ties break on information, then slug.
- **State lives in a cookie holding only answers**; mastery is replayed through
  the engine on every request. Sound because selection is deterministic, and it
  means a forged cookie cannot invent a mastery score — only lie to itself,
  which the Tier 5 rule already neutralises. No anonymous identifier is minted
  and no row needs expiring.
- **Bug found in review:** the question counter read `cookie.a.length` while
  completion read the replayed state. A stale cookie referencing removed items
  desynchronised them into "Question 10 of 9" and a check that never ended. The
  cookie is input; the engine state is the authority.

998 tests, 100% coverage, build clean.

## Finding — the item bank is the bottleneck

16 closed items across 55 skills is not enough for a check to say much. Nothing
is wrong with the code; the packs need more `mcq` items, and §16.4's 2:1 ratio
leaves room for roughly 39 before the constraint binds. That is authoring work,
not engineering.

---

# Delivery record — pass 7: the signed-in loop

Everything built so far worked for someone who had not signed up. A signed-in
learner reached an empty `/today` and a note saying the planner existed. E5 was
finished in pass 1 and had never once run against a real learner.

This pass connects them, with **no LLM call anywhere in it**: goal → skill
projection → seeded mastery → a planned session on `/today`.

## What it is

| Piece | Where | What it does |
|---|---|---|
| `GoalSpec`, `SkillProjection` | `src/lib/contracts/goal.ts` | §14.9.2's step contracts, as Zod |
| Goal intake | `/start` + `src/lib/goals/intake.ts` | Form → `GoalSpec`, no model involved |
| Skill projection | `src/lib/goals/projection.ts` | Pure: required / optional / skipped, with reasons |
| Goal store | `src/lib/goals/store.ts` | The slug ↔ UUID seam, in exactly one place |
| `/today` | `src/app/(app)/today/page.tsx` | The planner's real output, reason sentence and all |

E3's remaining half is the Goal Analyzer — turning "I want to switch into data"
into these fields. That needs the key. Everything the analyzer would *produce*
now has a working consumer, which is the useful half to have built first.

## Three things worth naming

**The projection ignores the stated level.** The form asks where you're
starting from because §8 screen 3 asks; §7.2 puts self-report at Tier 5, and
Tier 5 never moves the record. So nothing in `projection.ts` reads it, and a
test asserts a claimed expert is projected exactly like a claimed beginner. It
would have been very easy to skip ahead on someone's own say-so and call it
personalisation.

**Exclusion requires evidence, not a high number.** A pack whose priors start a
skill above 0.85 has said nothing about *this* learner, so that skill stays on
the path. Only `evidenceCount > 0` and effective mastery over the bar takes it
off, and the reason quotes the skill's own can-do statement rather than a score.

**The anonymous check survives signup** (§24 E11) by being *replayed*, not
copied. The cookie holds answers; mastery is recomputed through the same BKT.
A forged cookie can therefore only claim which answers were given — and
self-marked answers are Tier 5, which the engine refuses to let raise mastery.

## Two defects found in existing code

1. **`learner_skill_mastery` had no column for the field the decay model
   reads.** It stored `last_observed_at`, which duplicates `last_practiced_at`;
   the engine decays from `lastSuccessAt`, and that had nowhere to live. The
   test covering the column even said "decay is measured from the last success,
   not the last attempt" while asserting the wrong name. Renamed in migrations
   0003/0004 — the column had never been written to.
2. **Two formulas for remaining hours.** The deadline check computed one; the
   path estimate was about to compute another. Extracted to
   `remainingHoursFor`, because two hour counts that disagree would disagree in
   front of the learner.

Also extracted `toDiagnostic` so the check screen and goal intake build engine
inputs identically — otherwise answers given before signup could reconstruct
into a different mastery state afterwards, silently.

## Verification

1072 tests, 100% coverage on every file in this pass, `typecheck`, `lint`,
`tokens:check`, `coverage:audit` and `packs:validate` all clean.

## Still open

The 80KB marketing JS budget. Every pack still `unreviewed`. And `/today` shows
the session it would run rather than running it — the session runner is E7, and
it needs the key.

---

# Delivery record — pass 8: E6's gate, and the first real model calls

You added `ANTHROPIC_API_KEY`, which unblocks E6–E8. This pass builds E6's
half that matters most — §14.6's Curriculum Validator, "the anti-mediocrity
gate" — plus the model layer E7 and E8 will also sit on.

## Verified against the real API, not written blind

A live run against `photography`, before any of it was committed:

- Sonnet 5 returned a valid 17-module curriculum in 41s, **first attempt**, no
  schema retry needed.
- All four blocking checks passed.
- Three warnings fired, and every one was a **real finding**: the path spent 30
  of the 45.5 available hours, its difficulty ramp stepped backwards three
  times, and Opus 5's adversarial pass caught an acceptance criterion in module
  0 that cannot be met as written.

That last one is the argument for the whole gate. A curriculum that reads
perfectly can still ask for something impossible, and no amount of prompting
catches it as reliably as a second model told to go looking.

## The gate

Eight of §14.6's nine checks are pure code in `src/lib/curriculum/validate.ts`.
Only the factual spot-check needs a model, and it is **injected**, so the cheap
deterministic checks can never quietly acquire a dependency on the expensive
non-deterministic one. The report always carries all nine, in the plan's order —
§24 E6 asks for "all nine checks run *and are reported*", and a check that
silently stopped running is exactly what that phrasing guards against.

Two severities were a judgement call the plan leaves open. `no_already_mastered`
and `rubric_coverage` are **blocking**: the first is the product's central
promise, and the second is §4.2 law 2 — the bar is published before the work
starts, so a project nobody can grade is not shippable.

## The model layer

`callStructured` is the one place a model call is made, and it encodes §14.9's
rules as code rather than as prompt text:

- **Structured output via tool use, enforced twice.** The JSON Schema steers;
  the Zod contract decides. Structured outputs cannot express array bounds,
  string lengths, or numeric floors — half of what §14.9.2's contracts assert —
  so a schema-only guarantee would be about shape, not content.
- **The cache breakpoint sits on the frozen system prompt** (§14.9.4), with
  volatile learner state strictly after it. `cacheReadInputTokens` comes back on
  every result, because §14.9.4 is explicit that a silent cache miss "triples
  the bill with no error and no log line".
- **Schema failure retries exactly once, naming what was wrong** (§14.9.5).
  A refusal is never retried and `stop_reason` is read before content.
- **Prompts are versioned constants in git** (§14.9.6) — a prompt change is a
  reviewable commit, not an edit in an admin screen.

## Deviation, flagged

§14.6 specifies embedding similarity for the redundancy check. There is no
embedding provider here, and adding one to compare 40 short strings would be a
dependency bought for a rounding error. It is lexical cosine instead — which
catches the case E6's acceptance criteria actually name (duplicate modules) and
would miss two paraphrases sharing no vocabulary. Named in the source, not
buried.

1174 tests, 100% coverage, `pnpm verify` clean.

## E6 is not finished

Built: the validator, the architect, the spot-check, the model layer. Still
open: the repair loop that applies the `repair` payloads the checks already
emit, the fall-back-to-canonical-path after two failures (§14.9.5), persistence
into `Curriculum`/`CurriculumModule`, and `/goals/[id]/path`. The pieces above
are the ones the rest depends on, and they are the ones worth verifying against
a real model first.

---

# Delivery record — pass 9: logging what the AI calls cost

§14.8 requires every `AgentRun` row to record "the exact version, model and
cost", and §14.9.7's spend cap reads a ledger that nothing was writing. The
tables existed since pass 1; nothing filled them.

## What is logged

Every model call now writes an `agent_run` row — **including the ones that
failed**. A refusal and a schema retry both cost real money, so a log that
recorded only successes would under-report exactly when something is going
wrong, which is when the number matters most.

| Where | What |
|---|---|
| `agent_run` | prompt name + version, model, status, cost in cents, latency, error |
| `spend_ledger` | per-user, per-month running total, accumulated in SQL |
| `agent_run` analytics event | the above, plus the token split and the **uncached** cost |

Cost is computed, not returned: the API gives token counts, and the price of a
token depends which of four buckets it landed in. `pricing.ts` holds the rates
next to the model they belong to, keyed by `ModelId` so adding a model without a
price is a type error rather than a silently free model.

Two decisions worth naming. An unpriced model logs `null`, never `0` — a zero
would enter the ledger as "this call was free", which is a lie that accumulates.
And the ledger's `(user, period)` index became **unique**: without it two
concurrent calls each insert a row and the cap reads half the real total, which
is the one direction §14.9.7 cannot tolerate being wrong in.

Every call also reports what it *would* have cost with no prompt cache. §14.9.4
calls caching "the single largest lever" and asks for the saving to be verified
rather than assumed; shipping both numbers is what makes a silent cache miss
visible instead of merely expensive.

## Defect found by the probe, not by the tests

**Haiku 4.5 rejects `thinking: {type: "adaptive"}` and `output_config.effort`
with a 400.** `callStructured` sent both unconditionally, so every call routed
to the fast tier — `artifactIngestor`, `coherenceCheck` — would have failed
outright in production. E6 only ever used Sonnet and Opus, so nothing caught it
until a live call to the fast tier was actually made.

The parameters are now sent only where the model has them, and an unrecognised
model gets the conservative answer: omitting them costs a little quality,
sending them costs the whole call.

## Also learned from the live run

Cache counters came back zero on Haiku because the **minimum cacheable prefix is
model-dependent** and the probe's system prompt sat under it. Zeroes on those
counters therefore mean "prompt too short" at least as often as "cache miss".
That is now written next to the breakpoint, because the two readings call for
opposite responses.

Verified end to end: two live Haiku calls logged two `agent_run` rows at
0.186c and 0.183c, accumulating to a single ledger row of 0.369c for 2026-08.

1180 tests, 100% coverage, `pnpm verify` clean.

---

# Delivery record — pass 10: finishing E6

Pass 8 built §14.6's validator and the model layer. This closes the epic: the
repair step, the canonical fallback, persistence, and the path screen.

## §14.6's policy, as control flow

> "Fails closed: a failed check regenerates that portion, and after 2 failures
> it falls back to the pack's canonical path."

`generate.ts` is that sentence:

1. Generate → validate. Passing curriculum ships as-is.
2. Failing but **mechanically** repairable → repair, re-validate, ship if it
   now passes. No second generation spent on something the graph already knows
   how to fix.
3. Otherwise regenerate, once.
4. Still failing → the canonical path.

`repair.ts` applies only the fail actions that are decisions the graph and the
mastery state have already made — insert the missing prerequisite, drop what the
learner demonstrated, merge duplicates. "Regenerate", "rescope" and the human
review queue are judgement calls and stay with the caller. Every drop comes back
phrased for the learner, because §14.6 asks for it to be *shown*, not just done.

`canonical.ts` is pure code, and that is the point: it is what a learner gets
when the model could not produce something valid, so it cannot itself depend on
a model. Topological order with ties broken by (level, slug) — deterministic,
and every blocking check satisfied by construction rather than by luck. It is
still run through the validator, because "built to pass" and "passed" are
different claims and only one of them is checked.

It returns `null` rather than padding when fewer than three skills remain.
Inventing work to clear the contract's floor would be worse than saying there is
no path.

## The path screen

`/goals/[id]/path` renders the DAG with the accent outline on what is **next**
rather than on what is finished — the question the page answers is "what am I
doing". Below it: the modules in order, what was skipped and why, and the
validator's own report, so a learner can see what was checked before they were
shown anything. No percentage anywhere (§24 E9), asserted by test.

Generation is a button on that page, not part of the goal form. §14.9.3 says
"sync only where a human is waiting": creating a goal stays instant, and the
minute-long wait happens where it was asked for. Moving it to Inngest is E7's
job.

## Two things worth naming

**The prerequisite check treats a module's own skills as covered.** §14.4 allows
three skills per module and bundling a skill with its prerequisite is the most
natural use of that; the strict reading would have quietly pushed the architect
towards one skill per module. Found by a test that disagreed with the comment
above the code it was testing.

**A canonical fallback is stored `validated`, not `active`.** It is a real
curriculum a learner can work from, but flattening it into the same status as a
tailored path would lose exactly the signal §14.9.5 asks to be logged for pack
improvement.

## Fixed: a test of mine polluting shared state

The anonymous-run test in `tests/ai/runlog.test.ts` left an `agent_run` row
behind — a null `userId` has no user to cascade from — which broke a
concurrently-developed suite that aggregates spend. Now cleaned up explicitly.

## E6 is done

All nine checks run and are reported; a curriculum with a missing prerequisite,
duplicate modules, or 400 hours against a 20-hour budget is caught, and the
first two are repaired; the path page renders the DAG and shows what was
skipped and why.

---

# Delivery record — pass 11: the rest of authentication

E1 shipped Better Auth with email and password, and the audit that opened this
pass found the loop half-closed: **there was no sign-out anywhere in the
codebase**, no password reset, no email verification, no way to change an
address, and no profile screen. Someone who signed up could get in and could not
get out, and a forgotten password was the end of the account.

This closes all of it, plus Google.

## The email layer, because five of the six features are emails

`src/lib/email` is wired the way observability is (§14.8): the interface exists
from the first commit and the absence of a key degrades to something *visible*.

With no `RESEND_API_KEY`, `LogTransport` prints the whole message to the server
console — body, link and all. That is the entire point. A local environment
where sign-up sends nothing and says nothing is one where nobody exercises
verification until production does it for them. With a key, `ResendTransport`
POSTs to Resend over plain `fetch`; §18.1 also names React Email, which is a
build-time JSX renderer, and these are three messages with one button each.

`deliver()` never throws. Every caller is an auth flow, and in all of them a
lost email beats a 500: a sign-up that fails because Resend is having an
afternoon leaves someone with no account and no explanation, while a lost
verification mail leaves them signed in with a resend button.

Templates are pure functions with escaped interpolation. Not theatre — the
change-email mail is deliberately sent to an address that may no longer belong
to the account holder, so an unescaped display name is markup injected into a
stranger's inbox.

## What each flow actually does

| Flow | Decision worth defending |
|---|---|
| **Verification** | Sent on sign-up, **not required** to sign in. §8 is "show value first"; an inbox round-trip between signup and the plan is where people leave. The header says what is at stake instead, in words: an unconfirmed address cannot be sent a reset. |
| **Reset** | One hour, single use, and `revokeSessionsOnPasswordReset: true`. Better Auth defaults that off, which leaves the thief signed in on their own machine while the owner congratulates themselves on a new password. |
| **Change email** | The approval link goes to the address being **left behind**. That is the whole security property: a stolen session can ask to move an account, and only the address the real owner still reads can approve it. |
| **Google** | Registered only when both halves of the credential exist — a blank client id fails at Google's redirect with an opaque error page, which is worse than not offering it. `requireLocalEmailVerified` is pinned `true`: without it, anyone can register `victim@gmail.com`, never verify, and wait for the real owner to arrive via Google, at which point the accounts link and the attacker's password still works. |
| **Sign-out** | A form and a Server Action, never a link. A GET that ends a session is one prefetch away from ending it by accident. |

## Server Actions, not the client SDK

`/account` posts every form to a Server Action and reads the outcome back out of
the query string, so the screen ships **no JavaScript** — including on the day a
bundle fails to load, which is exactly the day someone needs to change a
password. It also unlocks something the client SDK cannot reach:
`auth.api.setPassword` is a `serverOnly` endpoint, and it is the only way to
give a Google-only account a password. Without it, "disconnect Google" is
refused forever and the account is permanently tied to one provider.

`nextCookies()` is what lets those actions set cookies, and it has to stay last
in the plugin list.

## A DAL, which is what the audit was really pointing at

`src/lib/account/session.ts` — `requireUser()`, memoized with `cache`, per Next's
own guidance (`01-app/02-guides/authentication.md`). Three pages had been
repeating the same four lines of `getSession`-then-`redirect`; the repetition was
never the problem, the problem is that a fourth page can forget them and nothing
fails. It returns a DTO rather than `session.user`, so whatever Better Auth adds
to that object next is not silently serialised into a page.

The header lives in `(app)/layout.tsx` and is **chrome, not a boundary** — the
same distinction `admin/layout.tsx` already documents.

## One deployment bug fixed on the way past

`auth-client.ts` read `NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`. Only
`NEXT_PUBLIC_*` variables are inlined into the browser bundle, so forgetting that
one in production shipped a sign-in form that posted credentials to the
visitor's own machine. It now passes no `baseURL` at all: Better Auth's client
falls back to a relative `/api/auth`, which is right on every origin and has no
variable to forget.

## Not in this pass

Account deletion, a signed-in-devices list (Better Auth's `list-sessions`
requires a session under a day old, so it needs a re-auth step first), and a
"your password was changed" notification.

1550 tests. Every file added or touched here is at 100% on all four metrics.

---

# Delivery record — pass 12: plain language everywhere

A copy-only pass across both public surfaces — the four marketing routes and the
auth/account flow this repo had just finished. Not a redesign: no component, no
layout and no route changed shape.

## What was actually wrong

One habit, repeated everywhere: sentences built as aphorisms. A claim, an
em-dash, then an inversion that qualified it — "It cannot prove you can do the
work — only the work can do that", "Passing this moves these skills in your
mastery ledger", "Auth needs to exist here, not to be a feature". Each one asks
the reader to hold two clauses to receive one fact.

§8.5.1 has forbidden this from the beginning: *"Clarity over cleverness — plain
language everywhere."* It had only ever been enforced against layout. The
landing page had been through four cuts for **form** and none for **words**.

Three specific classes of defect, beyond the register:

- **Notes-to-self shipped as copy.** `/sign-in` opened with a design rationale
  ("nothing about signing in should be interesting") shown to someone trying to
  log in.
- **A spec reference leaked to visitors.** `/projects/[slug]` printed the string
  "§4.2 law 2" into the page.
- **Jargon that only means something in here.** "validated skill graph", "item
  bank", "mastery ledger", "capability statement", "pack", "machine-marked".
  User-facing "rubric" became "checklist" throughout; the `rubricDetail` data
  field keeps its name, because it is not copy.

## The headline

"Anyone can teach you. Almost no one checks whether you learned it." stated the
problem and left the reader to infer the offer. It is now "Learn anything. Then
prove you actually learned it." — both halves of the promise, in the order a
visitor would think them.

## One stale claim fixed on the way past

`/check/[topic]/[skill]` told visitors the assessment "needs the diagnostic
engine, which is the next piece of work". Written before E4 and left behind by
it: the engine exists and `/check/[topic]` runs on it. What is genuinely missing
is a check for a single skill on its own, so that is what the page now says.
§4.2 law 5 is only worth anything if the declared limit is the real one.

## Still mixed

"Graded" and "marked" both survive for the same act — "graded projects" in page
titles and search descriptions, "marked" in body copy. Choosing one is a
terminology decision that churns every SEO title, so it was left rather than
made silently.

1554 tests, 100% on all four metrics.

## Sign-up moved to its own screen, confirmed by code

`/sign-up` is now a screen, not a second button on the sign-in form. One form
doing two things was fine while both needed the same two fields; the moment
sign-up needed a confirmation field that sign-in must not have, the shared form
had to either grow a field that is wrong half the time or hide one
conditionally. Two screens is cheaper, and each gets an address people can be
sent to.

**Confirmation is a six-digit code, not a link.** The practical argument is that
a link hands the session to whichever browser the mail app opens, which is
frequently not the one holding the half-finished sign-up; the code never leaves
the flow the person is already in. The security argument is that a mail with no
URL in it cannot be re-pointed somewhere else and still look like ours — so
`verifyCodeMessage` contains no anchor at all, and the code is deliberately kept
out of the subject line, where a lock screen would show it.

Six digits, ten minutes, three attempts, stored hashed. Ten rather than Better
Auth's five-minute default because the reader is switching devices; three
attempts because a six-digit code has a million values and unlimited guesses
turn that into a number a script can walk.

`emailVerification.sendOnSignUp` had to go to `false` at the same time: the OTP
plugin's post-sign-up hook sends the code, and leaving the core flag on would
have sent a link *as well* — two emails and two mechanisms for one address. The
link path is still built, because `changeEmail` uses it to confirm a new
address, which is a different act from confirming the one you just signed up
with. `/account`'s resend now sends a code and lands on the screen that takes
it, so there is one way to confirm an address rather than two.

Verified live against the dev server and database, not only in tests: sign-up
returned an unverified user, the plugin stored a hashed code with a ten-minute
TTL, a wrong code came back `INVALID_OTP` and incremented the attempt counter,
and the right one flipped `email_verified` and issued a fresh session. (The
code was recovered from its hash locally to complete the round trip — which is
also the reminder that hashing is not what makes a six-digit code safe; the
three-attempt limit is.)

---

# Delivery record — pass 13: E7, the session runner and the tutor

`/today` had been showing the session it *would* run since pass 7. This runs it.

The planner has been finished since pass 1 and, until now, permanently planning
someone's first day: `todayFor` handed it `history: []`, `attempts: []`,
`retrievalQueue: []` and `sessionIndex: 1`, because nothing wrote sessions.
Four of §16.1's nine scoring terms read those. Writing them is most of this pass.

## What a session is now

`/session/[id]`, one block at a time, with visible progress. Every transition is
a form POST to a Server Action, so a session runs with **no client JavaScript** —
reading, answering, being marked, finishing. The tutor panel is the single
exception and says so in a `<noscript>`.

| Piece | Where |
|---|---|
| Session persistence, history, retrieval queue | `src/lib/session/store.ts` |
| Learner Context Block (§14.3) | `src/lib/session/context.ts` |
| Lesson Generator + Postgres cache (§14.9.4 layer 2) | `src/lib/session/lesson.ts` |
| Free-text grader (§14.2) | `src/lib/session/grade.ts` |
| One answered block, end to end | `src/lib/session/run.ts` |
| Streamed chat call | `src/lib/ai/chat.ts` |
| Tutor prompt, transcript, `Interaction` logging | `src/lib/session/tutor.ts` |

## Three decisions worth defending

**A written answer is never Tier 1 evidence.** Tier 1's claim is "verified: this
works", and it is earned by executing something — explaining a join in prose is
not running one. So `evidenceTierFor` caps a graded answer at Tier 2 and never
lets it beat the skill's own tier: a Tier 3 photography skill stays Tier 3
whatever the learner writes about it (§7.2).

**A grader that could not run did not pass.** A failed call records the answer,
moves the session on, and leaves mastery alone — `correct: null`, and the screen
says "not marked, this one doesn't count". Recording an unreachable model as a
wrong answer would back a learner off a skill because our grader was down; as a
right one it would put mastery on the board with no evidence under it (§4.2 law 1).

**The Learner Context Block carries no timestamp and no UUID.** It sits behind
the cache breakpoint, and §14.9.4's rules are all silent failures. Recency is
rendered in day-scale bands and mastery in words, so the prefix is byte-identical
across the minutes a session lasts. The consequence, stated because it matters:
the block is deliberately stale within the day. That is right for a tutor's
background knowledge and wrong for a grader's verdict, which is why grading reads
mastery directly instead.

## Defects found

1. **Retrieval check blocks put a queue id where the expected answer goes.** The
   composer wrote `expected: item.itemId`, and §14.9.2 defines `expected` as what
   a correct answer establishes. Invisible for six passes because nothing read the
   field; the first thing to read it was a grader, which would have marked every
   recall answer wrong. `expected` now holds the recall target and the id has its
   own field — which the runner needs anyway, or a learner with two queued items
   on one skill answers once and both come back.
2. **§14.9.3's "Effort / thinking" column had never been read.** Every structured
   call was sent at `effort: high`, including the eleven steps the plan marks
   "none". Found by a live lesson generation, not by a test. `STEP_EFFORT` now
   carries the plan's column and a caller can still override it.
3. **`nextSessionIndex` defaulted a row that always exists.** An aggregate with
   no `group by` returns exactly one row; the fallback was a branch nothing could
   reach, so it is gone rather than tested.

## Verified against the real API

A live run before committing: a lesson generated first attempt, a right and a
wrong answer marked with usable feedback, a misconception extracted verbatim
("joins only filter rows, reducing row count"), and two streamed tutor turns
that answered by building a three-row worked example rather than restating the
rule. Three things that run showed which no test would have:

- **The lesson costs 6.3c and takes 42s** against §14.9.3's $0.05 budget, because
  it comes back ~4,000 output tokens long against the plan's 3k. The page already
  streams its shell first and shows a skeleton, so this is a wait rather than a
  blank screen, but it is over budget and not yet fixed.
- **`cache_read_input_tokens` came back 0 on both tutor turns.** The breakpoint is
  placed correctly; the prefix is simply too short to cache. Our system prompt
  plus context block is ~750 tokens, under Sonnet's minimum cacheable prefix,
  because the block renders at ~270 tokens rather than the ~1,200 §14.3 assumes.
  So §24 E7's "tutor context is cached" holds in the test suite against a stub
  and does **not** hold live today. Padding the prompt to move the number would
  be buying the assertion rather than passing it.
- **A check generated from a compound can-do statement asks more than a writing
  box can hold.** "Join three tables at the correct grain **and prove** the totals
  were not inflated" is two questions; a learner who answered the first half was
  marked wrong, and defensibly so. The grader prompt now says plainly that the
  learner is writing *about* the skill rather than performing it, but the real fix
  is authored items with real answer keys — which is pass 6's finding about the
  item bank, arriving again from a different direction.

1763 tests, 100% on all four metrics, `pnpm verify` and `pnpm build` clean.

## Still open

The lesson's length budget. The 80KB marketing JS budget (untouched here — the
tutor panel is referenced only by the session route's manifest, and the landing
page's is unchanged). Every pack still `unreviewed`. And `apply` blocks say
plainly that work cannot be handed in yet: submissions and grading are E8.

---

# Delivery record — pass 14: packs the catalogue does not have

§24 E3's unmet acceptance criterion — "a goal with no matching pack triggers
Generated-pack creation and still produces a usable graph" — plus the thing that
had to exist first for any of it to be possible.

## The blocker nothing could see from outside

`allPacks()` reads YAML off disk and caches it for the process, and every
consumer goes through it. A pack authored on demand has nowhere to live: the
production filesystem is read-only, and a file written by one instance would not
exist on the next. The tables have been there since pass 1 and `seedPack` has
been filling all six of them; **nothing ever read them back**.

`packs/read.ts` is that inverse. The contract it defends is that a pack read out
of the database is the pack that was written into it — everything downstream
takes a `DomainPack` and cannot tell which source it came from, so a divergence
would show up as generated packs quietly behaving differently, far away from the
cause. `tests/packs/read.test.ts` asserts the round trip against all three real
packs rather than a fixture, because the shapes that break it (an item with no
options, a null review timestamp, a project pointing at a rubric) only appear
together in a real one.

Two things were already right and needed nothing: `validatePack` deliberately
downgrades thin item coverage to a warning for non-curated packs, and
`isTopicIndexable` already refuses to mark a generated pack indexable. The
honesty machinery existed; it had just never been exercised.

Found on the way: `toRows` dropped `quality.status` entirely, so no round trip
could have been faithful. It has a column now — §7.1's Generated → Standard
promotion needs somewhere to record state anyway.

`resolvePack` keeps §13.1's two rendering worlds apart. Marketing stays
disk-backed, synchronous and static, because it is the SEO surface. Only the
signed-in app consults the database, and disk wins a slug collision so promoting
a generated pack to Curated is done by committing the YAML.

## The generator

Three calls, mirroring `curriculum/`'s shape: skill graph on the deep tier, item
bank and rubrics on standard. The graph earns Opus because it is the one call
the others cannot correct — the diagnostic, the planner and the architect all
read it and none of them can tell it is wrong.

The dividing line everywhere is that a model is asked what a subject's skills
*are* and what good work looks like, and never for a slug, a probability, a tier
or a set of numbers that has to sum to 1. Those are the outputs models are worst
at and precisely what `validatePack` blocks on, so asking would guarantee a
repair loop that arithmetic avoids. Priors are seeded from the curated packs'
own hand-authored calibration rather than guessed.

Two rules are enforced in code rather than requested. The graph is **acyclic by
construction**: prerequisites may only name skills listed earlier, a forward
reference is dropped, and an edge that can only point backwards cannot form a
cycle. And a generated pack **may never claim §7.2 tier 1**, whatever its
workspace — tier 1 licenses "Verified: this works" and is earned by executing
the artefact, which a pack with no evaluator and no review cannot do.

There is no canonical fallback, deliberately. Curriculum generation falls back to
the pack's own path after two failures; a subject nobody curated has no such
thing, so this fails and says so. A learner told "we could not build this well
enough, here is what we do cover" is being treated honestly; one handed eleven
skills and four questions is not.

## What the live run found that no test would have

The first real generation cost $1.38 across two attempts and produced nothing.
Every model call succeeded, and 7 of roughly 80 items survived.

The cause was this pass's own prompt. `buildItemsContext` wrote skills as
`- ${name} (${level})`, and the item author copied exactly what it was shown —
returning the skill as *"Build and run a Cargo project (foundational)"*, level
included. Every item naming it was dropped as referencing a skill that does not
exist. No amount of insisting on "exactly as given" fixes that, because the
model is being obedient.

Skills now carry a short opaque reference (`s0`, `s1`) which has nothing to tidy,
and the context puts every other field on its own labelled line so nothing sits
where it could be read as part of the name.

It was invisible the first time because of a second defect: the failure path
returned `dropped: []`, throwing away the log that was the entire explanation.
"7 items" with no reason attached cost a whole second generation to diagnose.

After the fix, one attempt: 14 skills, 16 dependencies, 54 items (52 production /
2 multiple-choice), 3 graded projects, rubric weights summing to exactly 1, and
tier 2 rather than 1 despite the `code` workspace.

**$0.61 and 189 seconds per pack**, above the $0.30–0.60 this was planned at. It
is a per-*subject* cost rather than per-learner — §7.1 packs are shared, which is
also what stops on-demand authoring being a money hole — but the rubric author is
now the long pole at 124 seconds of it.

`scripts/pack-generate-probe.ts` and `scripts/item-batch-probe.ts` are kept. The
second exists because one item batch is the cheapest way to answer the question
that cost two full generations.

## A test isolation bug this pass exposed

`admin-console.test.ts` reads a global count of active goals, inserts two, and
asserts the count rose by exactly one — while other files insert goals into the
same database concurrently. It passed only because of the scheduling; adding a
DB-heavy test file changed the timing and it began failing intermittently.

The ten files that share Postgres now run in a vitest project with file
parallelism off. Serialising those costs about six seconds; turning parallelism
off everywhere cost twenty-five. No assertion was loosened to achieve it — the
race was real and would have surfaced on someone else's machine eventually.

1862 tests, 100% on all four metrics, `pnpm verify` clean.

## Not in this pass

The conversation at `/start` is still the form. E3's other half — the Goal
Analyzer, the ≤6-turn cap, matching a subject to the catalogue before generating
one — is next, along with the background job that runs generation off the request
path, the Experimental badge everywhere a generated pack appears, and the rate
limit that has to exist before any of this is reachable by the public.

---

# Delivery record — pass 15: /start stops being a form

§8 screen 3 has said "**Not a form**" since the plan was written, and `/start`
has been one since pass 1 — honestly labelled as a stand-in, but a form. This is
the conversation, and the path from a subject nobody has curated to a learner
having a plan.

## The conversation

The Goal Analyzer produces the same `GoalSpec` the form produces, which was the
whole reason that contract was written before either intake existed: the
conversation plugs into a consumer that has worked for fourteen passes rather
than being the first thing that ever fed it. The form is still there at
`/start/form` — it is the fallback when the analyzer is unavailable, and the only
intake that works with a model and JavaScript both out of the picture.

No client JavaScript, like every other screen here. Chips are submit buttons
carrying their own answer, which is how "most replies are one tap" works without
a bundle. The conversation lives in a row rather than a cookie, unlike the Skill
Check's: six exchanges of prose do not fit in 4KB, and unlike the check the
learner is already signed in, so there is a user to key it to.

The six-turn cap is enforced twice, in application code both times (§24 E3 is
explicit that it is "not prompt"): once by telling the model this is its last
turn, and once by ending the conversation whatever the model returns.

**Found by running it, not by testing it.** The first version ended the
conversation as soon as clarity passed 0.6 — which meant the analyzer asked "is
anything getting in the way?" and the learner watched their plan appear without
ever answering. Clarity now decides whether to keep *asking*; only the model
saying it is done, or the cap, ends anything. §8 screen 3 had it the right way
round all along: below 0.6 it asks one more question.

Also found live: a learner who taps "Complete beginner" was recorded as
`beginner`, which the product displays as "Dabbled a bit". The enum values do not
say what they mean and nothing told the model that `none` is the one that means
never. They are spelled out in the tool schema now.

## The wait

A pack takes about three minutes to author, so the gap path hands off to a build
row and an Inngest function. The row is keyed by **slug, not by learner**, which
is what makes §7.1's "promoted to Standard after 5 users" mean anything and what
stops ten people asking for Rust from starting ten $0.61 generations. One build
at a time per learner; a build older than fifteen minutes is treated as dead so a
worker that fell over cannot wedge a subject forever.

The wait screen refreshes itself with a `<meta>` tag. A failed build says what
actually went wrong — "7 items; a diagnostic needs at least 24" — rather than
"something went wrong, try again", and offers the retry next to it.

## The landing page

`/` used to say "Three so far. We add a subject only after a person has written
and checked it." That stopped being true in pass 14. It now says both halves:
three written and checked by a person, anything else built on request and marked
Experimental until it has been. Saying only the flattering half is the exact
failure §7.1 exists to prevent.

## Two things simplified rather than covered

`finish()` re-resolved a pack every caller had already resolved, which added a
branch that could not be reached. It takes the pack now. The item-slug collision
loop in the generator was the same: skill slugs are already unique, so
`${skill}-${n}` cannot repeat, and the loop was guarding against nothing.

1980 tests, 100% on all four metrics, `pnpm verify` clean.

## Still open

The admin queue for reviewing generated packs, and §7.1's promotion gate — the
`quality_status` column exists and nothing moves a pack through it yet. The
Experimental badge appears on the wait screen and the landing page but not yet on
`/today` or the path screen. And the whole flow has been driven by hand in a
browser rather than end to end with Inngest running, so the build event has been
verified as sent and the handler as correct, but not the two together.

---

# Delivery record — pass 16: reviewing what the machine wrote

Three things pass 15 left open, and the one that mattered most was the one that
had never been run.

## The badge, where a learner actually is

`MaturityBadge` has existed since pass 3 and appeared on the marketing pages, the
admin screens and the wait screen — everywhere except the two places a learner
spends their time. Someone who closed the tab during a build and came back to
`/today` had nothing telling them their course was written on request and has not
been read by a person. It is on `/today` and the path screen now, and only when
there is something to say: a curated pack does not carry a badge on every visit.

## The review queue

`/admin/packs` reads the curated packs off disk, which is right for them — they
are files in git and their review happens in a diff. A Generated pack has no diff,
so until now nobody could see one at all.

The queue is also §7.1's promotion gate — "promoted to Standard after 5 users +
quality gate" — and both halves are enforced in `promotePack`, not by the page
that renders the button. The numbers can move between a reviewer loading the
queue and clicking, and "Standard" is a claim the product then makes to learners.
The reviewer's own name goes on `reviewedBy`, because that field is a claim about
a person having read it.

Discarding is the other half of a review queue, and it refuses to remove a pack
somebody has a goal against. That refusal is not a check in application code — it
is `learning_goal.pack_id` having no cascade, which the teardown in the tests had
to learn to respect like anything else would.

## End to end, finally

Pass 15 verified the build event as sent and the handler as correct, and said
plainly that it had not watched the two work together. It has now: Inngest dev
server, real event, real generation.

`building` → `ready` in **200 seconds**. Home espresso, from nothing: 14 skills,
57 items, 5 rubrics, 5 projects. Workspace `media`, and therefore **tier 3** — you
can photograph a shot and be told something true about the technique, and the
taste is yours. That is §7.2's tier 3 exactly, and it is the cap in `derive.ts`
doing its job rather than a coincidence.

It then appeared in the review queue, validating, with the honest blocker
attached: *0 of 5 learners — not enough use to judge it yet*.

## One failure I could not reproduce

A `pnpm verify` run failed four tests while the Next dev server and the Inngest
dev server were both live against the same database. Three subsequent runs, and
one with the servers stopped, all pass at 100%. It is recorded rather than
explained away: the likely cause is those two processes writing to the shared
development database mid-run, which is the same class of problem pass 14's
vitest project split addressed, and the honest state is that it was seen once and
has not been seen since.

2012 tests, 100% on all four metrics, `pnpm verify` clean.

## Still open

The Generated tier's cost. A pack is $0.61 and three minutes, and nothing yet
charges anybody for one — §14.9.7's per-user cap is consulted before generating
but a free account can still ask for a pack a day. Whether that is a rate limit,
a plan gate, or a price is a product decision rather than a bug, and it is the
next thing that has to be decided before this is reachable by the public.

---

# Delivery record — pass 17: marking the work

E8, the epic §24 calls the differentiator and §14.5 calls "the most important
component". This pass builds the marking pipeline; handing work in through the
UI is the next one.

## The rule the whole thing is built around

§14.5: **every criterion score must quote the artefact.** The plan implements
this as a Sonnet verifier pass — "does each score cite real evidence?" It is a
string match instead, and that is a strengthening rather than a shortcut. Asking
a second model whether the first model's quotes are real introduces exactly the
failure it exists to catch, and §15's schema had already said as much:
`verifierPassed` is documented there as "the deterministic string-match check
that every quote appears verbatim in the artefact".

Matching is whitespace- and case-insensitive, because a model reflows what it
quotes. That accepts a line break becoming a space and nothing else — a
fabrication differs by more than whitespace, which is why normalising does not
weaken the check.

Three things get a criterion thrown out, and all three mean the grader has told
us about a document other than the one submitted: a criterion the rubric does
not contain, a criterion scored twice, and a quote that is not in the work.

## What the numbers mean

- **Score** is weighted by the rubric's own weights and renormalised over the
  criteria that survived verification. A criterion the verifier threw out is one
  we know *nothing* about, and scoring it zero would fail a learner for the
  grader's mistake. The doubt goes into confidence instead.
- **Confidence** starts at the floor of §7.2's range for the tier and earns its
  way up through a clean verifier pass, coverage, and two passes agreeing.
  Nothing can push it past the tier's ceiling, which is the point: no amount of
  internal agreement turns a photograph into an executed test.
- **`correct`**, for the mastery model, is whether the work reached the
  competent band — the line the rubric itself draws, and the learner read those
  descriptors before starting.

## Two things this build will not claim

**Tier 1 is capped to tier 2.** §7.2 tier 1 is "execute + assert against
expected behaviour" and licenses the words *"Verified: this works."* Nothing here
executes anything. A sandbox is a security problem rather than a feature, and
running submitted code next to the database is not a shortcut anybody gets to
take — so `tierFor` refuses to hand out tier 1 and the screen will say 2. The cap
disappears when the sandbox does.

**An evaluation with no surviving evidence produces no score.** 0 out of 0 reads
to a learner as "your work scored zero" rather than "we could not mark this",
which is §4.2 law 3 in its most damaging form — a claim about them rather than
about our failure.

## Found by grading real work

Two submissions against the SQL pack's own published rubric: a genuine attempt
and some confident nonsense.

The confident nonsense scored 0% with every band `absent`, and every quote
anchored in text that was really there — it refused to credit *"I understand
joins and grain very well"* as evidence of anything.

The genuine attempt scored 42%, and the marker was right and the fixture was
wrong: the brief asked for monthly revenue by acquisition channel and the
submission produced weekly revenue by segment. The grader marked "Answers the
question asked" as `absent` and quoted the SELECT clause to prove it. That is the
behaviour the product is selling, found by accident.

The two passes landed 2 bands apart on that one, which flagged it for human
review — correctly, since a piece of work that is good SQL answering the wrong
question is exactly the case a single pass gets wrong.

**A hole the tests found, not the probe:** confidence had partial credit for
"invalidated nothing", which an empty draft earns by making no claims at all. A
grader that returned nothing was scoring as a clean run. The credit now requires
something to have actually been upheld.

2044 tests, 100% on all four metrics, `pnpm verify` clean.

## Next

Handing work in. The pipeline has no caller yet: `apply` blocks still say
submissions are not built, `/submission/{id}` does not exist, and nothing writes
`Submission`, `Artifact`, `Evaluation` or `MasteryUpdate` rows — the tables have
been waiting since pass 1. After that, §24 E8's remaining acceptance criteria:
the Phase-0 hand-graded set for Cohen's κ, and two runs landing within one band
≥85% of the time. Both need a corpus that does not exist yet.

---

# Delivery record — pass 18: handing work in

The other half of E8. Pass 17 built the marker; this is the part a learner
touches, and the sentence it deletes is the one the `apply` block has carried
since pass 13: *"You can't hand it in here yet."*

## The write that matters

`recordEvaluation` puts the `Evaluation`, the `MasteryUpdate` and the new
mastery row in **one transaction**. §15 promises "every mastery change is
traceable to evidence", and a mastery row whose evaluation failed to write is
precisely the untraceable change §4.2 law 1 exists to prevent — so they land
together or not at all.

`masteryUpdate.reason` is written for a person, because it is the row that
answers "why did my score move": *"Marked 75% against the rubric, at confidence
0.80."* Tier-5 work gets the other sentence — logged as engagement, cannot raise
mastery — and a null delta.

The artefact is stored inline rather than in object storage. A deliberate limit:
this build accepts pasted text, bounded by the ingest cap, and a bucket holding
60KB of prose would be infrastructure with nobody behind it. A repo URL or a file
upload changes that, and `storageRef` is named for the day it does.

## The result screen

The score never appears without what it is worth — tier and confidence sit
beside it, because §7.2 says a tier-3 verdict at 0.8 is not the claim a tier-1
one is. Every criterion leads with the quote from the learner's own work, set
apart, before the reasoning. A criterion whose quote could not be found was
thrown out before it reached the page, so everything on it is quotable by
construction.

Truncation and human review are both stated on the page rather than implied.

## Two dead branches deleted rather than covered

`mark` re-queried the database for a user id the load step had already
established, which added a branch that could never be false; it takes the id
through instead. And `lastPracticedAt` was written behind a ternary, when
`applyObservation` stamps it on every path including the engagement-only one.

## A test that was wrong about the engine

An assertion expected mastery to fall after work that fell short. It rises
slightly: §16.2's `pLearn` moves the belief even on a failed attempt, because
attempting it is practice. What must not happen — and does not — is the
retention clock starting, so `lastSuccessAt` stays null.

2124 tests, 100% on all four metrics, `pnpm verify` clean.

## Still open

**The loop has not been watched end to end with Inngest running.** The pipeline
was verified against real rubrics in pass 17 and every branch of the handler is
tested, but a submission has not been followed from the textarea to a marked
result the way pack generation was. That is the next thing, and it is the one
that can still reveal a design problem rather than a missing test.

Then §24 E8's two remaining acceptance criteria, both of which need a corpus
that does not exist: Cohen's κ ≥ 0.6 against a hand-graded set, and two runs
landing within one band ≥85% of the time. §23's Phase 0 lists "grade 5 real
submissions by hand" as a MUST that was never done, and it is a prerequisite the
build owes rather than something code can supply.

---

# Delivery record — pass 19: watching the loop run

Pass 18 closed with one sentence: *"The loop has not been watched end to end
with Inngest running."* This is that run. It took the fixture below, one real
submission and $0.108, and it found two things 2123 passing tests could not.

## The session page was 500ing, and no test could see it

`submission/actions.ts` is a `"use server"` module, and every export from one
must be an async function. It exported `projectForBlock`, a synchronous helper.
That type-checks, lints, and passes every unit test — the test imported the
function directly and it worked fine — and then fails in the bundler, which took
`session/[id]/page.tsx` down with it.

So the hand-in form did not render at all. The feature shipped in pass 18 was
unreachable in a browser from the moment it was committed, and the whole suite
was green over it.

The helper now lives in `@/lib/submissions/project`. More usefully,
`scripts/server-actions-audit.ts` runs in `pnpm verify` and fails the build on
any non-async export from a `"use server"` file. This is the second time this
rule has bitten — a `MAX_TURNS` constant did it in pass 14 — so it is now
checked rather than remembered. The audit was confirmed against both shapes by
reintroducing them.

## A hand-in of whitespace vanished silently

`submitWorkAction` redirects to `?error=empty` when the artefact trims to
nothing. The session page never read `searchParams`, so the learner came back to
an identical page with their box empty and no explanation.

`required` does not save it: a textarea of spaces satisfies the browser, and the
trim happens on the server. Found by handing in six spaces against the running
app.

## What the run actually proved

A real no-JS form POST, the progressive-enhancement path the session is built
for, through every step:

| | |
|---|---|
| POST → server action | 303 to `/submission/{id}` |
| Inngest event | `submission/evaluate.requested` published and picked up |
| Waiting screen | "Marking your work", `meta refresh` live |
| Two Opus passes | 21.1s + 22.4s, band spread 1 |
| Result screen | 38%, Tier 2 evidence, every criterion quoting the work |
| Audit trail | mastery 0.12 → 0.166, `lastSuccessAt` still null |
| **Cost** | **$0.108 per marked submission** |

The skill is tier 1 and the evaluation came back tier 2 — §7.2's cap holding,
because there is no execution sandbox to justify the stronger claim.

The marking was good, and unflattering in the right direction: the submission
ignored the brief's month dimension and 12-month window, and the grader said so
and quoted the `GROUP BY` to prove it. `lastSuccessAt` stayed null because 38%
is not a success, while mastery still moved slightly — `pLearn` on a genuine
attempt.

## The fixture

`scripts/submission-loop-fixture.ts` puts a learner in front of an `apply`
block: user, goal, session, and a signed Better Auth cookie minted from the
session row rather than typed into a form. The diagnostic and the curriculum are
fixtured rather than run — both were verified against the real API in earlier
passes, and re-running them costs dollars to prove something already proven.
Everything from the textarea onwards is real.

Worth recording for the next person: the cookie signature is **standard padded
base64, URL-encoded whole**, per better-call's `signCookieValue`. The
`base64urlnopad` in better-auth's own `cookies/index.mjs` belongs to the
session-data cache payload and is rejected by `getSignedCookie`.

2124 tests, 100% on all four metrics, `pnpm verify` clean.

## Still open

Unchanged, and now the only thing between E8 and done: §24 E8's last two
acceptance criteria need a corpus that does not exist — Cohen's κ ≥ 0.6 against
a hand-graded set, and two runs landing within one band ≥85% of the time. §23's
Phase 0 lists "grade 5 real submissions by hand" as a MUST that was never done.

Neither the `failed` nor the `human_review` path has been watched live. Both are
branch-tested, and forcing either against the real API costs money to see a
screen that is already covered — but "tested" is not "watched", which is the
lesson of this pass.

---

# Delivery record — pass 20: the ledger, and what it refuses to claim

E9. `/mastery` and `/progress`, which is where a marked hand-in finally lands
somewhere a learner can point at. No model is called on either screen.

## The rule that decided the design

§24 E9 accepts on one sentence: *every capability statement links to the
artefact that proves it*. Read as a check on the output it is trivial. Read as a
constraint on the input it decides the whole screen — because a skill with no
marked hand-in has no link to give, and therefore cannot be claimed, however
high its mastery has climbed on answered questions.

So a learner can be **skipped past a skill on the path screen and still not be
claiming it on the mastery screen**. `projectSkills` excludes on any evidence,
because its question is *what should we spend your time on*. The ledger claims
only on artefacts, because its question is *what can you prove*. Both are true
at once, and the row says which it is:

> You've answered questions on this, but nothing you've handed in shows it yet.

That sentence is the product in one line. Every competitor in §3 would have
shown a full bar there.

## A state that could not happen

The first version warned that a claim was "fading" when a quarter of it had
decayed. That branch is unreachable, and the arithmetic says so: a claim needs
`mastery × (1 − decay) ≥ 0.85`, and with mastery capped at 1 that leaves decay
no room above 0.15. A test would have found it; thinking about the inequality
found it first.

The reachable question is the forward one — **would this still count in a week**
— asked by running `effectiveMastery` at `now + 7 days` rather than by solving
the decay curve. One decay implementation in the product, and the warning
arrives while the thing can still be saved rather than after it is lost.

Decay is therefore visible twice: as `fading` on a claim about to lapse, and as
`faded` on one that has, which puts its skill back on the path and says so.

## Two screens, one fact

`/progress` offers to show *which* skills are slipping. It counts them off the
ledger rather than recomputing from mastery states, because a second decay rule
living in the digest would eventually promise three and link to a list of two.
`retentionHealth` takes a `Ledger`, not a `MasteryState[]`, for exactly that
reason.

The same discipline moved `confidenceLevel` out of the submission page and into
`components/ui`: two cut-offs for "Demonstrated" in front of one learner is a
bug waiting for a quiet edit.

## What the weekly digest does not have

§8 screen 11 pencilled in a Reflection Agent and an accept/reject control for
plan changes. Neither was built, and neither should be:

- Every number on the screen is a fact about the learner's own week. A model
  asked to narrate facts can only add the risk of saying something the rows do
  not support.
- There are no plan changes to accept because there is no stale plan — §16.1
  runs on every page load. What replaced the control is the **recalibration**:
  34.7 hours left is 12 weeks at the 3 a week you planned, and 22 at the 1.6 you
  actually did.

The window is a rolling seven days. A calendar week shows an empty digest every
Monday morning.

## Watched, not just asserted

Pass 19's lesson, applied before shipping rather than after. Neither screen
calls a model, so `scripts/mastery-screens-fixture.ts` drives both for nothing:
it puts one learner in front of all five standings — shown, fading, faded,
unproven, untouched — with a completed session and hand-ins inside and outside
the window, and mints the same signed cookie the loop fixture does.

Both pages returned 200 and read correctly, and the render found one thing 2206
tests did not:

> Shown 0 days ago — without a refresher it stops counting within a week.

Which is what the arithmetic says and not what anyone would write. It is
reachable the moment someone hands work in on the day they read the page. Now
"today". The render also caught `/progress` heading a card "What's left" while
`/mastery` uses that name for a list of skills — one label, two meanings, now
"What's ahead".

## Still open

Unchanged from pass 19: §24 E8's last two acceptance criteria need a hand-graded
corpus that does not exist, and §23's Phase 0 lists building it as a MUST that
was never done. It is human work.

`/mastery` has no skill graph on it. The DAG lives on the path screen, where the
question is the shape of the subject; here the question is what can be proved,
and that is a list with links. If the graph is wanted on this screen later it
should carry evidence, not colour.

2206 tests, 100% on all four metrics, `pnpm verify` clean.

---

# Delivery record — pass 21: putting a date on it

`/calendar`, and `src/lib/calendar/` behind it. No model is called anywhere on
this screen.

## Why there was a hole here

§2.4 ranks five answers to "why not just use ChatGPT". Four of them had a
surface. The fourth — *it holds you accountable* — names **scheduled
commitments, streaks, overdue work, spaced retrieval**, and every one of those
was already being written to the database with nowhere to be read.

`retrieval_queue_item.due_at` had been driving session composition since E7 and
no learner had ever seen a due date. `learning_session.completed_at` was summed
into one weekly figure on `/progress` and otherwise unread. The curriculum's
modules were listed in order on the path screen with no dates on them. The
learner's own deadline appeared as six characters in a facts row.

`/today` deliberately refuses to show more than one thing, and `/progress` looks
backwards over seven days. Nothing in the product answered **when**.

## The rule the screen is built on

> A date is only as good as what it rests on, and it says which.

Three certainties, and every entry declares one:

| | What it is | How it is drawn |
|---|---|---|
| `recorded` | a session that happened | filled, in the accent — the accent means *verified* |
| `due` | a queued retrieval item; the deadline the learner set | filled, in `--attention` |
| `projected` | the day a claim stops counting; the day a checkpoint lands | a hollow ring |

A calendar is the easiest place in this product to start overclaiming, because
the overclaim *is* the date. Drawing a projection like a fact would have been
one CSS class away and nobody would have noticed for months.

## The lapse date is stepped, not solved

`/mastery` asks the decay curve forwards — *would this still clear the bar in a
week* — and `ledger.ts` says why that is the only reachable question. A calendar
has to answer *when*, which is the same curve inverted.

Inverting it algebraically would put a second decay implementation in the
product, which is the thing `slipping`'s comment exists to forbid. So
`lapseDay` **steps day by day asking `effectiveMastery` itself**, and cannot
drift from the model the planner scores on.

That is affordable because the answer is close by construction: a claim survives
at most `halfLife × log₂(mastery ÷ 0.85)` days, which at §16.2's 180-day cap and
mastery of 1 is ≈42. The horizon is 60 and the loop cannot run away. A test
asserts the two functions are inverses across four half-lives and four mastery
levels, so if that bound ever moves the suite says so.

Only *claims* get a lapse date — `ledger.canDo`, not mastery ≥ 0.85. A skill
sitting above the bar on answered questions alone is `unproven`, and telling
someone it "stops counting" would be mourning something they were never given.

## The streak is weeks, and it cannot punish you

§17 bans gamification beyond a streak, which means the one streak we keep has to
be worth its exception. A daily streak would tell a learner on three hours a
week that they failed on a Tuesday — a lie about their own plan. So it counts
**rolling weeks in which the commitment they set was met**, and the week in
progress counts once it has been met but is never counted against them. A streak
that breaks on Monday morning because the week is young is a guilt mechanic, and
§8 screen 6 spends an entire interaction ("Not today", no guilt) refusing to
build those.

It decides "kept" by rounding to a tenth of an hour and then comparing — the
same order `digest.ts` does it in, so `/progress` and `/calendar` cannot disagree
about whether last week counted.

## Nothing here is a new source of truth

The temptation on a screen that aggregates five tables is to compute its own
version of everything. Each one is borrowed instead:

- retrieval dates ← `dueRetrieval`, the same read the planner uses, item join and all
- lapse dates ← `effectiveMastery`, through the ledger `/mastery` builds
- remaining hours ← `remainingHoursFor`, which the path screen already quotes
- the pace actually kept ← the rolling seven days `/progress` prices its second estimate at

The one new read is `workedDays`, because "sessions per day" is not a question
you can ask a total. It buckets with `AT TIME ZONE 'UTC'` rather than a bare
`::date` cast, which reads the connection's timezone and would move a session
onto a different square depending on how the server was configured.

Days are UTC days throughout, keyed by the `YYYY-MM-DD` the planner already
writes as `plannedFor`. A learner finishing at 11pm in Auckland lands one square
right. Fixing it needs a timezone §15 does not store, and guessing at one
server-side would move dates for everybody.

## Two things the render found

Both from `scripts/calendar-screen-fixture.ts`, which seeds one learner with a
kept run, an overdue question, a claim on its way out and a path whose
checkpoints straddle the deadline — the fixture pattern pass 20 established.

1. **The deadline warning was reading the wrong pace.** It compared checkpoints
   against the deadline at the *committed* pace only. On the fixture the plan
   fitted comfortably and the pace did not — a checkpoint landed 18 days past
   the date and the screen said nothing. Those are two different problems: a
   plan that does not fit is the planner's to compress (§16.1 step 3), a pace
   that does not keep up is the learner's to decide about. `deadlineVerdict`
   now returns which, and the screen says the matching sentence. It stays silent
   when neither is provable, because the checkpoint list is capped — silence has
   to mean "nothing shown says otherwise", never "you are fine".

2. **`<Meta className="text-ink">` does nothing**, twice. `Meta`'s own doc
   comment says exactly this — two competing `text-ink-*` utilities resolve by
   stylesheet order, which is why the `tone` prop exists — and the override
   still got written, and still typechecked, and still passed every test. On
   screen both checkpoint dates rendered at identical weight. Now `tone="muted"`.

Neither was findable in a test. The first needs a fixture whose numbers happen
to separate the two paces; the second is invisible to `getByText`.

## Notes

- Five nav destinations now, not §8.5.5's three. The count was never the rule —
  §8.5.2 bans "the exactly-four-item bottom tab bar" as an iOS tic, which argues
  against copying a number rather than for one. What binds is one flat level
  with a word on every destination, and that holds. Checked at 400px.
- A checkpoint appears in its own band, never also in "what's coming". The two
  lists then mean different things: what the plan asks *of* you, and what you
  are heading *towards*.
- No percentage anywhere, asserted against the rendered output (§24 E9).
- The month grid is not a `<table>`; §8.5.5 bans data tables. It is a grid of
  `<li>`, and every marked square carries an `sr-only` sentence naming what is
  on it — a grid of coloured dots is precisely where "colour as the sole carrier
  of meaning" gets broken without anyone noticing.

## Still open

Unchanged from pass 20: §24 E8's last two acceptance criteria need the
hand-graded corpus §23 lists as a Phase-0 MUST. It is human work.

The calendar reads nothing it cannot already prove, which means it is honest and
also that it is thin for a learner on day one — a fresh goal shows an empty month
and one deadline. That is the correct failure, not a bug to pad.

## Two tests that were reading someone else's rows

Not this screen's code, but this screen's fixture found them, and both would
have bitten whoever wrote the next one.

`tests/submissions/store.test.ts` asserted on a mastery row selected by skill
id alone. Mastery is keyed on **(user, skill)**, so it read whichever row came
back first — and once a fixture existed for another screen on the same pack, it
failed on a fact about a different person. Both queries are scoped to the test's
own learner now.

`scripts/calendar-screen-fixture.ts` seeds against `sql-data-analysis` rather
than a pack chosen for the copy, because `tests/packs/seed.test.ts` deletes
every other pack on the way out and a fixture goal holds a foreign key into one.
That constraint is invisible from either file; it is written down in the fixture
now.

2527 tests, 100% on all four metrics, `pnpm verify` clean.

---

# Delivery record — pass 22: the link nobody could share, and the tool nobody could find

E10's share surface (`src/lib/seo/og*`, three `opengraph-image` routes), plus the
two things building it turned up. No model is called anywhere in this pass.

## What was actually missing

§13.3's OG row asks for "dynamic `opengraph-image.tsx` per type" and there were
none. Worse, `openGraph` metadata existed on the landing page and nowhere else,
and `twitter` existed nowhere at all — so five of the six marketing page types
pasted into Slack, X or LinkedIn as a bare URL with no title, no description and
no card. The `/projects/{slug}` brief is the strongest page the product has
(§4.2 law 2 — the rubric is public before the work is done) and it was the least
shareable thing on the site.

## The rule the cards are built on

> A card cannot say a kinder thing than the page it links to.

A share card is the one artefact that travels away from the page, and it is read
by people who will not click through to check. That is precisely where a claim
gets quietly upgraded, and "Experimental — help us improve it" is the least
shareable true thing we could put on one.

So the subject card carries §7.1's maturity badge and the project card carries
§7.2's tier claim — and both read them from `src/lib/claims.ts`, a table the
on-page `MaturityBadge` and `EvalTierNote` now read too. Previously those strings
were typed into two component bodies. A third copy on the card would have been
free to drift, in the one place a reviewer never looks.

`projectCard` deliberately shows the *tier*, not the maturity: the question a
person asks about a brief is what "marked" is going to mean, and at tier 5 the
honest answer — printed on the card — is that it will not count as proof.

## Two things that were wrong before this pass started

**The webfont has never shipped.** `globals.css` has referenced
`/fonts/instrument-sans-variable.woff2` since §8.5.3 and the repository has no
`public/` directory. Every page, in every environment, has been rendering in the
metric-matched fallback — invisible precisely because `size-adjust` does its job.
It surfaced only because satori cannot read `@font-face` and needed the file
directly. The site now ships the latin woff2 (30KB, preloaded — it is referenced
from a stylesheet, so without the preload it cannot be discovered until that
stylesheet has parsed) and static `ttf` instances for satori, which supports
neither woff2 nor variable instancing and would otherwise have rendered the whole
card at weight 400.

**`/check/{topic}` was noindex because of a comment that expired.** One constant
covered both check pages, with one reason: the diagnostic engine did not exist.
E4 built it in pass 6 and the reason stopped being true — of the subject check
only. The per-skill page still says "Not ready yet" in its own second card,
because a check for one skill on its own is the thing E4 did not build. They are
gated separately now: the subject check on `isTopicIndexable`, the same review
gate its curriculum sits behind, and it is in the sitemap and carries `Quiz`
markup. The per-skill page stays out. §2.6 calls the skill-assessment SERP "the
crack in the wall", and the product had been declining to compete for it for two
passes after it could.

## Three things only the render found

Passes 19–21 established that the fixture is where the bugs are. Here it was the
PNG itself, fetched from the dev server and looked at.

1. **The brand card said `online_uni` twice** — once as its eyebrow, once as the
   wordmark. Nothing in the element tree distinguished the two strings, so no
   test could have caught it; on screen it read as a rendering fault. `eyebrow`
   is nullable now and the brand card has none.
2. **Every card had ~150px of dead space across its middle.** A `flex: 1` on the
   top block pinned the facts to the floor, where they read as a footer to a card
   that had already ended. One centred block instead.
3. **Both dynamic image routes built as `ƒ (Dynamic)`** — found in `next build`
   output, not in the browser. An image route does not inherit its page
   segment's `generateStaticParams`, so satori was re-rendering the PNG on every
   unfurl by every network, for an image that changes when the pack does. Both
   prerender now.

## A copy defect the structured data exposed

Three bits of copy lowercased a pack name to drop it mid-sentence, which is right
for "Photography" and mangles "SQL & Data Analysis" into "sql & data analysis" —
in a search result, in `Quiz` markup, and in the goal title a learner is given
when they do not write their own. Removing the lowercasing broke the other two
("Get good at Photography" is a title pasted into a sentence), which the suite
caught immediately.

`subjectInProse` decides per word rather than per name: an all-capital word of
two letters or more is an acronym and survives, everything else comes down. The
three real packs give "photography", "business writing & communication" and
"SQL & data analysis".

## Notes

- Three card types, not five. `/learn` and `/projects` are hubs and get the brand
  card, which is the right thing to say about them.
- Nothing under `(app)` inherits a card. Those routes are `noindex` and private,
  and a card for a page the recipient cannot open is worse than no card.
- The `Quiz` block says nothing about the questions. §13.3's rule is that markup
  never describes content the page does not show, and the intro screen a crawler
  is served shows none of them — `hasPart` here would mean publishing the item
  bank as structured data.
- The card is always the light palette. A share card has no viewer to ask, and a
  dark variant would be a second brand nobody chose.
- Palette values are imported from `theme.ts` rather than typed as literals.
  Satori has no CSS variables, and this is the only place in the product where a
  colour is written as a hex — a card in last season's accent is exactly the
  drift §8.5.4 exists to prevent.

## Still open

Unchanged: §24 E8's last two acceptance criteria need the hand-graded corpus §23
lists as a Phase-0 MUST. It is human work.

E10's remaining two outputs — the internal-link renderer and the quality-score
job — both operate on authored `SeoPage` rows, and there are none. They are E12's
work. Building either now would mean building a renderer for content nobody has
written, which is the same mistake as publishing a page for a tool that does not
exist.

Lighthouse and the GSC/Bing verification in E10's acceptance criteria need a
deployed origin and have not been run.

2685 tests, 100% on all four metrics, `pnpm verify` clean, `pnpm build` clean.

# Delivery record — pass 23: one answer to "where am I", on all four screens

`src/lib/goals/standing.ts`, `src/components/nothing-running.tsx`, and the four
destinations that now share them. No model is called anywhere in this pass.

## The contradiction

`/today` would tell a learner they were partway through creating a subject — the
`goal_intake` row read as an offer, built in pass 19. One tab along, `/calendar`,
`/mastery` and `/progress` told the same learner, in the same moment, that they
had nothing and should go and pick a subject.

Pass 19 fixed the dead end on the screen it was diagnosed on and left the other
three saying what they had always said. That is not a thinner answer; it is a
different one, about the same state, and it is the version that makes the product
look like it has forgotten what the learner did five minutes ago.

## What was actually wrong, underneath

Nothing was missing from the database. Three screens simply never asked. So the
fix is one read — `standingFor` — and one component, for the same reason
`CourseList` is one component: what a learner is in the middle of is a single
fact, and four screens each deciding how to load and word it is exactly how they
came to disagree.

`LearnerStanding`, not `Standing`: the ledger already uses that word for where a
single skill stands.

## The state nobody could see at all

`pack_build` has always known that a learner has a subject being authored right
now, and `activeBuildsFor` only ever answered "may they start another". Nothing
could ask "what is happening to them". A learner who walked away from the wait
screen was offered **Build it** on `/today` — a button that fails, because
`buildFromConversationAction` refuses a second concurrent build and redirects
back with `error=busy`.

So the offers are ranked, and a build in flight outranks the conversation that
started it: *we're writing it now*, pointing at the wait screen, which is the
only page that knows how far along it is.

## Notes

- `/today` passes `catalogue={false}`. It carries a sample of `/subjects` below
  the card, and two doors to one place is the density §8.5.1 warns about.
- `/progress` renders no `PickBackUp`. Its own band already lists every course,
  finished ones included — that screen is where a course is managed, not
  re-entered — and a second list with different buttons on it is the drift
  `CourseList` exists to prevent.
- `/mastery`'s what's-left tab keeps its own empty state. A learner between
  courses is not looking at an empty page there; their claims are the content,
  and pass 20 made a point of the ledger outliving the course.
- The three notes ("once a course is running, this is where…") stay per screen.
  The offer is the same everywhere; what the learner came to that screen for is
  not.
- `tests/goals/standing.test.ts` joins the `db` project in `vitest.config.ts`.
  It creates goals and seeds a pack, and left in the parallel project it raced
  the files that count active goals — the exact bug that comment describes,
  reproduced once in four full runs before the file was moved.

2708 tests, 100% on all four metrics, `pnpm verify` clean, `pnpm build` clean.

---

# Delivery record — pass 24: the pages a visitor reads, and the scroll that reads them

The five public routes — `/`, `/learn`, `/learn/{topic}`, `/projects`,
`/projects/{slug}` — plus `src/styles/globals.css`, two shared cards in
`src/components/marketing.tsx`, `revealAt` in the vocabulary, and PLAN §8.5.6's
marketing amendment. No model is called anywhere in this pass.

## Two faults, and only one of them was the pages

**The pages said the same thing twice and buried the best thing they had.** The
landing page's seventh cut was five bands, four of which opened with a
`SectionHead` over a grid of hairline-topped items, so it read as one shape
repeated until it ran out. A visitor met, in order: a headline, half a screen of
nothing, a process diagram, three paragraphs of small print about generation
quality floors, and *then* the marking — the single most convincing artefact the
product owns, fourth. `/learn` ended in every graded brief in the product,
twenty-two cards of `4 criteria · 75 min` with no subject attached, which is
`/projects` reproduced without the two things that make `/projects` legible.
`/projects` itself was one wall ordered by `difficulty` — a number the reader
cannot see and would not agree with — with every brief cut at 160 characters
mid-word.

**And the motion was invisible.** Twenty-seven animations on the landing page
and the review verdict was "I don't see any animations", which is the correct
verdict: `rise` runs off a clock that starts when the document does, so
everything below the fold finished animating before anybody had scrolled to it.
The entire motion budget was spent on the one screenful that did not need it.

## Why §8.5.6 was amended rather than bent

Every rule in that section — nothing translates more than 20px, state changes
cross-fade rather than slide, list items stagger 24ms on first render — was
written for a screen you *operate*, where a row that travels is a row you lose
track of. A landing page is read. The rule was not too strict for these pages;
it was written about a different kind of page, and applying it to marketing was
the mistake.

The amendment is scroll-linked motion under constraints, and the constraint that
does the work is that it is **CSS only**: `animation-timeline: view()`, driven by
the compositor off the scroll position. §8.5.8's "marketing routes ship zero
component-library JS" and §13.1's 80KB budget are untouched — no
IntersectionObserver, no scroll listener, nothing to hydrate. Roughly forty lines
in `globals.css`, all of it inside `@supports (animation-timeline: view())` and
`prefers-reduced-motion: no-preference`, so a browser that cannot drive it gets
the page exactly as it was. The failure mode of a JS reveal library is a blank
page; this one cannot have that failure.

## The first cut of the motion was invisible for two reasons, not one

Distance was the obvious half: holding to §8.5.6's literal 20px on a page you
scroll is motion nobody can see. The half that was not obvious is that the
ranges ended at `entry 100%` — the moment the element is fully on screen, which
is the *bottom edge*. Everything was over by the time it reached the part of the
viewport a person reads. Ranges now end around `cover 34–38%`, about a third of
the way up. Travel is 48–72px, scale bottoms out at 0.9, and it is `linear`
throughout, because on a scroll timeline the reader's own scrolling is the
easing.

## The stagger had to be a range

`stagger(i)` sets `--rise-delay` in milliseconds. A view timeline has no clock,
so there is nothing to be late against. `revealAt(i)` offsets each item's
`animation-range` start by 6% instead — which is also the only way a *row* of
things side by side can build left to right on a timeline that measures vertical
travel. Both helpers cap at 8 for the same reason: the ninth card would not
begin until the band was half past.

## One pinned scene, and it teaches

`pin-scene` holds the landing page's marking band for a viewport and a half
while the rubric ladder builds Absent → Developing → Competent → Strong. It earns
the scroll because what happens during the pin is the argument in its own order:
somebody skimming receives it in sequence instead of meeting four paragraphs at
once.

The load-bearing trick is not the pin. A pinned element's own `view()` timeline
is **frozen by definition** — it is not moving relative to the viewport — so the
rungs would sit at whatever frame they stuck on. They are driven by the
section's *named* timeline (`view-timeline-name: --scene`) instead, which is
what lets a stationary element be animated by a page that is still scrolling.
Desktop only: below `lg` the two-pane card is taller than the viewport, and an
element taller than the viewport cannot stick to the top of it.

## The two routes that finished this pass

`/learn/{topic}` and `/projects/{slug}` were left on the clock while the other
three moved to the scroll — which is the worst of the three states, because it
is the one nobody notices. They open with a breadcrumb trail and a title; they
have no fold to spend an entrance on; and both had `rise` on the whole page.

They have none now. The stat row on a subject counts itself in left to right as
the card crosses the fold, the skill map and the brief list reveal per area, and
a brief's rubric bands `settle` — which meant `.settle` had to learn the same
`--reveal-start` offset `revealAt`'s own doc comment promised it took. A brief
page holds five showcase surfaces in a grid; without the offset they arrive as
one block rather than in the order they are meant to be read.

**`rise` is not deprecated, and its territory is now sharp**: the landing page's
fold, the running skill check, and everything under `(app)`. Those are screens
you operate rather than documents you scroll, and the original rule is right
there. What the invariant test asserts is the *boundary* — no `.rise` anywhere on
the four reading routes, and no element carrying both, since two animations on
one element fight and the stylesheet's last rule wins.

## What the render found that no test could

**`getComputedStyle` lies about scroll-driven animations.** Probing the live page
from the console reported `opacity: 1` on every `.reveal` element, including ones
that were visibly at a fifth of that in the same instant — the animation runs on
the compositor and the computed style reports the base value. The probe said the
motion was not running; the screenshot showed it running correctly. **Only the
picture is evidence here**, which is the same lesson passes 19–22 kept arriving
at from other directions, and it is worth writing down because the wrong tool
was the *more* precise-looking one.

Checked in Chrome at 1459×812 on all five routes: the subject page's stat row
lands fully revealed at rest (it sits high enough that its range has completed
before anyone scrolls, which is what the fold needs), the skill grid reveals per
area with the stagger legible across a row, the brief page's rubric cards arrive
with their ladders filling, and the pinned scene sticks and builds.

## Notes

- **Both claims or neither, on a subject card.** §7.1's maturity says how the
  material got written; §7.2's tier says what marking it can honour. The card
  lived twice, character for character, in `/` and `/learn`, and a card carrying
  one and not the other tells half the story — always the flattering half. They
  are drawn together in `SubjectCard` now rather than assembled per page.
- **The landing page dropped both.** Nobody chooses a subject there; the
  catalogue band is a row list whose closing line names both kinds and sends the
  reader to `/learn`, where the labels are. Saying less is not the overclaim
  §4.2 law 3 rules out — implying the hand-written depth covers everything would
  have been.
- `excerpt` cuts at a word and then drops stranded punctuation, so a brief no
  longer ends `you state before you start.…`. Neither `replace` has a branch: a
  pattern that does not match returns the string it was given.
- The three notes about *what this band is for* stay per page. The motion is the
  same everywhere; what the reader came for is not.

## Still open

Unchanged: §24 E8's last two acceptance criteria need the hand-graded corpus §23
lists as a Phase-0 MUST. It is human work.

E10's internal-link renderer and quality-score job still wait on authored
`SeoPage` rows, which are E12's. Lighthouse and the GSC/Bing verification need a
deployed origin.

3120 tests, 100% on all four metrics, `pnpm verify` clean, `pnpm build` clean.

---

# Delivery record — pass 25: the roadmap generator that generates nothing

`src/lib/roadmap/plan.ts`, `/tools/learning-roadmap-generator`, one line of
`check/[topic]/actions.ts`, and the `webApplication` block §13.3 had asked a
tool page for. **No model is called anywhere in this pass, and that is the
finding rather than an aside.**

## §19.2 was right about the money and wrong about the mechanism

The plan costs the Roadmap Generator as an LLM call and then spends a section
avoiding the bill: precompute the top ~2,000 (goal × level × weekly-hours)
combinations, validate them, spot-check them by hand, store them in Postgres,
serve a database read, and gate novel goals behind an email and a Turnstile.

By the time the tool was reachable, every piece of a roadmap already existed:

- the **skill graph** is pack data (§7.1), authored or generated once;
- **`topologicalOrder`** puts it in a teachable order, deterministically, with a
  stable (level, slug) tiebreak;
- **`projectSkills`** decides what a learner does and does not have to do;
- hours are pack data.

A roadmap for a subject we have is **arithmetic**. So there is no cache, no
quality gate over the output, no 2,000-row table to invalidate when a pack is
edited, and no novel-generation path to rate-limit — `$0.00` and about five
milliseconds. "Identical every time" is a stronger claim than "spot-checked",
because there is nothing left to spot-check.

The abuse controls follow the same way. **A tool with no AI spend behind it
cannot be abused into a bill**, so Upstash and Turnstile stay unbuilt and stay
unneeded *here*. They are still owed on the surface that does spend — §7.1's
Generated tier at $0.61 a pack — which already sits behind an account.

## The level dropdown, and why there isn't one

"goal × level × weekly-hours" builds a self-declared level into the cache key.
§4.2 law 1 says self-report is never evidence, and `projection.ts` already
refuses to read the stated level the goal form collects — so a tool that
shortens its plan on the answer would be the one place in the product that does.

Every competitor's roadmap tool personalises on a question it has no way to
check. This one asks for a subject and a pace, and says so on the page: *this is
the same plan we would give anyone; the only thing that takes work out of it is
work of yours that has been marked.* That is law 1 written as a feature rather
than as an apology, and it is the sentence the page ends on.

## Two things the measuring found, both bigger than the tool

The first cut built the plan on the anonymous check cookie, so a visitor's
answers would drop skills out of it. Writing the test for that is what turned
both of these up.

**1. The check cookie has never reached any of its readers.** It was written at
`path: /check/{topic}`. A browser sends that to the check and to nothing else —
and every reader is outside it: `masteryFromCheck` in `/start`'s action,
`answeredTopics` on `/today`, `/subjects` and the goal form. §24 E11's own
acceptance criterion, "the anonymous check result is preserved through signup",
could not happen in a browser. It failed **silently**: those screens behaved
exactly as they would for a visitor who had taken no check, which is
indistinguishable from the ordinary case.

It survived two passes because the test harness handed the jar straight to the
function and threw the write options away. The jar accepts any scope at all; the
browser is the part that decides, and the browser was not in the test. The
harness records the options now, and `path: "/"` is asserted — with `httpOnly`,
`sameSite` and the six-hour expiry asserted beside it, so widening the scope
cannot quietly become a licence to relax the rest.

**2. A Skill Check cannot lift any skill to the bar that would skip it.**
`projectSkills` excludes at `MASTERY_TARGET` (0.85). Measured on the real pack:
the BKT needs **three** correct observations on one skill to clear it (0.60 →
0.81 → 0.92), and a nine-question check across a 26-skill subject never gives
any single skill three. A *perfect* check tops out around 0.6.

That is not a bug in the BKT — one right answer is not proof, which is §4.2 law 1
doing its job. It does mean §24 E4's "an expert-level tester is correctly placed
at high mastery on ≥80% of skills they actually know" is not met by today's item
banks, and that §8 screen 5's "explicitly lists what was skipped and why" has
nothing to list until a learner has graded work. Fixing it is an item-bank and
budget question, not a code change.

**So the page reads no cookie and claims nothing about the visitor.** A band
saying "your check took these out" would have been a band nobody could ever see
— §4.2 law 3's overclaim, arrived at by good intentions rather than by
marketing.

## The presentation decisions the render made

Three, and all three came from looking at the page rather than at the test.

1. **A week's total says "starts here".** Work is assigned to the week its
   running total falls in, so a 3-hour project beginning on the Thursday of a
   4-hour week makes that week's rows add up to 6.5h — and makes the *next* week
   look light. Printing that as the week's workload is wrong; printing it as
   what begins is exactly right, and it is also what explains the quiet week
   after it. Each spanning row says `runs into week 5` on its own account.
2. **A graded row links to its brief instead of restating it.**
   `canonicalCurriculum`'s acceptance criterion for a project module is `Submit
   {title} for grading.`, which under a heading that is already the title reads
   as the title said twice in a stilted sentence. §4.2 law 2 is the better half
   of that sentence and it is one click away.
3. **The range is the specialist tail, not a margin of error.** §11 asks for "an
   explicit range with stated assumptions"; the pack declares which skills are
   the tail and `projectSkills` leaves them out of the estimate on purpose, so
   the honest upper bound is the plan with them in. Inventing ±30% would have
   been the alternative.

## Notes

- **The bare URL is the only indexable one.** Every `?subject=…&hours=…` view is
  `noindex, follow` and canonicals to it. That is §13.3's faceted-nav rule and
  also §17's "DON'T BUILD: timeframe/duration combinatorial SEO pages" — seven
  subjects at forty paces is 280 pages that differ by a number, which is the
  content-farm shape §12 exists to keep this site out of. Asserted in both the
  page suite and the sitemap suite.
- **A plain GET form**, so the answer is a URL that survives a refresh, a
  bookmark and a paste — and so the one marketing page that takes input still
  ships zero JavaScript (§8.5.8).
- **`defaultSubject` picks the deepest reviewed pack**, tie-broken on the slug so
  it cannot change between deploys, and falls back to the catalogue when nothing
  has been signed off — which was every environment until three passes ago.
- **No `/tools` hub.** One tool does not need an index, and a hub page listing
  one link is the thin page §12 is about. `/learn/{topic}` links in instead:
  "47 hours is a number, not a plan."
- **`learning-time-calculator` is not a second page.** "How long does this take
  at my pace" is this tool's headline; a page answering it with less of the same
  arithmetic is two URLs competing for one intent.
- Three defensive `??`s came out of `plan.ts` during the coverage pass. Each was
  guarding against something the function immediately above it had just
  guaranteed — an unreachable branch dressed up as caution, which is the shape
  the coverage rule is meant to catch.

## Still open

Unchanged: §24 E8's last two acceptance criteria need the hand-graded corpus §23
lists as a Phase-0 MUST, and E10's internal-link renderer and quality-score job
wait on authored `SeoPage` rows, which are E12's. Lighthouse and the GSC/Bing
verification need a deployed origin.

**New, and both belong to earlier epics:** E4 owes the item banks that would let
a check place an expert (above); and with the cookie now travelling, the
carry-in it enables has still only been exercised in tests — the first real
browser run of check → signup → path is worth watching.

3163 tests, 100% on all four metrics, `pnpm verify` clean, `pnpm build` clean.

---

# Delivery record — pass 26: the free check marks what you wrote

`src/lib/check/mark.ts`, the anonymous check's fifth screen, the anonymous daily
spend cap in `runlog.ts`, and a `graded` mode through the diagnostic engine and
its cookie. **The first model call this product makes for someone who has not
signed up.**

## The constraint nobody had named

Pass 25 found that a Skill Check can never lift a skill to the bar the planner
skips at, and diagnosed it as a budget problem: nine questions across
twenty-six skills cannot give any one skill the three observations the BKT
needs. That is true and it was not the binding constraint.

Measured across the seven packs:

| | |
|---|---|
| Skills with **at least one** auto-markable item | 15–35% |
| Skills with three | **none, in any pack** |
| Photography, as a learner met it | **4 of 15 skills** could be reported on |

The check could only mark closed items. Everything else — `explain`,
`short_text`, `code_read` — was shown, answered, and then handed back to the
learner to mark against a revealed key, which §7.2 calls Tier 5 and which
therefore moves nothing. So eleven photography skills had nothing the check
could say about them, whatever the budget.

That was the right call when `diagnostic.ts` was written: its header says so, and
says why — "built to run with no LLM in the path… shippable before
`ANTHROPIC_API_KEY` exists". It stopped being true some time around E7.

## The piece was already built

§14.2 routes free-text grading to Haiku ("Assessment Agent: Haiku 4.5 *only* to
grade free-text"), §19.1 budgets the check at about a cent, and `STEP_MODELS`
has carried a `checkGrader` row on the fast tier since the routing table was
written. `session/grade.ts` had built the call for the signed-in session two
passes before — prompt at v2, tool schema, Zod contract, and the calibration
constants beside it.

So the work was not a grader. It was **the decision around the call**, and the
honest recording of which decision was taken.

## Four ways an answer does not get marked, all landing in one place

No API key · no budget left today · a blank answer · a call that failed. Each
falls back to the reveal-and-self-mark screen this check shipped with, and that
is what made this safe to add without a flag or a degraded-mode banner: **the
fallback is not a broken version of the feature, it is the honest older one.**
The result screen already distinguishes what was marked from what was
self-marked, because it always had to.

A blank answer is marked wrong without asking anyone, and the sentence saying so
is the only feedback in the product no model wrote. Nine blank submissions is
the cheapest abuse of this surface there is, and it now costs nothing.

## The mode is recorded, not inferred

`Answer` in the check cookie gained a `g` flag, and this is the load-bearing
part rather than a detail. The same item can go either way in the same product,
and mastery is **replayed** from the cookie on every request rather than stored.
Without the flag a replay would reconstruct a *kinder* mastery than the learner
was shown — silently, and in the direction nobody would check. `AskedItem.mode`
is `auto | graded | self` all the way through the engine, and `summarise`'s
`assessed` widened from "a closed item decided it" to "something other than the
learner decided it".

**The Tier 5 rule is untouched.** A self-marked answer still moves nothing, and
a graded one is capped by `evidenceTierFor` at Tier 2 — or at the skill's own
tier when the domain is weaker, so a Tier 3 photography skill stays Tier 3
however well the learner writes about it. That is why `DiagnosticSkill` now
carries `evalTier`: the cap needs the domain, and the engine had never needed to
know it before.

## Where the cap lives

The check is the one surface that spends with nobody to bill it to, so
§14.9.7's "checked *before* every call" needed something to check.

It reads the **`agent_run` rows the calls already write**. `RunRecord.userId`
has been nullable since it was written, with the comment "null for anonymous
work — the free check", so the ledger was already there and a second counter
would have been a second place to be wrong. `ANONYMOUS_DAILY_CAP_CENTS` is 500 —
about 100,000 marked answers at Haiku prices.

Per day and global rather than per IP: a per-IP limit needs shared state this
build does not have and still would not bound the total. **If the ledger cannot
be read, nothing is spent** — a cap that cannot be read is not a cap, and
failing towards self-marking fails towards the cheaper claim.

`getDb` is passed as a *factory* rather than a connection for the same reason:
`getDb()` throws where `DATABASE_URL` is unset, and this is a marketing route
that otherwise touches no database. Calling it eagerly took the whole check down
in the unit suite, which is exactly the environment a marketing-only deployment
would look like.

## What the browser found that the suite could not

Run against the real model, on the real dev server:

1. **It works, and the feedback quotes the learner.** "Counted as right", then
   the grader repeating the reader's own phrase back at them. That is §8 screen
   9's "must feel like a senior person reviewed your work" at check scale, for a
   visitor with no account.
2. **The same photography check went from 4 marked skills to 9 of 15.**
3. **The submit button still said "Show me a good answer"** — the self-mark
   framing, promising a screen that is now the fallback rather than the rule.
   The button cannot know which it will get; it says "Answer", and the meta line
   above it says "a written answer" rather than promising who will mark it.

## A latent bug the cookie work exposed

The stored response was bounded at 4,000 characters — which is over a browser's
~4KB cookie limit on its own once base64 has added a third. An oversized cookie
is dropped **silently**, so a learner who wrote at length would have had the
check reset itself mid-run. The bound is 1,200 now, the textarea carries the
same `maxLength`, and the truncation is something they are told about rather
than something that happens to them.

## Notes

- The intro no longer counts markable questions ("5 of the 33…"). It was true of
  closed items and is now true of nearly all of them, and a number that has to
  be re-explained the moment a marker is unavailable is worse than the rule it
  stood for. The rule — marking your own work never counts as proof — is
  unchanged and still on the page.
- `CHECK_CONFIDENCE`, `WRITTEN_ANSWER_TIER` and `evidenceTierFor` moved from
  `session/grade.ts` into `engine/scoring.ts`. The engine cannot import a module
  that pulls in the Anthropic client, and two copies of "what is a written
  answer worth" would drift in the flattering direction.
- The marking screen sits *ahead* of the result screen: a graded answer can be
  the one that finishes the check, and showing the result over the top of it
  would throw away the only per-answer feedback a free visitor gets.
- `tests/app/check-marking.test.tsx` is its own file because its premise is the
  opposite of `check-run.test.tsx`'s. That suite runs with no key — the fallback
  every marketing-only environment takes — and this one runs with a marker that
  answers.

## Still open

Unchanged: §24 E8's hand-graded corpus, E10's two outputs behind E12's content,
Lighthouse and GSC/Bing behind a deployed origin.

**E4's remaining half**, now the whole of what it owes: nine questions across
twenty-six skills still cannot give any single skill three observations, so
nothing is *skipped* on the strength of a check yet. That is a budget-and-
coverage question — a longer check, a narrower one, or item selection that
concentrates once it is nearly sure — and it is a decision rather than a defect.

3193 tests, 100% on all four metrics, `pnpm verify` clean, `pnpm build` clean.
