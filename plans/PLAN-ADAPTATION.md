# Adapting a pack to one learner

How a curated pack becomes a crash course for one person and a two-year
apprenticeship for another, and how the tutor adapts inside a session — without
rebuilding what E4–E7 already do, and without becoming the thing §2.2 says not
to compete on.

---

## First: most of this already exists

Before designing anything, here is what already runs. Rebuilding any of it would
be the expensive mistake.

| The ask | Already built | Where |
|---|---|---|
| "Skip what they already know" | Adaptive diagnostic, converges in 8–10 items; skills with evidence ≥ 0.85 are excluded from the path with a printed reason | `engine/diagnostic.ts`, `goals/projection.ts` |
| "Adjust to their time" | `timeFit` score component, `availableMinutes` per session, `weeklyHours` on the profile | `engine/scoring.ts` |
| "Compress when they're in a hurry" | Deadline override — doubles goal criticality, drops non-essential skills, **tells the learner what was cut** | `engine/scoring.ts`, `reason.ts` |
| "Lessons pitched at their level" | Lesson generator varies by mastery band, minutes bucket and support level; cached | `session/lesson.ts` |
| "Easier when they're struggling" | `supportLevel` flips to `worked_example` after a failure; `frustrationRisk` and a hard back-off damper | `lesson.ts`, `scoring.ts` |
| "A tutor that knows them" | Chat with the full Learner Context Block as a cached prefix | `session/tutor.ts` |
| "Any subject, not just the seven" | Generated packs — $0.61 and ~190s per *subject*, shared by everyone who asks | `packs/generate/` |

The adaptation machinery is real and it is deterministic. What is missing is
narrower than it looks.

---

## The actual gap: depth is not a dial

Every lever above adapts **pace**. Nothing adapts **depth**. Today the scope of a
course is fixed by one hardcoded line in `goals/projection.ts`:

```ts
function isOptional(skill: EngineSkill): boolean {
  return skill.level === "specialist";
}
```

Everything non-specialist is required, for everyone, always. A learner with three
weeks before a job interview and a learner spending a year on the subject get the
same 26-skill SQL course. The only way to shorten it today is to set a deadline
and let the compression override fire — which is a *failure* path that announces
the plan was cut, not a choice anyone asked for.

So: one new dial, three positions, set at goal intake and changeable later.

### What each position changes

