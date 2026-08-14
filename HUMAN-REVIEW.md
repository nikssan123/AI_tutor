# The human work

Three things gate launch that no amount of code will clear. Two are §23 Phase-0
MUSTs that were skipped when the build started; the third (part C) arrived with
E12's first pages and is by far the smallest.

> **Updated 2026-08-14.** Part A has been done as far as a model can do it: all
> seven packs are now reviewed end to end and signed `reviewKind: model`, with
> the findings in each `pack.yaml` and the external grounding in
> `CURRICULUM-SOURCES.md`. **That is not the sign-off this document asks for**,
> and the difference is now visible on the page rather than buried in a YAML
> comment — a model review earns the badge "Checked against published
> curricula", never "Written and checked by hand".
>
> What changed for you: you are no longer auditing 55 answer keys from scratch.
> Nine defects were found and fixed (listed under "What the model review already
> did"), and what is left for a human is **countersigning** — reading a pack you
> care about and, if you agree, changing `reviewKind: model` to `human` with
> your name. That is the only edit that upgrades the badge.
>
> Part B is unchanged in what it needs from you, but is now half done: the five
> submissions are written (`calibration/query-rescue.yaml`), so your work is the
> **20 grades** and nothing else. Band stability — E8's other criterion — has
> been measured and is met; see below.

None is long. Together they are roughly **one focused day** for the SQL pack
alone, which is enough to launch on; part C adds twenty minutes for the two
pages worth publishing first.

---

# A. Pack review — unblocks the entire SEO channel

## What it actually gates

`isTopicIndexable` requires `maturity: curated` **and** a recorded
`quality.reviewKind`. The three Curated packs are signed, so the SQL, business
writing and photography subjects, their checks and their public briefs are in
the sitemap and emit `Course` JSON-LD.

The other four are `maturity: standard` and stay out regardless of review,
because Curated is a claim about how a pack was *authored* and a review does not
change that. Promoting one is a separate decision from signing it.

> **Two bugs this gate had, both fixed 2026-08-14.**
>
> It **failed open.** The test was `reviewedBy !== "unreviewed"` — the absence of
> a sentinel rather than the presence of a value — and `reviewedBy` defaults to
> `null`, which is not that string. A pack that simply omitted its `quality`
> block was therefore indexable *without ever having been reviewed*; only a pack
> that explicitly opted out was held back. The gate now asks for a positive
> `reviewKind`, so the default is the closed position.
>
> And the badge **overclaimed**. "Written and checked by hand" was keyed on
> `maturity` alone, so all three signed-by-model packs wore it on live indexed
> pages. `reviewKind` is what separates them now.

## What the machine already checks — do not spend time on these

`pnpm packs:validate` fails the build on all of it:

unique slugs · the skill graph is acyclic · no self-dependencies · no duplicate
edges · every item points at a real skill · every MCQ has ≥2 options · options
only on MCQs · every skill has at least one item · the pack meets the item
minimum · the production-to-MCQ ratio ≥ the §16.4 floor · rubric criterion ids
are unique · **rubric weights sum to exactly 1** · every project resolves to a
real rubric · every project targets real skills · a tier-1 pack ships projects.

## The sheet

```sh
pnpm review:sheet                    # all three, into review/
pnpm review:sheet sql-data-analysis  # just the beachhead
```

One document per pack, collating only what a human has to judge, in the order
below. `review/` is gitignored — these are working documents you tick through,
and the generator refuses to overwrite one unless you pass `--force`.

Reading a pack *as* four YAML files means jumping between an item, the skill it
assesses, and the rubric that grades the project targeting it. That is how a
review turns into a skim.

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

## What the model review already did

Do not repeat this. All seven packs, end to end: every answer key, every can-do
statement, every dependency edge, every rubric band and every brief. Nine
defects found and fixed:

| Pack | Defect |
|---|---|
| **all seven** | **The correct multiple-choice option was never once A**, and was B 76% of the time — 6 of 6 in both home cooking and personal finance. Always guessing B scored 76% across the catalogue and 100% on two packs, and it fed straight into BKT. Redistributed to a 29% ceiling against a 25% chance floor, and now a blocking validator rule (`mcq_answer_position`) so it cannot drift back |
| home cooking | Two skills promised "the temperatures that matter" and **no file stated a single temperature**; the reheating item marked "piping hot". Numbers now read directly off the FSIS chart and Danger Zone page in a browser |
| home cooking | `one-vegetable-four-cuts` targeted `food-safety`, which its rubric does not assess — mastery for "Not poisoning anyone" would have moved on how evenly a carrot was diced |
| home cooking | `sear-rest-and-prove-it` targeted `salting`, same problem |
| personal finance | `risk-and-volatility` and `stress-testing` both consumed "a stated horizon and goal" and **no skill taught it**. `goals-and-horizon` added |
| personal finance | Two contested claims stated as settled (buffer-before-debt, avalanche-over-snowball) softened to the tradeoffs the items already taught |
| python | `names-aliasing` asked for "the one-character change" that makes it print `[1, 2, 3]`. The smallest is three characters and the item's own key says so — the question was unanswerable |
| SQL, business writing, photography | Previously reviewed; re-signed under `reviewKind` |

The coverage *gaps* — 29 of them, in `CURRICULUM-SOURCES.md` — were deliberately
not closed. They are authoring work rather than defects, and the top two
(Simpson's paradox for statistics, query execution order for SQL) are the ones
worth doing first.

## Then, if you countersign

```yaml
quality:
  status: reviewed
  reviewedBy: Nikolay Lyutov      # your name
  reviewKind: human               # this is the line that changes the badge
  reviewedAt: "2026-08-14"        # the date you finished
```

`reviewedBy` and `reviewKind` must be set together or the pack will not load —
a reviewer with no kind is half a claim.

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

1. **Cohen's κ ≥ 0.6** between your grades and the model's. — **still open, and
   only you can close it.**
2. **Two runs on the same submission land within one band ≥85% of the time.** —
   ✅ **met, measured 2026-08-14: 100% within one band, and 100% same band, over
   16 pairs.**

### On the stability figure

Criterion 2 never needed a human and was blocked behind one anyway, because the
runner refused to start without a full set of grades. It now takes
`--stability-only`, which skips the κ half:

```sh
DATABASE_URL=… ANTHROPIC_API_KEY=… pnpm calibrate --stability-only calibration/query-rescue.yaml
```

Measured over the five written submissions: **every criterion landed in the
identical band on both runs**, not merely within one. Ten deep-tier calls, about
40 seconds each.

One of the ten refused — `s4-solid-but-unproven` pass 2 returned "the marker
could not run (invalid)", which is the verifier rejecting the grade rather than
an API error, and the runner dropped the pair rather than inventing a band for
it. So the figure rests on 16 pairs, not 20. **A ~10% refusal rate is the more
interesting number here than the 100%**, and it is not covered by either E8
criterion: a learner whose submission refuses twice sees a failure, not a grade.
Worth watching once there is volume.

### Why the corpus's own `grades` are not your grades

`calibration/query-rescue.yaml` ships with a `grades` block per submission. Those
are the bands each artefact was **written to exhibit** — the authoring spec, not
an independent judgement — and κ computed against them measures whether the
grader recovers an intent that was deliberately encoded by the same model family
that grades it. That is a construct check and nothing more.

**Your 20 grades are still the thing E8 is waiting on.** What has changed is that
you no longer have to write the five submissions first.

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

## Running it

```sh
# calibration/query-rescue.yaml already exists, with the five submissions
# written. Read them, overwrite each `grades:` block with your own bands —
# before running anything — then:
DATABASE_URL=… ANTHROPIC_API_KEY=… pnpm calibrate calibration/query-rescue.yaml
```

The file carries the four criteria with all sixteen band descriptions inline, so
you grade without switching files, and each submission notes the band it was
*written* to exhibit so you can see where you disagree with the author. Treat
that note as the author's intent, not as evidence.

`calibration/query-rescue.example.yaml` is the empty template it was made from,
kept for the next project's corpus.

The runner checks the corpus before spending anything — an unknown or missing
criterion id stops it, because a corpus that quietly measures 12 pairs instead of
20 is worse than one that refuses to run. Then it grades each submission twice
and prints:

- **κ** against your grades, with the observed and by-chance agreement it came from
- **the stability figure**, run 1 against run 2
- **every disagreement, worst first** — the list actually worth reading
- a verdict, and a non-zero exit code on failure so it can sit in CI as §27
  D21–25 asks

The arithmetic is in `src/lib/evaluation/agreement.ts` and unit-tested, including
the two ways this measurement misleads: a corpus with no spread (κ undefined, not
zero) and a mispaired corpus (a smaller honest `n`, never a silent mismatch).

Your part is now **20 hand-grades**, and nothing else. The five submissions are
written and the stability half is measured and met.

---

# C. The guide read — unblocks the first eight SEO pages

New, and much the smallest of the three. §12.1 rule 5 is *"no page ships without
a human read"*, and it is the only §12 defence that cannot be automated. The
other four are: the volume is 8 pages and not 5,000, every page carries a
working tool, the prose is hand-written, and `noindex` is the default.

## What it gates

`isGuideIndexable` asks for three things: a §12.2 score of ≥75, an empty problem
list, and a recorded reviewer. **The first two are already met.** All eight
guides score 100/100 on every dimension that can be measured, have no
outstanding problems, and all twenty-five of their cited sources return 200.

So the pages exist, render, and are one line each away from the sitemap.

```
content/guides/why-do-i-forget-what-i-learn.yaml
content/guides/why-am-i-stuck-in-tutorial-hell.yaml
content/guides/how-many-hours-a-week-to-learn-a-new-skill.yaml
content/guides/how-do-i-know-if-im-actually-improving.yaml
content/guides/best-way-to-learn-a-skill-as-an-adult.yaml
content/guides/how-long-does-it-take-to-learn-sql.yaml
content/guides/how-long-does-it-take-to-learn-python.yaml
content/guides/what-should-i-learn-after-python-basics.yaml
```

They are listed in the order worth reading them, which is cheapest-to-judge
first — see the recommendation at the end.

## What the machine already checked — do not spend time on these

`pnpm guides:validate` and `pnpm guides:sources`:

every internal link resolves to a page that exists · ≥4 outbound and ≥2
contextual inbound links · no citation without a declared source · no declared
source that nothing cites · every `{{…}}` figure resolves against a real pack ·
no near-duplicate of another guide · a section under 400 words · a working tool
that is not a hub page · title ≤60 characters · description 140–160 · the direct
answer between 40 and 60 words · every cited URL returns 2xx.

Two of §12.2's ten dimensions are **not** measured and are printed as such on
every run: search-intent match needs a SERP API, and the SERP half of the
uniqueness check needs an embedding model. Neither is faked.

## What only you can check

Read each page end to end — they are about 900 words each — and ask three
questions the score cannot:

### 1. Is anything in it wrong?
The learning-science claims all carry citations you can follow. The
**subject-matter** claims do not, and those are the ones a reader will judge us
on. Four are worth your attention specifically:

| Guide | The uncited claim |
|---|---|
| SQL hours | A pivot table is a `GROUP BY` and a VLOOKUP is a join with one row on one side |
| SQL hours | Grain and NULL behaviour are where confident spreadsheet users get *wrong answers* rather than errors |
| After Python basics | The four that matter next are traceback, exceptions, tests and structured data — **not** a framework |
| After Python basics | Names-and-references is the skill most courses skip, and the pair with mutable defaults is where confident beginners come apart |
| Python hours | "Learn Python" is three different courses — scripting, data, web — sharing one core |
| Hours per week | Below about two hours a week, split across two sittings, most adults lose ground faster than they gain it |
| Adult learning | Deep on one subject, mixed within it; two subjects at once halves your spacing on both |

The Python ordering claim is the strongest one on any of these pages and the one
I would most like challenged. It is defensible from our own skill graph, which
is where the dependency order comes from — but the graph is a model review, not
a hand-checked one.

The **two-hours-a-week floor** is the other one worth arguing with. The
direction is well supported and the specific number is a judgement, presented as
one ("about two"). If you think it discourages people who would have been fine
on one hour, that is a fair objection and the sentence should change.

### 2. Does it sound like you?
This is the only copy on the site that argues rather than states. If a sentence
reads as marketing, it is one I wrote badly — say which and it comes out.

### 3. Would it be useful to somebody who never signs up?
§11's quality bar, in one line. If a page only makes sense as a funnel, it does
not ship.

## Then, if you sign

```yaml
review:
  reviewedBy: Nikolay Lyutov
  reviewKind: human
  reviewedAt: "2026-08-14"
```

Then `pnpm guides:validate && DATABASE_URL=… pnpm verify`, and each signed page
enters the sitemap with breadcrumb and `FAQPage` markup.

**Sign them one at a time.** They are five separate files and five separate
decisions; there is nothing that wants doing in a batch, and the `/guides` hub
joins the sitemap as soon as the first one does.

**Signing is not required for the pages to be useful.** A draft still renders,
still links out, and still says on its own face that nobody has read it. What
signing changes is whether we ask Google to rank it.

## Recommendation

**Read them in this order**, which is cheapest-to-judge first:

1. `why-do-i-forget-what-i-learn` — no subject-matter risk at all. Every claim
   is learning science with a citation behind it.
2. `why-am-i-stuck-in-tutorial-hell` — same, plus one argument of ours (that the
   missing skill is *choosing*, not knowledge).
3. `how-many-hours-a-week-to-learn-a-new-skill` — cited throughout; the one
   judgement in it is the two-hour floor, above.
4. `how-do-i-know-if-im-actually-improving` — the thesis page. Judge it as
   positioning as much as prose; it is the one that says out loud why there is
   no percentage anywhere in the product.
5. `best-way-to-learn-a-skill-as-an-adult` — mostly cited. Worth checking the
   10,000-hours correction reads as useful rather than pedantic.
6. `how-long-does-it-take-to-learn-sql` — two uncited SQL claims, above.
7. `how-long-does-it-take-to-learn-python` — the three-destinations framing is
   ours and load-bearing.
8. `what-should-i-learn-after-python-basics` — the strongest uncited claim on
   the site. Read it last and read it hardest.

If you only have twenty minutes, do 1 and 2. **Two indexed pages that are
certainly right beat eight that are probably right**, and the rest keep in the
repository as drafts indefinitely at no cost.

---

# D. Email copy in German and Spanish — twenty minutes, and it is not urgent

## What it gates

Nothing, technically. `/admin/mail` and the four transactional messages work in
all four languages today, and a learner whose `user.locale` is `de` already
receives German.

What it gates is **whether we should be proud of it**. Bulgarian in
`src/lib/email/copy/bg.ts` was written by you and reads like a person; German
and Spanish are careful machine-assisted drafts that no native speaker has read.
PLAN-LOCALIZATION decision 12 permits exactly this — "machine translation is
fine for the product UI pre-review, never indexable" — and email is never
indexable, so the rule is satisfied. But a password-reset email is one of the
few things a stranger reads *closely*, and a sentence that is grammatical and
slightly off is a worse first impression than one that is obviously translated.

## What the machine already checks — do not spend time on these

`tests/lib/email-copy.test.ts` already fails the build if:

- a locale is missing any string (that one is a type error, not even a test);
- a `{placeholder}` present in English is missing from a translation, so no
  German reader can be told a link expires without being told when;
- any string other than a deliberately empty heading is blank;
- a "translation" is byte-identical to the English.

So the failure modes left are all matters of register and idiom, which is
precisely what a person is for.

## What only you can check

Nine strings per language are worth real attention. In `de.ts` and `es.ts`:

1. **`operator.welcome.body[1]`** — the sentence that states what MeritKeep is.
   It is the hardest sentence in the product to translate and the one most
   likely to read as a machine's paraphrase.
2. **`operator.checkIn`** — the whole thing. It is a message to someone who
   went quiet, and the line between "we noticed, tell us what happened" and
   "you have not been doing your homework" is entirely register.
3. **`system.resetPassword.footer`** — the security sentence. It has to be
   unambiguous that nothing has happened yet.

Everything else is short and mechanical.

## The two decisions already made, which a reviewer should either keep or overturn

- **German uses "Sie" throughout.** A German learning product could defensibly
  use "du". The choice matters less than the consistency; if a reviewer prefers
  "du", it has to change in all nine strings at once.
- **Spanish uses "tú", and avoids gendered adjectives.** `welcome` says "Te
  damos la bienvenida" rather than "Bienvenido" because we do not collect the
  reader's gender and should not guess it.

## Recommendation

Do this when you have a native speaker to hand and not before — there is no
deadline, and no German or Spanish learner exists yet. Bulgarian is the locale
that will matter first, and Bulgarian is already right.
