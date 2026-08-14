# Curriculum sources

What the seven packs were checked against, and where they diverge from it.

`HUMAN-REVIEW.md` asks you to judge whether each pack is *right*. The three
model reviews already recorded in `pack.yaml` (SQL, business writing,
photography) did not answer that question — they checked **internal
consistency**: answer keys against their own items, dependency edges against
their own graph, rubric weights summing to 1. A pack can pass all of that and
still teach the wrong syllabus.

This document covers the other half: every pack read against the tutorials,
university courses and standard texts that actually teach the subject. It does
not make you a domain expert. It tells you where we disagree with the people
who are, so the disagreements can be deliberate instead of accidental.

**Result: 1 verifiable defect, 29 coverage gaps, 2 contested claims stated as
settled.** Nothing here blocks a launch on SQL. The defect is in home cooking.

---

## What I checked against

Provenance matters in a document whose whole purpose is grounding, so the last
column is honest about it. "Read directly" means I fetched the page and read its
actual contents list. "Search summary" means the source blocked automated
fetching and I worked from search results describing it — good enough to place a
topic, not good enough to quote.

| Pack | Reference | What it is | Access |
|---|---|---|---|
| SQL | [SQLBolt](https://sqlbolt.com/) | 20-lesson interactive course | Read directly |
| SQL | [SQL for Data Analysis](https://www.oreilly.com/library/view/sql-for-data/9781492088776/) (Tanimura, O'Reilly 2021) | The analyst-facing SQL text | Search summary |
| Python | [CS50P](https://cs50.harvard.edu/python/) | Harvard's intro Python course, 9 lectures | Read directly |
| Python | [Think Python 3e](https://allendowney.github.io/ThinkPython/) (Downey) | 19-chapter CS-style text | Read directly |
| Python | [Automate the Boring Stuff](https://automatetheboringstuff.com/) (Sweigart) | The practical standard, 24 chapters | Read directly |
| Statistics | [OpenIntro Statistics](https://www.openintro.org/book/os/) | The open-source stats textbook, 9 chapters | Read directly |
| Statistics | [Calling Bullshit](https://www.callingbullshit.org/syllabus.html) (UW, Bergstrom & West) | 12-week data-literacy course | Read directly |
| Writing | [Purdue OWL](https://owl.purdue.edu/owl/subject_specific_writing/professional_technical_writing/index.html), professional & technical writing | 17-section reference | Read directly |
| Writing | [HBR Guide to Better Business Writing](https://store.hbr.org/product/hbr-guide-to-better-business-writing/10946) (Garner) | The business-writing standard | Search summary |
| Writing | [Minto Pyramid Principle](https://modelthinkers.com/mental-model/minto-pyramid-scqa) | SCQA, answer-first, MECE | Search summary |
| Writing | [Federal plain language guidance](https://digital.gov/guides/plain-language) | Four-category framework | Read directly |
| Finance | [Investor.gov roadmap](https://www.investor.gov/introduction-investing/investing-basics/save-and-invest) (SEC) | 9-step saving/investing sequence | Read directly |
| Finance | [Bogleheads investment philosophy](https://www.bogleheads.org/wiki/Bogleheads%C2%AE_investment_philosophy) | 10 principles | Search summary |
| Finance | [CFPB building blocks](https://www.consumerfinance.gov/consumer-tools/educator-tools/youth-financial-education/learn/) | Financial-capability framework | Search summary |
| Photography | [Cambridge in Colour](https://www.cambridgeincolour.com/photography-tutorials.htm) | ~80 tutorials, 5 sections | Read directly |
| Photography | [Understanding Exposure](https://openlibrary.org/works/OL3901933W/Understanding_exposure) (Peterson) | The exposure standard | Search summary |
| Cooking | [Salt Fat Acid Heat](https://en.wikipedia.org/wiki/Salt_Fat_Acid_Heat_(book)) (Nosrat) | Four-element technique framework | Framework read directly; chapter list search summary |
| Cooking | [The Food Lab](https://en.wikipedia.org/wiki/The_Food_Lab) (López-Alt) | 9 chapters, science-led | Search summary |
| Cooking | [USDA safe minimum internal temperatures](https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/safe-temperature-chart) | The regulatory ground truth | Search summary |
| Cooking | Culinary fundamentals syllabi (MATC, Escoffier, Rouxbe) | Standard module lists | Search summary |

Three sources refused automated fetching (Bogleheads, FSIS/foodsafety.gov,
O'Reilly) and Reddit's r/photoclass is unreachable from here. Where a finding
rests on a search summary rather than a page I read, it says so.

---

## Where the packs stand

| Pack | Hours | Skills | Verdict | Defects | Gaps |
|---|---|---|---|---|---|
| SQL & Data Analysis | 47.25 | 26 | Closest to reference coverage of the seven | — | 5 |
| Python Fundamentals | 30 | 17 | Excellent on gotchas, incomplete as "fundamentals" | — | 4 |
| Statistics & Data Literacy | 27.5 | 14 | Correctly scoped, missing three canonical traps | — | 5 |
| Business Writing | 26.5 | 14 | Well grounded, missing the process spine | — | 4 |
| Personal Finance | 23.5 | 13 | Strong mechanics, no goals and no behaviour | — | 3 + 2 contested |
| Photography | 27.5 | 15 | Technically thorough, compositionally thin | — | 5 |
| Home Cooking | 26.5 | 13 | Coherent spine, one whole cooking method missing | **1** | 3 |

SQL is roughly twice the depth of any other pack. That tracks with it being the
flagship, but the six others sit beside it in one catalogue at 23–30 hours each,
and a learner comparing two subject pages sees that difference.

---

## SQL & Data Analysis

The strongest pack, and it beats its references in two places. `join-grain`
(fan-out inflating a SUM) and `result-validation` are standalone skills here and
are not standalone lessons in *any* reference I checked — they are also the two
things that most often produce a confidently wrong number in production.
Putting `null-semantics` at foundational, before joins, is better sequencing
than SQLBolt, which introduces NULLs *after* outer joins (lesson 8, after
lesson 7).

**Gaps**

1. **Query execution order** — SQLBolt gives this its own lesson (12). We have
   no skill for it, and it is the concept that explains three things we do
   teach: why `having-vs-where` is a real distinction, why a `SELECT` alias
   can't be used in `WHERE`, and why a window function can't sit in `WHERE`.
   Suggest a `execution-order` skill at foundational, ~1h, as a hard
   prerequisite of `having-vs-where` and a soft one of `window-basics`.
2. **Profiling the input** — Tanimura devotes her entire chapter 2 to preparing
   data for analysis (profiling, cleaning, shaping) and places it before every
   analysis chapter. `result-validation` checks the *output*. Nothing here
   teaches a learner to interrogate a source table before trusting it.
3. **Text and string functions** — Tanimura's chapter 5 is text analysis.
   `LIKE` appears inside `filtering`; there is no skill for parsing, splitting,
   concatenating or regex-matching strings, which is routine analyst work.
4. **`UNION` / `UNION ALL`** — `EXCEPT` and `INTERSECT` are folded into
   `semi-and-anti-joins`, but stacking two periods with `UNION ALL` never
   appears. Minor.
5. **`CASE` arrives late** — its first appearance is `conditional-aggregation`
   (advanced). Most curricula teach `CASE` as a mid-level expression before
   window functions, because earlier exercises want it. Ordering, not coverage.

**Deliberate scope, not gaps.** No `INSERT`/`UPDATE`/`DELETE`/DDL, which is
SQLBolt lessons 13–18 — coherent for a read-only analysis pack. No experiment
analysis (Tanimura chapter 7); that lives in the statistics pack.

---

## Python Fundamentals

The distinctive skills here are genuinely good and mostly absent from the
references: `names-and-references` (aliasing vs rebinding),
`mutable-default-arguments`, `scope-and-closures` (late binding),
`reading-a-traceback` and `choosing-a-structure`. Only Automate has an analogue
— its chapter 5, "Debugging". These are what make it a course rather than a
syntax tour.

But it is thinner than any reference calling itself fundamentals, at 30 hours
against CS50P's nine problem-set weeks.

**Gaps**

1. **Classes and objects** — CS50P week 8; Think Python chapters 14–17; absent
   here entirely. This is the largest single omission in any pack. Either add
   it or rename the pack so the scope is honest.
2. **Modules, imports and the standard library** — CS50P gives this a full week
   ("Libraries"). A learner finishing this pack has never written `import`,
   though `files-and-paths` implies `pathlib`.
3. **Regular expressions** — CS50P week 7, Automate chapter 9, Think Python
   chapter 8. All three references teach it; we don't.
4. **Recursion** — Think Python chapter 5. Lowest priority of the four; the
   practical references de-emphasise it too.

**Ordering divergence worth a decision.** We make `lists-and-tuples` a *hard*
prerequisite of `loops-and-iteration`. All three references go the other way:
CS50P teaches loops in week 2 and lists later; Automate has loops in chapter 3
and lists in chapter 6; Think Python has iteration in chapter 7 and lists in
chapter 9. Ours is defensible — you iterate over a collection, so know the
collection first — but it is the inverse of every reference, so it should be a
choice rather than an accident.

---

## Statistics & Data Literacy

Correctly scoped. The pack is modelled on the data-literacy end (Calling
Bullshit) rather than the inference end (OpenIntro), and that is right for an
audience reading claims rather than fitting models — skipping OpenIntro
chapters 5–9 is a feature. `reporting-a-number` (denominators, significant
figures, exclusions) and `challenging-a-claim` map to Calling Bullshit's week 12
and are taught almost nowhere else.

**Gaps** — all four are named topics in Calling Bullshit, a real university
course (UW INFO 198), not a blog post.

1. **Simpson's paradox** — week 5, "Statistical Traps and Trickery". The
   strongest recommendation in this document, because it is the exact
   statistical twin of the SQL pack's `group-by-grain`: the same result reverses
   when you change the grain you aggregate at. We teach the SQL half and not the
   statistical half.
2. **Regression to the mean** — week 4, listed alongside correlation-and-cause.
   It is the mechanism behind "we intervened and it got better", which is the
   single most common false causal story in business.
3. **Fermi estimation and plausibility checks** — week 2's core practical tool.
   `sample-size-intuition` is adjacent but answers a different question.
4. **Goodhart's law and proxy metrics** — week 7. Arguably the most
   business-relevant idea in the entire reference course for anyone who owns a
   dashboard.
5. **No probability before `base-rates`** — OpenIntro puts probability
   (chapter 3, including conditional probability) before all inference.
   `base-rates` asks a learner to "work out how often a positive result is
   actually correct" with `population-and-sample` as its only prerequisite. The
   no-algebra approach may well be right; it is currently implicit.

---

## Business Writing

Well grounded. `the-one-thing` is Minto's governing thought — answer first —
correctly placed as foundational with a hard edge into `structure-and-signposting`.
And `difficult-messages`, `written-feedback` and `meeting-notes` are truer to
modern work than what the references spend their pages on (Purdue OWL: grant
letters, donation requests, white papers; Garner: business letters, performance
appraisals).

**Gaps**

1. **The writing process — drafting is not editing** — Garner organises the
   entire HBR guide around four stages: Madman (gather), Architect (outline),
   Carpenter (draft), Judge (edit). Purdue OWL has a full "Revision in Business
   Writing" section. We have `cutting`, which is an editing *skill*, but nothing
   that teaches the separation of passes. It is the organising spine of the
   primary reference and we don't have it. *(Garner via search summary.)*
2. **MECE and grouping logic** — Minto's rule is that ideas at each level must
   summarise the group below, and each group must be mutually exclusive,
   collectively exhaustive and logically ordered. `structure-and-signposting`
   covers ordering but not the grouping test. Possibly fixable in the
   description plus one item rather than a new skill.
3. **Document design for scanning** — "Design for understanding" is one of the
   four top-level categories in the federal plain-language guidance: headings,
   lists, tables, white space. We have signposting but nothing visual.
4. **Testing on a reader** — the fourth federal category, "Test for
   understanding". Also the only feedback loop in a pack that otherwise grades a
   learner's writing in isolation.

---

## Personal Finance

The mechanics are strong and correctly ordered — compounding before real
returns before fee drag, with `stating-assumptions` gating `stress-testing`.
`fees-and-drag` computing lifetime cost rather than glancing at a percentage is
better than any reference states it.

**Gaps**

1. **Goals and horizon** — investor.gov's step 1 is "Define your goals";
   Bogleheads principle 1 is "Develop a workable plan". The pack opens at net
   worth. This is not just an omission: `risk-and-volatility` promises to
   distinguish risk "for a stated horizon and goal", and `stress-testing`
   consumes the same thing. **The pack depends on a skill it never teaches.**
2. **Investor behaviour** — "Never try to time the market" and "Stay the course"
   are 2 of the 10 Bogleheads principles, and the references treat an investor's
   own panic-selling and performance-chasing as the main risk to a plan.
   `spotting-bad-advice` covers bad actors outside the learner; nothing covers
   the learner. *(Bogleheads via search summary.)*
3. **What you can actually buy** — Bogleheads 6 ("use index funds when
   possible") and investor.gov's "Learn about investment options". We teach
   diversification and fees in the abstract and never name an instrument or an
   asset class. This may be deliberate — `tax-wrappers` uses exactly that
   jurisdiction hedge — but a learner finishes unable to act on any of it.

**Contested claims stated as settled.** These are the two things you asked about
that you could not have checked yourself.

- **`emergency-buffer` says liquid savings come "before investing and before
  extra debt repayment."** Investor.gov orders it the other way round: pay off
  high-interest debt (step 4), *then* save for a rainy day (step 5).
  r/personalfinance's flowchart splits the difference — small starter fund,
  employer match, high-interest debt, then the full fund. We have picked one
  side of a live sequencing debate and taught it as fact. Teaching the tradeoff
  costs nothing and is more honest.
- **`cost-of-debt` teaches ordering repayments by rate, not balance.** That is
  the avalanche method; it is mathematically correct and matches investor.gov.
  But the snowball's behavioural counter-argument is the mainstream opposing
  view, and a pack that contains `spotting-bad-advice` should probably
  acknowledge the debate exists rather than assert one side.

---

## Photography

Technically thorough. `consistency-across-a-set` appears in no reference
curriculum I checked and is a real professional skill. Splitting `light-quality`
from `light-direction` matches how lighting is genuinely taught. And
`focal-length-and-perspective` teaching that perspective comes from *where you
stand*, not from the lens, is the correct framing of a thing most tutorials get
wrong.

**Gaps**

1. **Composition** — the pack carries three exposure skills against two framing
   skills. Cambridge in Colour has a full composition section (rule of thirds,
   diagonals and leading lines, negative space), and every beginner curriculum
   leads with it. Missing specifically: visual weight and balance, leading
   lines, and where to place a subject in the frame and why. Largest gap here.
2. **Noise, and what ISO costs** — Cambridge treats "Understanding Image Noise"
   as its own tutorial. `exposure-triangle` mentions trading ISO; no skill
   covers what you pay for it or the noise-versus-shutter decision in low light.
3. **Critical sharpness and camera shake** — Cambridge has both "Understanding
   Sharpness" and "Reducing Camera Shake with Hand-Held Photos". `focus-accuracy`
   covers the focal plane but not shake, the reciprocal rule, or diffraction.
4. **Sharpening and noise reduction in post** — Cambridge gives this a whole
   subsection. Our post path runs raw → tonal → consistency with no detail stage.
5. **Colour management and output** — an entire Cambridge section (calibration,
   colour spaces, soft proofing, export). Low priority for a web-first learner,
   real for anyone who prints.

---

## Home Cooking

The `mise-en-place` → `reading-a-recipe` → `substitution` →
`cooking-from-what-you-have` progression is exactly the arc Nosrat argues for —
recipes as jumping-off points — and no reference cookbook makes "cook from your
inventory" an assessed skill. That part is good.

### Defect: the pack never states a single temperature

`food-safety`'s own description reads "Cross-contamination, cooling, reheating
and **the temperatures that matter**. The one area of this subject with a right
answer." `doneness` says temperature "is the only one that does not depend on
experience you do not have yet."

A grep across all four YAML files returns **no temperature of any kind** — no
165, no 145, no 160, no danger-zone bounds, in Fahrenheit or Celsius. The
reheating item's correct answer is "Getting all of it piping hot the whole way
through", which is the UK FSA's phrasing where the USDA gives a number.

So the one part of the one pack with an objective right answer is graded on a
vibe. The numbers to put in the answer keys, from the USDA chart *(via search
summary — worth confirming against the FSIS page in a browser before you commit
them, since it blocks automated fetching)*:

| Food | Minimum internal temperature |
|---|---|
| Poultry, whole or ground | 165°F / 74°C |
| Whole cuts — beef, pork, veal, lamb | 145°F / 63°C, then rest 3 minutes |
| Ground meat other than poultry | 160°F / 71°C |
| Leftovers, reheated | 165°F / 74°C |
| The danger zone | 40–140°F / 4–60°C |

### Gaps

1. **Fat is missing.** The pack visibly borrows Nosrat's four-element frame —
   `acid-and-balance` literally names "the four levers — salt, acid, fat,
   sweetness" — and ships skills for salt, acid and heat but none for fat.
   Nosrat gives fat a quarter of the book: fat as a cooking medium and its smoke
   point, fat as texture, fat as emulsion. Emulsions and sauces are also a
   standard module in every culinary syllabus I found. The pack is inconsistent
   with the framework it is quoting.
2. **Only dry-heat cooking is taught.** Every culinary fundamentals syllabus
   splits dry-heat from moist-heat methods. Our `heat` area is sear/sweat/simmer,
   browning, doneness and resting; `building-a-pan-sauce` is dry-heat too.
   Nothing on braising, steaming, blanching, poaching or boiling. A learner
   finishes this pack able to cook a piece of meat and never taught to braise.
3. **Protein-centric throughout.** No vegetable, starch, grain, legume or egg
   cookery. The Food Lab gives chapters to vegetables, pasta and salads;
   culinary syllabi list vegetables, grains and legumes as core modules.

---

## What I'd do next

In priority order, and the first one is the only one I would call urgent:

1. **Home cooking** — put the USDA numbers into the `food-safety` and `doneness`
   answer keys. It is the only finding here that makes an existing item wrong
   rather than absent.
2. **Personal finance** — add a goals-and-horizon skill, because two existing
   skills already depend on it; and soften the two contested claims into
   tradeoffs.
3. **Statistics** — add Simpson's paradox. It pairs with SQL's `group-by-grain`
   and is one skill for a large gain.
4. **SQL** — add query execution order. Cheap, and it props up three skills
   that currently stand on nothing.
5. **Python** — decide whether this pack is pre-OOP by design. If yes, say so in
   the pack name or description; if no, it needs classes, imports and regex,
   which is a substantial addition.
6. **Home cooking (again)** — fat as a skill, and at least one moist-heat
   method. This is the pack furthest from its references and it is currently
   `maturity: standard`, so nothing is being over-claimed while it waits.
7. **Photography** — a composition skill covering balance and leading lines.
8. **Business writing** — a drafting-versus-editing skill.

## What this does not settle

Nothing here lets you set `reviewedBy` to your name. It is still a model review;
it is now a model review *with external sources cited*, which is strictly better
than the three consistency reviews already in the tree but is not the human
sign-off that `HUMAN-REVIEW.md` describes and that the "Written and checked by
hand" badge claims.

What it does change is the cost of that sign-off. You no longer have to know SQL
or food safety well enough to audit 55 answer keys from scratch — you have to
decide about two dozen specific, sourced disagreements, most of which are
one-line judgements about scope.

Recording these sources in `pack.yaml` itself is possible but not free: the
manifest schema in `src/lib/packs/types.ts` is a plain Zod object, so unknown
keys are silently stripped rather than rejected. A `references:` block would
validate, round-trip, and be read by nothing. Making it real means a schema
field, a migration and tests.