| | **Sprint** | **Standard** | **Mastery** |
|---|---|---|---|
| Levels kept | `foundational`, `core` | + `advanced` *(today's behaviour)* | + `specialist` |
| Then closed under | hard prerequisites | hard prerequisites | — (no-op) |
| Optional set | The remainder — still learnable, not counted | `specialist` | ∅ |
| Artefact cadence | Every 3rd session | Every 4th *(today)* | Every 3rd |
| SQL pack size | **14 skills, 21.75h** | **23 skills, 38.75h** | **26 skills, 47.25h** |
| Mastery bar | **0.85** | **0.85** | **0.85** |

The last row is the important one.

### What the dial must never change

**The mastery bar does not move.** Not for sprint, not ever. A skill claimed on
the ledger means the same thing for every learner or it means nothing, and the
ledger is the entire differentiator (§4.2 law 1). A sprint claims *fewer* skills,
never *weaker* ones.

This is what separates the design from the obvious version. The tempting move is
to lower `MASTERY_TARGET` to 0.7 for a crash course so it finishes faster. That
would silently make two learners' proof pages incomparable and corrupt the one
asset that isn't a commodity.

### Why the sprint set is computed, not generated

**This changed during implementation.** The design above said "hard closure of
the goal's terminal skills", and that turned out to be circular: nothing stores a
goal's terminal skills. `today.ts` passes `projection.requiredSkillIds` to the
planner *as* `goalSkillIds`, so a projection defined in terms of goal skills
would be defined in terms of itself.

The non-circular seed was already in the pack: `level`. The author of every skill
has already declared whether it is foundational, core, advanced or specialist, and
that judgement is exactly the one a depth dial needs. So the rule is two steps —
keep the levels the depth is for, then **close that set under hard
prerequisites** so nothing kept depends on something dropped.

The closure is what stops a depth setting producing an unlearnable course. §16.1's
eligibility filter gates on every hard prerequisite reaching 0.7, so a required
skill whose hard prerequisite was dropped can never unlock: the path would dead-end
with no screen able to explain why. Checked across all seven curated packs, no hard
edge runs from a higher level to a lower one, so the closure is a no-op there. It
earns its place on **generated** packs, where `level` is model-assigned and nothing
guarantees the ordering.

Worked through the SQL pack, a sprint keeps the five foundations and the nine core
skills — through `join-grain` and `ctes` — and drops the advanced and specialist
tails: `window-basics`, `window-ranking`, `lag-lead`, `window-frames`,
`cohort-analysis`, `date-truncation-and-series`, `conditional-aggregation`,
`self-joins`, `semi-and-anti-joins`, `correlated-subqueries`, `result-validation`
and `query-performance`. Fourteen skills and 21.75 hours instead of twenty-six and
47.25.

**`result-validation` landing in that list should make you uncomfortable**, and it
is the honest cost of a crash course: the learner asked to go fast, and it is not a
hard prerequisite of anything. The path screen already prints "skipped because…"
for every exclusion, so they will see it. If that trade is unacceptable for a
particular pack, the fix is a pack-level `neverDrop: true` on a skill — a schema
change, deferred until a real pack needs it rather than added speculatively.

### Implementation surface — built

Smaller than planned, because **no migration was needed**. `GoalSpec` is stored
whole in the existing `learning_goal.goal_spec` jsonb, and a Zod `.default()`
means every goal written before the dial existed reads back as `standard` — the
behaviour it was actually planned under. The separate column this document
originally called for would have duplicated a field the row already carries.

| File | Change |
|---|---|
| `engine/types.ts` | `COURSE_DEPTHS`, `CourseDepth`, `DEFAULT_COURSE_DEPTH`, `DEPTH_LEVELS`; `depth` on `PlannerInput` |
| `engine/graph.ts` | `distancesToGoal` takes an optional edge type; new `hardClosure` |
| `goals/projection.ts` | new `keptSkillIds`; `projectSkills` and `courseSkillIds` take depth |
| `engine/session-composer.ts` | `APPLY_SESSION_INTERVALS` replaces the constant 4; `isApplySession(index, depth)` |
| `engine/planner.ts` | threads depth to the composer and to the reason string |
| `contracts/goal.ts` | `CourseDepthSpec`, `GoalSpec.depth` defaulted |
| `goals/today.ts`, `goals/achievement.ts`, `mastery/view.ts`, `/goals/[id]/path` | pass the goal's depth |

`goals/achievement.ts` is the one that would have been a silent bug: `isAchieved`
compares claimed skills against `courseSkillIds`, and a sprint measured against
the standard set could never finish — the learner would claim everything their
course asked for and still be counted short.

Everything else — BKT, the lesson cache, the tutor, the scoring weights — is
untouched. `/goals/[id]/path` needed no change at all; `exclusionReasons` and the
optional list already render.

**State:** typecheck, lint and all 3238 tests pass; every file above is at 100%
coverage. Not committed — the working tree also holds unrelated in-flight work in
`src/lib/check/` that is below the coverage threshold.

---

## Where AI personalization goes, and where it must not

The instinct is to generate a bespoke lesson per learner. Don't, and the reason
is in `lesson.ts`:

> That reuse is the reason nothing learner-specific goes into a lesson. A lesson
> that opened "you struggled with this on Tuesday" would be correct for one
> person and a cache entry nobody else can be served.

Lessons cache on `(skillId, level, styleHash)` and are expected to hit 40–60%
once a pack has a few hundred learners. Making them per-learner takes that to 0%
and multiplies content cost by every learner, to produce prose that is *worse*
than the shared version — because the shared one gets regenerated and improved
against many learners' outcomes, and a bespoke one is written once and never seen
again.

So personalization is layered by how expensive it is to vary:

| Layer | Varies by | Cost of varying | Verdict |
|---|---|---|---|
| **Which skills** | The whole learner history | Free — code | Vary aggressively |
| **Which order, which day** | Mastery, decay, momentum | Free — code | Vary aggressively |
| **Which support level** | Recent failures | Free — picks a cache key | Vary aggressively |
| **Lesson prose** | Skill + band + length + support | ~$0.03, amortised across learners | Vary along the **existing 4 axes only** |
| **The conversation** | Everything | ~$0.01/turn, cached prefix | **This is where "private lessons" lives** |

The one cheap addition worth making at the lesson layer: `GoalSpec.existingAssets`
is captured at intake and read by nothing. A closed vocabulary of prior domains
(`knows_python`, `knows_excel`, `knows_none`) as a **fifth cache dimension** lets
a SQL lesson reach for the analogy the learner already has, while still being
shared by every other learner who ticked the same box. Bounded personalization
that survives caching. Free-form personalization does not.

---

## The tutor loop: how it starts to feel like a person

The tutor today is a very good explainer that cannot affect anything. Its rules
are right — it must never claim mastery — but the current design throws away
everything it observes. A private tutor's actual value is noticing "you've got
this, let's move on" and *acting on it*.

The move is to let the tutor **trigger assessment, never substitute for it.**

After each turn, one Haiku classification into a closed set of signals:
`stuck_on(skill)` · `already_knows(skill)` · `misconception(named)` ·
`pace_too_slow` · `pace_too_fast`. These are not evidence — self-report and
model impression are Tier 5, and Tier 5 can never raise mastery. They are routed
to three places that are **not** mastery claims, two of which already exist:

1. **`support` for the next lesson** — already a parameter. `stuck_on` flips it
   to `worked_example`, which is what a failure already does.
2. **`frustrationRisk`** — already a planner score component. Repeated `stuck_on`
   damps the skill before the learner has to fail twice to trigger the back-off.
3. **An offer** — the new surface. `already_knows` or `pace_too_slow` puts a
   prompt in the session: *"Sounds like you have this. Want to prove it and skip
   ahead?"* → runs a **real check** → real evidence → mastery moves → the
   projection drops the skill and everything downstream re-plans.

That third path is the whole design. The learner experiences a tutor who noticed
they were bored and jumped them forward — which is exactly the private-lesson
feeling — and the ledger still only ever records something they proved. Nothing
is congratulated into existence.

The inverse works too: `misconception(named)` can inject a targeted retrieval
item on that specific error into tomorrow's session opener, rather than waiting
for the spaced queue to come round.

**Cost:** ~15 turns per session × Haiku classification ≈ $0.015, against a
session budget of $0.17. About 9% for the thing that makes the product feel
alive. Comfortably inside §20.2's envelope.

---

## The strategic question you should answer before I build this

§2.2 and the product-direction note both say: **do not compete on AI-generated
curricula.** roadmap.sh sells unlimited AI courses, roadmaps and tutoring at
$10/mo on ~470K organic visits a month. The differentiation is rubric-graded
evaluation of real work plus an evidence-backed mastery ledger.

"Let's use AI to adjust the lessons to the user and feel like custom curriculum"
is one short step from that commodity. So, plainly:

**This design stays on the right side of the line, but only because of two
constraints.** The syllabus stays pack-derived — a hand-authored or
validator-gated skill graph with real answer keys and rubrics behind it. And
mastery still only moves on graded evidence. Personalization is applied to the
*path through* verified material, never to the material's existence.

The version that would cross the line: generating a fresh syllabus per learner
per goal. That is cheaper to build than this document, it demos beautifully, and
it is precisely what a competitor already gives away at a third of the price with
better SEO.

There is also a positioning consequence. Do not market this as "custom
curriculum" — you would be entering the term roadmap.sh owns, and losing. Market
the part nobody else can copy: *it knows what you have already proven, because it
watched you prove it.* Same feature, and the second framing is the one the
mastery ledger is evidence for.

---

## Build order

Each of these ships with tests, per `AGENTS.md` — 100% of `src/`, no exclusions.

1. ~~**The depth dial.**~~ **Built.** No AI, no new prompt, no cache impact, and
   no migration. See the implementation table above.
2. ~~**Depth on the path screen.**~~ **Built.** `goals/depth.ts` prices all three
   sizes against the learner's own mastery — so the number on the button is the
   number the path shows after they press it — and `setGoalDepth` moves the goal
   with a read-modify-write on the stored spec, touching nothing else.

   Two things came out of building it. The claim "switching never takes away a
   skill you've already proved" started as a runtime check, which was dead code:
   exclusion is decided on evidence and never consults depth, so the guard could
   only ever return true. It is a property of `projectSkills`, asserted in the
   test suite where it belongs. And the sprint↔mastery step is often exactly one
   skill, which is how the button came to read "Add 1 skills" until it didn't.

   Switching does **not** rebuild the stored curriculum. The projection
   recomputes on every render, so the path is right immediately; regenerating
   behind a radio button would spend a model call the learner did not ask for.
3. ~~**Tutor signal classification.**~~ **Built.** `session/signals.ts` plus a
   `tutor_signal` table, classified on Haiku after the answer has streamed.

   Shipped with four labels rather than five: pace folded into the other two,
   because "too fast for me" is `stuck` and "too slow for me" is
   `already_knows`, and a value routing to identical receptors is a field that
   rots. `misconception` reuses the grader's own table rather than starting a
   second list.

   The damper weights a signal at **half a failed attempt, capped at two**, so
   chat alone reaches 0.5 against the 1.0 that three failed attempts say. Support
   escalates and never de-escalates, which keeps the band as the floor and the
   lesson cache at two buckets per band rather than one per learner.

   The route now wraps the call in its own try. `noteTurn` catches its own
   errors, but that cannot cover its call *site* — `getAnthropic` throws with no
   API key — and an escape appended "[The tutor stopped early]" to an answer that
   had already arrived complete.
4. ~~**The prove-it-and-skip offer.**~~ **Built**, as `session/prove.ts` — and
   the name is now wrong in a way worth keeping a note of. **Nothing is
   skipped.** Accepting appends real items from the pack's bank to the session,
   and the learner answers them through `answerCheck` like any other question.
   Mastery moves on the answers or it does not move at all; the skill leaves the
   path only when the belief clears the bar, which is what that bar already
   means.

   It routes into `answerCheck` rather than the adaptive diagnostic. The
   diagnostic owns its own state and stopping rules and is built to *locate* a
   learner across a whole pack; this tests one claim, and re-using the session's
   own block runner meant no second grading path existed to keep honest.

   Hardest items first — the inverse of the diagnostic's max-information rule,
   because an easy question cannot separate someone who knows a skill from
   someone who has seen it. MCQ excluded: a block renders a textarea, and a
   guessable item is weak evidence for a volunteered claim.

   The answers count both ways, and the card says so. A test greps the rendered
   copy for "skip ahead" and "mark it as known" and fails if either appears.
5. ~~**`existingAssets` as a fifth lesson cache dimension.**~~ **Built** as
   `priorDomain`: `none | spreadsheets | programming | statistics`, emitted by
   the analyzer during a conversation it was already having rather than
   classified afterwards by a second call.

   `none` adds no prompt line at all, so those lessons are byte-for-byte what
   was being generated before — which matters, because that is most learners in
   most subjects, and the alternative is invalidating the whole cache to add a
   sentence that says nothing.

   The prompt offers the analogy and explicitly permits ignoring it. Told only
   that a reader knows spreadsheets, a model will reach for a pivot-table
   metaphor in a lesson on NULL semantics, where it is worse than no analogy —
   the reader unlearns the comparison as well as learning the skill.

Not now: per-learner lesson generation (kills the cache, worse prose), a
per-learner generated syllabus (the commodity), and any depth setting that moves
`MASTERY_TARGET` (corrupts the ledger).

One dependency worth naming: all of this makes the system *feel* better, and none
of it makes evaluation more accurate. E8 is still built-not-accepted, blocked on
five hand-graded submissions that only you can produce. A tutor that adapts
beautifully into a grader that hasn't hit κ ≥ 0.6 is a better demo and not yet a
better product.
