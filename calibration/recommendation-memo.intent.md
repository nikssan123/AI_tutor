# `recommendation-memo` — the authoring spec

> **Do not read this until your twenty bands are written down.** It names the
> band every submission was written to exhibit. Reading it first replaces your
> judgement with the author's, and κ against a number you were handed measures
> nothing.

It is a separate file for that reason. `calibration/query-rescue.yaml` carries
the same information as a comment directly above each artefact, where you cannot
avoid it, and the ids there — `s1-no-evidence`, `s5-verified` — announce the
answer before the comment does.

---

## What this is, and what it is not

These are the bands each memo was **written to exhibit**. They are the authoring
spec, not an independent judgement. κ computed against *these* would measure
whether the grader recovers an intent encoded by the same model family that
grades it, which is a construct check and nothing more.

**Your twenty bands are the ones E8 is waiting on.** This file is for reading
afterwards, when a disagreement is worth understanding.

---

## The intended spread

Five submissions × four criteria = 20 judgements, spread deliberately: κ measures
agreement *above chance*, so a corpus where everything is competent has perfect
observed agreement, expected agreement of 1, and no information in it at all.

| submission | `leads-with-the-ask` | `options-and-reasoning` | `honest-uncertainty` | `economy` |
|---|---|---|---|---|
| `catalogue-licence` | competent | **strong** | developing | competent |
| `workshop-cutter` | absent | absent | absent | absent |
| `pen-test` | strong | strong | strong | strong |
| `support-contractor` | developing | developing | developing | competent |
| `security-training` | developing | competent | **strong** | competent |

Band counts: absent 4, developing 5, competent 5, strong 6.

---

## Why each one sits where it does

**`workshop-cutter` — the floor.** The ask is the last line of the last
paragraph; only one option is ever named ("the model we want is clearly the best
option available"); "it'll transform how the team works and will pay for itself
very quickly" is an estimate wearing a fact's clothes, with "everyone I've spoken
to agrees" standing in for evidence; and the first two paragraphs could be
deleted without the reader losing anything. Written the way somebody actually
writes when they are nervous about asking — warm, apologetic, and burying the
number. Not a strawman: every sentence in it is one a real person has sent.

**`support-contractor` — the honest middle-low.** The instinct is right and the
execution is not. The ask *is* in the first paragraph, but arrives fourth, behind
an introduction and two clauses of context, which is `developing` rather than
`competent`. Three alternatives are named and not one carries a reason, which is
the exact `developing` band description. The hedging is real but ungrounded —
"roughly £1,300 a week" cites nothing, "I couldn't put a number on that" declines
the work rather than showing it. Its economy is the one thing that is genuinely
tight: four paragraphs, each doing distinct work, nothing to cut.

**`catalogue-licence` — strong on options, weak on proof.** The options section
is the best in the set and the reason is structural: it states the criterion the
options are judged against ("which of these stops two teams defining the same
metric differently, without adding headcount?") before listing them, so a reader
who disagrees knows what to disagree with. That is the `strong` band. The opening
states the recommendation and what approval means but not the consequence of
declining, which keeps criterion 1 at `competent`. And the last line —
"Atlan will cut our reporting errors substantially and the team will be up and
running inside two weeks" — is two unsourced claims in one sentence, which is why
`honest-uncertainty` sits at `developing` on an otherwise disciplined memo.

**`security-training` — the reverse cut.** Its uncertainty section is the best in
the set: it separates what the writer is confident about from what they are not,
names the basis for the confident half (two post-mortems, by different authors,
cited by number), sources the unconfident half to the vendor and discounts it for
being the vendor's own, and then says what would change the recommendation — the
January scan. That is every clause of the `strong` band. It is `developing` on
criterion 1 for the opposite reason to `catalogue-licence`: the argument is so
good that the ask arrives at the end of a seven-line paragraph.

**`pen-test` — the ceiling.** Opening states the recommendation, the cost and
what declining costs, in that order. Options are judged against a stated
criterion. The uncertainty section separates a *price* from an *estimate* — the
quote is fixed, dated and sourced; the £140,000 is named as a ceiling and the
reason it will fall is given — and it names the condition under which the writer
withdraws the request. It is also the shortest of the four serious memos, which
is what the `strong` band on economy means by brevity feeling generous rather
than terse.

---

## Where this corpus is likely to be wrong

Worth knowing before you read a disagreement as the grader's fault:

- **`catalogue-licence` and `security-training` are the pair the whole corpus
  rests on**, because they are both broadly competent and competent in different
  places. If the grader cannot tell them apart, it is not discriminating — it is
  averaging. Two `competent`s on everything would be the most informative failure
  this run could produce.
- **`economy` is the criterion most likely to disagree**, in both directions. Its
  bands describe an amount ("a third could be cut", "noticeable padding") rather
  than a property, and amounts are where two careful readers legitimately differ.
  A low κ concentrated on this criterion is a rubric finding, not a grader
  finding — `HUMAN-REVIEW.md` part A step 4 is where it goes.
- **The `strong` band on `leads-with-the-ask` requires three things** —
  recommendation, cost, consequence of declining. `pen-test` has all three in two
  sentences by construction. If the grader awards `strong` to
  `catalogue-licence`, whose opening has two of the three, the top band is not
  being read as written.
