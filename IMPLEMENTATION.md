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
