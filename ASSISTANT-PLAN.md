# The Assistant — plan

An always-available assistant that can read a learner's own state and answer in
the product's own components: ask for your calendar and a calendar appears in the
thread, not a paragraph describing one.

This document covers that feature only. `PLAN.md` remains the product plan; where
the two disagree, §17.2's **"❌ A general chatbot — the tutor is scoped to the
session"** is the line this feature is deliberately drawn against — see §1.2.

---

## 1. Scope

### 1.1 What it is

A button present on every signed-in page. It opens a thread. The learner asks
about **their own** account — where they are, what's next, what they're paying,
what's on the calendar — and the answer arrives as prose *plus rendered views of
their real data*.

It reads. It navigates. It explains the product.

### 1.2 What it is not, and why the tutor stays untouched

`src/lib/session/tutor.ts:12` opens with "§14.2 — the Tutor. **Not an agent.**"
That stands. The tutor keeps its scope, its per-session turn caps, its cached
learner-context prefix, and its prohibitions — it cannot mark work, cannot move
mastery, cannot tell a learner they have got something.

The Assistant is a **second, separate agent** with the inverse shape: it has
tools and no teaching authority. It does not explain subject matter, does not
grade, does not move mastery, and does not congratulate. Asked to teach, it says
what it is and offers the session.

Keeping them apart is the whole reason this does not contradict §17.2. A merged
agent would have to hold both rule sets at once, and the mastery-invention risk
the tutor prompt spends six lines guarding against would return through the side
door. "What did I pay?" is not tutoring.

### 1.3 Explicit non-goals for v1

- **No MCP.** These are functions in the same process behind the same session.
  A protocol would add a transport and a second place to get authorization wrong.
  (Exposing MeritKeep to external clients is a separate, later, distribution
  question.)
- **No writes.** Nothing that spends money, changes a plan, reschedules, or
  submits. Those return a link to the page that does it. See §9.2.
- **No web search, no general knowledge questions.** Out of scope means out of
  scope: it answers from tools or it says it cannot see that.
- **No cross-user anything.** There is no tool whose result depends on an
  identity the model supplied.

---

## 2. The one design decision that matters

**Widgets come from tool results. The model never authors a widget's contents.**

The rejected alternative is the obvious one: let the model emit a directive in
its text — a fenced block, a tag — and have the client parse and render it. That
fails on three counts. The model can fabricate the numbers inside it; the parser
has to work on a half-arrived token stream; and it puts data the learner will
read on the far side of a model's imagination, which is the opposite of how
every other surface in this product works.

So instead:

1. The model chooses **which** view by choosing **which tool** to call.
2. The tool runs server-side against the database, scoped to the authenticated
   user, and returns a Zod-validated payload.
3. That payload goes to the client as a widget frame and is rendered by a real
   React component.
4. A **separate, deliberately thin summary** of the same result goes back to the
   model as the `tool_result`, so it can write a sentence around the view.

This mirrors the discipline already stated in `src/lib/ai/call.ts:17` — "the JSON
Schema is what the model is steered by; the caller's Zod contract is what
actually decides whether the result is usable." Steering and enforcement stay two
things that agree. The model steers *which view*; the database decides *what is
in it*.

### 2.1 Two outputs per tool

```ts
interface ToolOutcome<P> {
  /** Goes back to the model. Short, factual, no figures worth restating. */
  forModel: string;
  /** Goes to the client. Typed, complete, rendered by a component. */
  forView: { widget: WidgetName; payload: P } | null;
}
```

The asymmetry is doing real work. `forModel` for a calendar is
`"Rendered September 2026: 3 checkpoints, next is 12 Sep."` — not the grid. That
buys three things: fewer tokens per step, a model that *cannot* restate the
widget's contents in prose because it was never given them, and a clean rule for
the prompt (§7).

A tool may return `forView: null` — a lookup that only informs the model's next
sentence needs no view.

---

## 3. Wire protocol

The tutor route streams raw UTF-8 text and the panel appends every chunk
(`tutor-panel.tsx:100`). That cannot carry frames. The Assistant streams
**NDJSON**: one JSON object per line.

```
{"t":"text","v":"Here's the month — "}
{"t":"widget","name":"calendar_month","id":"w1","payload":{…}}
{"t":"text","v":"the 12th is your first checkpoint."}
{"t":"done","turnId":"…"}
{"t":"error","message":"…"}
```

