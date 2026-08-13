# The human work

Two things gate launch that no amount of code will clear. Both are §23 Phase-0
MUSTs that were skipped when the build started.

Neither is long. Together they are roughly **one focused day** for the SQL pack
alone, which is enough to launch on.

---

# A. Pack review — unblocks the entire SEO channel

## What it actually gates

`isTopicIndexable` requires `maturity: curated` **and**
`quality.reviewedBy !== "unreviewed"`. All three packs currently say
`reviewedBy: unreviewed`, so right now:

- `sitemap.xml` contains **three URLs** — `/`, `/learn`, `/projects`. Nothing else.
- Every `/learn/{topic}`, `/check/{topic}` and `/projects/{slug}` page ships
  `noindex`.
- No `Course` JSON-LD is emitted anywhere.

The entire acquisition strategy is switched off behind one YAML field. Setting
it is a claim you are making — *I have read this end to end* — which is why it
is a name and not a boolean.

## What the machine already checks — do not spend time on these

`pnpm packs:validate` fails the build on all of it:

unique slugs · the skill graph is acyclic · no self-dependencies · no duplicate
edges · every item points at a real skill · every MCQ has ≥2 options · options
only on MCQs · every skill has at least one item · the pack meets the item
minimum · the production-to-MCQ ratio ≥ the §16.4 floor · rubric criterion ids
are unique · **rubric weights sum to exactly 1** · every project resolves to a
real rubric · every project targets real skills · a tier-1 pack ships projects.

## What only you can check

Read in this order — it goes cheapest-to-most-expensive, and a failure early
usually invalidates the thing below it.

### 1. Answer keys (the one that silently corrupts everything)
For every item with an answer: **is the answer right?** A wrong key does not
fail validation, does not look wrong on screen, and mis-assesses every learner
who ever meets it — then feeds that error into BKT, the planner and the ledger.

Counts: **SQL 52 · business-writing 33 · photography 32.**

For MCQs specifically, also check the **distractors are plausible-but-wrong**.
An obviously silly wrong option inflates every score and makes the diagnostic
read as easier than the subject is.

### 2. `canDoStatement` — is it observable?
This sentence is the bar. It is what `/mastery` prints as a claim, what the
check page calls "the bar", and what the whole product means by proof.

- ✅ "Write a SELECT that returns exactly the columns asked for, with clear aliases"
- ❌ "Understand joins" — nothing can observe understanding

Anything you could not settle by looking at a piece of work needs rewriting.
**55 statements across the three packs.**

### 3. Dependency order
The graph is acyclic, which does not make it *right*. Read the edges and ask:
would teaching B before A actually hurt? Window functions before `GROUP BY` is
acyclic and pedagogically backwards. **SQL has 42 edges, the other two ~19 each.**

### 4. Rubric bands — discriminating and mutually exclusive
10 rubrics × ~4 criteria × 4 bands ≈ **160 band descriptions**. For each
criterion, read the four bands in a row and ask: *could one piece of work
honestly land in two of these?* Overlapping bands are where inconsistent
grading comes from — and this is the material the calibration in part B is
about to measure, so fixing it here is much cheaper than discovering it there.

### 5. Project briefs
For each of the 10: can it be done in `estimatedMinutes`, and does it produce an
artefact the rubric can actually be applied to? A brief that yields work the
rubric cannot judge is a dead end the learner only finds after doing it.

### 6. `estimatedHours` per skill
These drive the curriculum, the deadline warning, "~47 hours" on the subject
card, and the pace maths on `/progress` and `/calendar`. They do not need to be
right; they need to not be *embarrassing*. Sum them per pack and sanity-check
the total against how long you would actually expect this to take.

### 7. The tier declaration
`evalTier` in `pack.yaml` is what the pack claims for itself. The public site now
caps every claim at tier 2 (nothing executes), so this is not currently a
learner-facing risk — but it becomes one the day the sandbox ships. Check the
declared tier is one the workspace could genuinely support.

## Then

```yaml
quality:
  status: reviewed
  reviewedBy: Nikolay Lyutov      # your name
  reviewedAt: "2026-08-14"        # the date you finished
```

Then `pnpm packs:validate && DATABASE_URL=… pnpm verify`, and the subject, its
check and its briefs enter the sitemap.

> **Note:** all three packs already say `status: reviewed` while `reviewedBy` is
> `unreviewed`. Nothing reads `status`, so it is a claim in the file that no code
> enforces and no one has made. Set it to `draft` on the two you have not read.

## Recommendation

**Review SQL first and launch on it alone.** It is the beachhead, it is the
calibration pack, and it is 26 of the 55 skills. The other two can land in week
2 — an indexed site with one honest subject beats an unindexed site with three.

---

# B. The calibration corpus — unblocks E8, and tests the thesis

§23 lists this as a MUST and §27 says **do not proceed past E8 without it**. It
was never done. It is the number that tells you whether the product's core claim
is technically true, and it is the last unmet acceptance criterion on E8.

## What E8 has to clear

1. **Cohen's κ ≥ 0.6** between your grades and the model's.
2. **Two runs on the same submission land within one band ≥85% of the time.**

## The protocol

**Pick one project.** `slow-query-rescue` — SQL, four criteria, evenly weighted
apart from the last:

| id | criterion | weight |
|---|---|---|
| `diagnosis` | The cause is correctly identified | 0.30 |
| `improvement` | The query is measurably faster | 0.30 |
| `correctness-preserved` | The result is unchanged | 0.30 |
| `proportionality` | The fix is proportionate | 0.10 |

**Write 5 submissions that span the range.** This is the part that is easy to get
wrong: if all five are decent, κ is meaningless — it measures agreement *above
chance*, and with no variance there is nothing above chance to measure. Aim for
roughly:

- 1 that is plainly **absent** on most criteria — wrong diagnosis, no measurement
- 1 **developing** — right instinct, incomplete execution
- 2 **competent** — the realistic middle, and the band that matters most
- 1 **strong** — verified, measured, proportionate

Write them as a learner would, mess included. A corpus of clean submissions
tells you how the grader handles clean submissions, which is not the question.

**Grade all five by hand, before running anything.** For each submission, place
each of the four criteria in one of `absent | developing | competent | strong`.
That is **20 judgements**. Write them down first — if you grade after seeing the
model's output you will anchor to it and the number will be flattering and
worthless.

**Then run the evaluator** on each, twice.

- Compare run 1 against your grades → **κ**, over 20 paired judgements, 4 bands.
- Compare run 1 against run 2 → **the stability figure**, the share of the 20
  criterion pairs landing within one band.

## How to read the result

| κ | What it means |
|---|---|
| **≥ 0.6** | E8's criterion is met. Ship it. |
| **0.4–0.6** | The rubric is probably the problem, not the model. Go back to part A step 4: it is nearly always two bands a human cannot separate either. |
| **< 0.4** | The thesis is in trouble. §17.3's kill criteria exist for this; better to learn it now than at day 60 with 100 signups. |

Where you and the model disagree, **read the model's evidence quote**. The
verifier already rejects any score whose quote is not verbatim in the artefact,
so a disagreement is a genuine difference of judgement rather than a
hallucination — and it is usually the rubric being ambiguous rather than either
of you being wrong.

## What I can build for this

Say the word and I will write `scripts/calibration.ts`: reads a corpus of
submissions plus your hand-grades from a YAML file, runs the evaluator twice per
submission, and prints κ and the stability figure. That turns the 20 judgements
into a repeatable check you can put in CI — which is what §27 D21–25 asked for
("run the Phase-0 calibration set as an automated eval in CI").

Your part stays the same either way: **5 submissions and 20 hand-grades.**