NDJSON over SSE: the client already reads a `ReadableStream`, and SSE's framing
buys nothing here.

**Two gotchas that must be in the tests, not discovered later:**

- Text deltas must be JSON-escaped and the client must **buffer partial lines** —
  a chunk boundary lands mid-object regularly under real network conditions. The
  naive `appendToLast` shape does not survive this.
- A frame emitted after the stream has started cannot change the status code.
  Same constraint the tutor route already documents at line 152: errors after
  first byte are an `error` frame, never a silent truncation.

---

## 4. Server architecture

### 4.1 New modules

| Path | Owns |
|---|---|
| `src/lib/ai/agent.ts` | The tool loop: stream → halt on `tool_use` → execute → resume |
| `src/lib/assistant/tools.ts` | The registry: name, description, schema, handler |
| `src/lib/assistant/prompt.ts` | Frozen system prompt (cached prefix) |
| `src/lib/assistant/widgets.ts` | `WidgetName` union + Zod payload contracts |
| `src/lib/assistant/store.ts` | Thread reads/writes |
| `src/app/api/assistant/route.ts` | Auth, caps, the NDJSON response |

`chat.ts` is left alone. `streamChat` returns when the stream ends and declares
no tools; a loop is a different function, for the same reason `callStructured`
and `streamChat` are already two functions and not one with a flag
(`src/lib/ai/chat.ts:13`).

### 4.2 The loop

```
stream request (system + history + tools)
  → text deltas out as `text` frames
  → stop_reason "tool_use":
      for each tool_use block:
        resolve in registry (unknown name → error result, not a throw)
        execute with the bound context
        emit `widget` frame if forView
        append tool_result (forModel) to messages
      re-request
  → stop_reason "end_turn" → done
  → stop_reason "refusal"  → refusal frame, log, done
```

Bounded by **`MAX_STEPS = 4`** and a **`budgetMs`** wall clock, following the
pattern `src/lib/ai/call.ts:106` already established for the researcher — where
the cost is the *number* of requests, not the size of any one, `max_tokens`
cannot bound it and only time can. Hitting either ceiling ends the turn with what
it has plus an honest sentence, exactly like the researcher's `invalid` path.

### 4.3 Tools are closures, not functions with a userId argument

```ts
// The only shape permitted.
const tools = buildTools({ db, userId: auth.user.id, planId, now });
```

The model picks *which* tool. It never supplies an identity. There is no tool
whose signature accepts a user id, a session id belonging to someone else, or a
raw SQL fragment — see §9.1.

---

## 5. Tool catalog (v1)

All read-only. All already backed by functions that exist.

| Tool | Backed by | Widget |
|---|---|---|
| `my_calendar` | `calendarFor` (`src/lib/calendar/view.ts:147`) | `calendar_month` |
| `whats_next` | `calendarFor().ahead` | `ahead_list` |
| `my_courses` | `coursesFor` (`src/lib/goals/courses.ts`) | `course_list` |
| `my_standing` | `standingFor` (`src/lib/goals/standing.ts`) | `standing` |
| `my_path` | `src/lib/curriculum/store.ts` | `path_outline` |
| `my_plan` | `planFor` + entitlements (`billing/catalog.ts:413`) | `plan_card` |
| `my_charges` | `src/lib/billing/store.ts` | `charges` |
| `find_page` | static route map | `null` (returns a link) |

`find_page` is the cheap one that will earn its keep: most "how do I…" questions
are navigation, and answering them with a real link beats describing a path
through the UI.

---

## 6. Widget catalog, and the extraction that pays for itself

Most of these views already exist — as JSX inlined in a page. The calendar grid
lives inside `src/app/(app)/progress/page.tsx` and is not a component.

**Phase 0 of the build is extraction**, before any assistant code is written:

| Widget | Component | Status |
|---|---|---|
| `calendar_month` | `src/components/calendar-month.tsx` | **done** — extracted from `progress/page.tsx` |
| `ahead_list` | `src/components/ahead-list.tsx` | **done** — extracted from `progress/page.tsx` |
| `week_digest` | `src/components/week-digest.tsx` | **done** — extracted from `progress/page.tsx` |
| `course_list` | `src/components/course-list.tsx` | exists |
| `path_outline` | `src/components/course-outline.tsx`, `step-list.tsx` | exists |
| `standing` | `src/components/nothing-running.tsx` | exists — `standingFor` was already a component |
| `plan_card` | `src/components/plan-card.tsx` | new; reuse `upgrade-nudge.tsx` styling |
| `charges` | `RowList` / `Row` from `components/ui` | compose |

`ahead_list` replaced the planned `next_card`. There was no reason to invent a
card for "what's next" when the progress page already had the list, and the
extraction is worth more than a bespoke component: one definition of what counts
as overdue, in both places.

*Correction from the first draft:* this table originally listed a
`standing-summary` to be extracted from `progress/page.tsx`. There is none —
`standingFor`'s view already lives in `NothingRunning`, shared by four screens.
What is genuinely page-bound and worth a second caller is the **week digest**
("what changed" / "holding on to it"), which is what `my_standing` should render.

This is the part that makes the feature *beautiful* rather than merely
functional: the calendar in the thread is not a chat-flavoured imitation of the
progress page's calendar, it is **the same component**. Every widget inherits the
design tokens, both themes, and the existing empty states for free, and the pages
get tidier as a side effect.

### 6.1 Rendering rules

- Widgets render **inline in the assistant turn**, in arrival order, interleaved
  with the prose around them.
- Each widget is capped in height and scrolls internally; a month grid must never
  push the composer off-screen.
- Every widget carries a **deep link** to the page it came from ("Open progress
  →"). The thread is a fast answer, not a replacement for the page.
- Widgets are **inert**: no forms, no buttons that mutate. Links only. This falls
  out of §1.3 and keeps the widget layer free of its own authorization surface.
- A widget arriving with a payload that fails its Zod contract is dropped and
  logged, and the prose stands alone. A malformed view is worse than none.

---

## 7. Prose rules (the system prompt)

The prompt is frozen and sits in the cached prefix, same as
`buildTutorSystem` (`tutor.ts:53`). The rules that matter:

- **Do not restate what a view already shows.** Add only what it cannot say.
  (Reinforced structurally: the model was never handed the figures — §2.1.)
- **Every fact comes from a tool.** If no tool covers it, say so and offer the
  page. Never estimate a balance, a date, or a charge.
- **You are not the tutor.** Subject-matter questions get one sentence and a
  pointer to the session.
- **You cannot change anything.** For anything that spends, cancels, or
  reschedules, give the link and say what the learner will find there.
- Plain language, short paragraphs, second person, no emoji — house voice, same
  as the tutor.

The user-facing copy rule from the product applies throughout: state the
consequence, never the mechanism. No step counts, no model names, no token talk.

---

## 8. The chat surface

### 8.1 Placement

A launcher in `src/components/app-shell.tsx` so it is present on every `(app)`
page, fixed to the bottom-right, above content, never over the primary action of
a page.

The panel is a **non-modal** drawer. Non-modal is the deliberate choice: this is
consulted *while reading a page*, and a focus trap would make it a detour.
Escape closes; focus returns to the launcher.

**Hand-rolled, not `@radix-ui/react-dialog`.** The package is a dependency, but
nothing in `src/` imports it — so reaching for it here would put a portal and a
focus-trap implementation into the only bundle a signed-in learner receives, to
buy an Escape handler and two aria attributes. Revisit if the panel ever needs
real modal semantics.

Open/closed persistence in `localStorage` moved to Phase 4; it is polish, and an
effect that hydrates after mount is not worth its test surface in the phase that
proves the loop.

### 8.2 States

Every one of these needs a designed state, not a default:

| State | Treatment |
|---|---|
| Empty thread | Three suggested questions, tied to real state ("What's next?", "Show my calendar", "What am I paying?") |
| Thinking | Existing "Thinking…" idiom from `tutor-panel.tsx:138` |
| Running a tool | A quiet line — "Checking your calendar…" — from the tool's own label, not the model's |
| Widget loading | `Skeleton` from `components/ui` at the widget's own height, so nothing reflows |
| Refused / capped | The plan-aware sentence, same shape as `overCapMessage` |
| Error mid-stream | The `error` frame's text appended to the turn, never a silent stop |
| No JS | Renders nothing but a `<noscript>` line, exactly as the tutor panel does |

### 8.3 Progressive enhancement

The Assistant is an accelerator, never a dependency. Every answer it can give is
reachable from a page without it, and it ships zero JavaScript to the marketing
routes. This is the same stance `tutor-panel.tsx:14` already takes and the reason
that stance was acceptable there.

---

## 9. Guardrails

### 9.1 Authorization

The whole feature's risk sits here.

- Tools close over the authenticated `userId` (§4.3). No identity argument is
  ever part of a tool schema.
- Every query filters by that id at the database, not in the prompt — the shape
  `sessionView` already uses, where a foreign id is indistinguishable from a
  missing one (`api/tutor/route.ts:45`).
- The route re-checks auth itself. A route handler is a public URL and "the page
  checked" is not a property of the request that arrives at it.
- **Test:** every tool, called under user A with user B's data present, returns
  nothing of B's. This is a required test per tool, not a sampled one.

### 9.2 Prompt injection

Learner-authored text already reaches model context across this product — goals,
submissions, artifact ingest. With read-only tools that is a nuisance: the worst
case is the assistant being persuaded to say something false about data it can
already see, bounded by widgets it cannot author.

**A write tool would turn that nuisance into an incident.** That is the reason
§1.3 is a hard line and not a phasing decision. Revisiting it requires a
confirmation step owned by the page, not by the model.

### 9.3 Honesty

The failure mode that would matter most to this product is an assistant that
invents a charge, a date, or a standing. Three defences, in order of strength:
the model is never given the figures (§2.1); every fact must come from a tool
(§7); and "I can't see that — here's the page" is always a reachable, tested
answer.

---

## 10. Cost and limits

One message is now 1–4 model requests plus tool time, so the tutor's per-session
turn cap does not transfer to an always-open button.

- **Monthly spend cap:** `aiAccess` before every message — the check
  `api/tutor/route.ts:87` already performs. Over cap refuses rather than degrades.
- **New entitlement:** `assistantMessagesPerDay` in `Entitlements`. Daily rather
  than monthly, because the failure mode is a runaway afternoon.
- **Per-message ceiling:** `MAX_STEPS = 4` and `budgetMs`.
- **Ledger:** every step writes an `AgentRun` row via `recordAgentRun`, as
  everything else does. A turn that spent four requests must show four rows —
  never one averaged row, or the weekly per-agent cost review under-reports the
  exact thing it exists to catch.
- **New step keys:** `assistant` in `STEP_MODELS` and `STEP_EFFORT`.

**Model tier:** start on `standard` with effort `null`, matching the tutor. The
work is tool routing plus short prose, which argues for `fast` — but the first
version answers questions with money in them, and Haiku 4.5 rejects the thinking
parameters outright (`models.ts:32`). Measure, then consider demoting. Recorded
as an open decision (§14).

---

## 11. Data model

`interaction.sessionId` is **already nullable** (`src/db/schema/ops.ts:26`), and
both tutor queries filter on it — `turnsTaken` and `transcriptFor` are keyed by
session id, so rows with a null session are invisible to them. Assistant turns
therefore live in `interaction` without touching the tutor's counting, and
`tests/assistant/store.test.ts` asserts that isolation from both directions.

**Shipped in Phase 1, not Phase 3.** The original phasing kept history
client-side until later, and that turned out to be the harder option: it made
the client the source of the replayed transcript, and left the daily cap with
nothing server-side to count. Persisting from the start needs no migration —
`sessionId = null` *is* the single rolling thread §14 decision 3 defaults to —
and it removes the forged-history question before it can be asked.

Still to come, both in Phase 3:

- `interaction.thread_id` — nullable uuid, indexed with `user_id`. Only needed
  when one rolling thread stops being enough.
- `interaction.widgets` — nullable jsonb. The widget frames emitted with that
  turn, so a reopened thread re-renders as it was rather than degrading to prose.

Retention: threads are learner data and are covered by the existing account
deletion cascade (`onDelete: "cascade"` on `user_id`). Confirm the privacy page's
wording covers assistant threads before launch.

---

## 12. Testing and coverage

`AGENTS.md` requires 100% of `src/` — lines, functions, branches, statements —
with no new `coverage.exclude` entries and no `c8 ignore`. The loop is small; the
tool surface times its failure branches is the actual budget. Plan for it up
front.

| Area | Tests |
|---|---|
| Loop | fake client emitting `tool_use`; unknown tool; step cap; budget exhaustion; refusal; error after first byte |
| NDJSON | frame encoding; **split-across-chunk decoding**; malformed line dropped |
| Tools | happy path, empty state, and a cross-user isolation test **each** |
| Widgets | render test per widget incl. empty state; payload failing Zod is dropped |
| Route | 401, 402 over cap, 429 over daily cap, 400 bad body |
| Caps | ledger writes one row per step |

The existing fake-Anthropic seams in `tests/` extend to this; the loop needs a
client double that can emit a `tool_use` block and then an `end_turn`.

---

## 13. Build order

**Phase 0 — extraction.** Pull `calendar_month` and `standing` out of
`progress/page.tsx` into components. No behaviour change, pages keep passing.
Ships value on its own and de-risks everything after it.

**Phase 1 — the loop, text only. Done.** `src/lib/ai/agent.ts` (step cap, wall
clock, per-step ledger, tool failures as results), `src/lib/assistant/*`
(registry with `find_page`, the frozen prompt, the thread and the daily count),
`src/app/api/assistant/route.ts` (NDJSON, 401/400/429/402, error frames), and
`src/components/assistant-panel.tsx` (launcher, line-buffered decoding, tool
labels). `assistantMessagesPerDay` added to every plan. 103 tests across six
files; every file at 100%.

One defect worth recording, because the fix generalises: the page matcher scored
title words at double weight, and "What you can do" is a page title — so **"how
do I cancel my subscription" returned the mastery page**, with "do" outscoring
"cancel". A question word beating the subject of the question is how a lookup
ends up confidently wrong, which is worse than returning nothing. Fixed with a
stop list and a one-rule stemmer, both applied to titles and queries alike.

**Phase 2 — the first widgets. Done.** `src/lib/assistant/widgets.ts` (payload
types, projections, and `summarise` — the thin line the model gets instead of
the payload), `my_calendar` and `whats_next` as closures over the authenticated
context, the widget frame, `readWidget`'s structural guard, and the panel's
segment model.

Two decisions worth recording:

- **A turn is a sequence of segments, not prose with views appended.** A tool
  runs *before* the sentence introducing its result — the model asks, the view
  lands, then it writes around it — so appending would put every calendar
  underneath the words explaining it. §6.1 asks for arrival order; arrival order
  is the only order that reads correctly.
- **Payload types, not Zod schemas.** §2 asked for Zod because it was thinking
  about a model boundary, and this is not one: every payload is projected from a
  value `calendarFor` already typed, so a parse would re-check what `tsc` has
  proved. The real risk is the wire — the panel gets `unknown` from
  `JSON.parse`, and a version skew could hand it a payload this build cannot
  render. That is guarded by a few lines of structural check per widget in
  `readWidget`, which keeps Zod out of the one bundle a signed-in learner
  receives.

**Phase 3 — the rest of the catalog.** Remaining tools and widgets, thread
persistence and re-render.

**Phase 4 — polish.** Suggested questions, tool-running labels, skeletons,
keyboard and screen-reader pass, daily cap copy.

`pnpm verify` clean at the end of every phase.

---

## 14. Open decisions

1. **Model tier** — `standard` to start (§10); revisit against measured tool-call
   quality on `fast`.
2. **Free plan access** — does the free tier get the Assistant at all? Arguments
   both ways: it is a conversion surface, and it is a cost with no evaluation
   attached. Default: yes, with a low `assistantMessagesPerDay`.
3. **Thread lifetime** — one rolling thread per learner, or a new one per day?
   Default: one rolling thread, trimmed to a depth like `TRANSCRIPT_DEPTH`.
4. ~~**Launcher on the session page**~~ — **decided: the assistant stands down
   inside `/session/[id]`** (`hiddenOn` in `assistant-panel.tsx`). The session
   screen carries the tutor in a sticky rail, and the deciding difference is
   that the tutor can *teach* while this explicitly cannot (§1.2). Two launchers
   side by side make a stuck learner choose between them at the moment they are
   least able to, and about half would choose the one whose honest answer is
   "that's what a session is for". It costs the learner nothing: everything the
   assistant answers stays reachable from the pages, and a session is a bounded
   screen they are deliberately inside.

---

## 15. Sequencing note

This does not move either day-60 kill metric (`PLAN.md` §17.3) — those are
retention and evaluation usefulness. It is a support-load and navigation feature,
and its best case is a second-order effect on D7 through onboarding confusion it
removes. Worth building deliberately, worth building after the NOW list.
