import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  GoalSearch,
  JsonLdScript,
  RubricLadder,
  SectionHead,
} from "@/components/marketing";
import {
  ChecklistIcon,
  GridIcon,
  PenIcon,
  StepsIcon,
} from "@/components/icons";
import {
  Card,
  HeroTitle,
  Lead,
  MaturityBadge,
  Meta,
  revealAt,
  stagger,
  Status,
} from "@/components/ui";
import { allTopics, featuredProject } from "@/lib/content";
import {
  MAX_GENERATED_SKILLS,
  MIN_GENERATED_ITEMS,
  MIN_GENERATED_SKILLS,
  MIN_ITEMS_PER_SKILL,
} from "@/lib/contracts/pack";
import { organisation, website } from "@/lib/seo/jsonld";
import { groupByCategory } from "@/lib/content/categories";
import { marketingMetadata } from "@/lib/seo/metadata";

/**
 * §8 screen 1 — the landing page.
 *
 * Eighth cut, and it is the first one about *order* rather than about any
 * single band. The seventh had five bands, four of which opened with a
 * `SectionHead` over a grid of hairline-topped items, so the page read as one
 * shape repeated until it ran out — and two of those bands said the same thing
 * twice. What a visitor met, in order, was: a headline, an empty half-screen, a
 * process diagram, three paragraphs of small print about generation quality
 * floors, and *then* the marking. The single most convincing artefact the
 * product owns was the fourth thing on the page.
 *
 * Four changes, and only the last is cosmetic:
 *
 * 1. **The fold says what the product is.** Under the input, three claims on
 *    one line — checklist first, real work, scores that quote you. A visitor
 *    who reads nothing else knows what this is.
 * 2. **The example comes before the caveats.** The marking band moves to 02.
 *    "Here is a real task and the exact standard it is held to" is the
 *    argument; the offer to write a subject nobody has written is the *scope*
 *    of the argument, and scope belongs after the thing it scopes.
 * 3. **The catalogue is one band, not two.** 04 listed five category cards that
 *    all linked to the same page, and 05 listed three subject cards under a
 *    narrower claim. Between them they said "we have subjects" twice and named
 *    three of them. One row list now does both jobs: every category, every
 *    subject in it, each one linked.
 * 4. **Every band has a different shape.** A rail, a two-pane card on the
 *    accent field, a single card, a row list. §8.5.9's point about composition,
 *    applied to a page that was obeying it band-by-band and nowhere across.
 *
 * **What moved off this page, deliberately.** Each subject used to carry both
 * §7.1's maturity and §7.2's evaluation claim in the catalogue band. Those are
 * choosing information, and nobody chooses a subject here — they choose on
 * `/learn`, where `SubjectCard` still carries both, and on the subject page.
 * Saying less is never the overclaim §4.2 law 3 rules out; what the page may
 * not do is imply the hand-written depth covers everything, so band 04's
 * closing line names both kinds and sends the reader where the labels are.
 *
 * §8.5.7 is still the licence for the length: "Long is fine; *dense* is not."
 * One idea per band, four bands, nothing stacked.
 *
 * §13.1 — statically rendered, revalidated daily.
 */
export const revalidate = 86_400;

export const metadata: Metadata = marketingMetadata({
  title: "Learn anything — and prove you actually learned it",
  // §13.3's metadata rule — title ≤60 characters, description 140–160, so
  // neither is cut mid-promise in a result. Both halves of the offer have to
  // survive the truncation, which is what decides the wording here.
  description:
    "Ask for any subject. If nobody has written it, we write it in about three minutes — then your work is marked against a checklist you read first.",
  path: "/",
  social: {
    description:
      "There is no catalogue. Ask for a subject nobody has written and we write it — the skills, the questions, and the checklist your work is marked against.",
  },
});

/**
 * The three sentences the fold has to land.
 *
 * Not a summary of the bands below — a statement of what the product *is*,
 * which is the thing a visitor was previously left to infer from a headline and
 * half a screen of white space. Each one is answered in full further down: the
 * first by band 02, the second by the brief in it, the third by the rule every
 * evaluation in the product is held to (§4.2 law 4).
 */
const PROMISES = [
  "You read the checklist before you start",
  "You hand in real work, not a quiz",
  "Every score quotes the part it came from",
];

/** One line each. If a step needs two, the step is wrong. */
const STEPS = [
  {
    name: "Say what you want to learn",
    body: "Anything, in your own words. If nobody has written it, we write it first.",
  },
  {
    name: "Take a ten-minute check",
    body: "The questions get harder or easier as you answer, so it finds your level fast.",
  },
  {
    name: "Get a plan",
    body: "It skips what you can already do, and tells you what it skipped.",
  },
  {
    name: "Do a real piece of work",
    body: "Not a quiz. You hand in something you made.",
  },
  {
    name: "Get it marked",
    body: "Every score quotes the part of your work it is based on.",
  },
];

/**
 * What gets written when nobody has written your subject.
 *
 * Every number here is imported from the contract the generator is held to, not
 * typed into the copy: `MIN_GENERATED_SKILLS`/`MAX_GENERATED_SKILLS` bound the
 * graph the model is asked for, and `MIN_ITEMS_PER_SKILL` with
 * `MIN_GENERATED_ITEMS` are two of the three gates in `meetsQualityFloor`. If
 * the floor moves, this paragraph moves with it — which is the only way a
 * promise this specific stays true a year from now.
 */
const WRITTEN = [
  {
    name: "The skills, in order",
    body: `${MIN_GENERATED_SKILLS} to ${MAX_GENERATED_SKILLS} of them, each one placed after whatever you need first.`,
  },
  {
    name: "Questions that find your level",
    body: `At least ${MIN_ITEMS_PER_SKILL} per skill and ${MIN_GENERATED_ITEMS} in all, so the check has something to work with.`,
  },
  {
    name: "Work that can be marked",
    body: "At least one real task, and the checklist it will be marked against.",
  },
];

/** The one link style used in running text on this page. */
const INLINE_LINK =
  "font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent";

export default function HomePage() {
  const topics = allTopics();
  const featured = featuredProject();
  // Band 04's shape. A new pack changes this page by existing, rather than by
  // anyone remembering to come back here and add it — which is the failure that
  // made the page claim a three-subject site twice.
  const categories = groupByCategory(topics);

  // Suggestions come from real pack content, so the autocomplete can never
  // promise a subject the product does not actually teach. Picking one goes
  // straight to the subject rather than to a search that finds it again.
  const suggestions = topics.map((t) => ({
    label: t.name,
    href: `/learn/${t.slug}`,
  }));

  // The brief's opening paragraph is the hook; the rest is on the brief page.
  const hook = featured.brief.split("\n")[0]!;

  // The heaviest criterion gets the full ladder — it is the one that decides
  // the grade, and four ladders on one page would be the density §8.5.1 bans.
  const criteria = featured.rubricDetail.criteria;
  const [leading, ...rest] = [...criteria].sort((a, b) => b.weight - a.weight);

  return (
    <>
      <JsonLdScript blocks={[organisation(), website()]} />

      <main>
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        {/*
         * Two columns, because one was the problem.
         *
         * The single-column hero was a headline, a paragraph, an input and
         * three grey bullets down the left, with forty per cent of a 1440px
         * viewport empty beside them — and nothing anywhere on the fold that
         * showed what the product *does*. A visitor's first impression of a
         * product about marked work was a search box.
         *
         * The right column is the compressed form of band 02: the criteria the
         * featured brief is really marked on, with their real weights, and the
         * pass bar named. §12's rule holds — every string in it comes out of a
         * Domain Pack, and there is still no mocked-up dashboard and no invented
         * screenshot of a graded submission anywhere on this site. It is the
         * thing itself, small.
         */}
        <section className="recede mx-auto max-w-5xl px-6 pt-16 pb-16 sm:pt-20">
          <div className="grid grid-cols-1 items-center gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="flex flex-col gap-7">
              {/* No measure of its own — the column is the measure now, and a
                  `max-w` on top of it only ever fights the grid. `text-balance`
                  on `HeroTitle` evens the lines out. */}
              <HeroTitle className="rise">
                Learn anything. Then prove you actually learned it.
              </HeroTitle>

              <Lead className="rise" style={stagger(1)}>
                Type any subject. If nobody has written it yet, we write it —
                the skills, the questions that find your level, and the
                checklist your work gets marked against.
              </Lead>

              <div className="rise flex flex-col gap-3" style={stagger(2)}>
                <GoalSearch suggestions={suggestions} autoFocus size="hero" />
                {/* Precise about *which* thing is free of an account: the check
                    on a subject we have written is anonymous, and having one
                    built for you is not. */}
                <Meta>Free to start. The ten-minute check needs no account.</Meta>
              </div>
            </div>

            {/*
             * The specimen, on its own parallax layer.
             *
             * `drift` moves it against the page as the hero scrolls, which is
             * what stops the two columns reading as one flat block — and it is
             * the first thing on the site that visibly answers to the scroll.
             */}
            <div className="drift" style={{ "--drift": "56px" } as CSSProperties}>
              <Card className="rise flex flex-col gap-5 p-7" style={stagger(2)}>
                <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-ink-faint">
                  What your work is marked on
                </span>
                <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                  {featured.title}
                </span>

                <ul className="m-0 flex list-none flex-col p-0">
                  {criteria.map((criterion) => (
                    <li
                      key={criterion.id}
                      className="flex items-baseline justify-between gap-4 border-b border-hairline py-2.5 last:border-b-0"
                    >
                      <span className="text-[length:var(--text-label-size)] text-ink">
                        {criterion.name}
                      </span>
                      <Meta className="shrink-0 tabular-nums">
                        {Math.round(criterion.weight * 100)}%
                      </Meta>
                    </li>
                  ))}
                </ul>

                <span className="flex items-center gap-2 border-t border-hairline pt-4">
                  <Status tone="verified">
                    Competent on each is a pass
                  </Status>
                </span>
              </Card>
            </div>
          </div>

          {/*
           * The half-screen of nothing that used to sit under the input, spent.
           *
           * Three claims across the fold's closing rule. Not a feature list and
           * not a summary of the page: the answer to "what is this", for the
           * reader who decides whether to keep scrolling before band 01.
           */}
          <ul
            className="rise m-0 mt-12 grid list-none grid-cols-1 gap-x-8 gap-y-3 border-t border-hairline p-0 pt-6 sm:grid-cols-3"
            style={stagger(3)}
          >
            {PROMISES.map((promise) => (
              <li key={promise} className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-1.5 inline-block size-2 shrink-0 rounded-full bg-accent"
                />
                <span className="text-[length:var(--text-label-size)] leading-[var(--text-body-line)] text-ink">
                  {promise}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── 01 How it works ────────────────────────────────────────────── */}
        <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-16">
          <SectionHead
            step="01"
            label="How it works"
            title="Five steps, start to finish"
            icon={<StepsIcon />}
          />

          {/*
           * A rail rather than a stack: at desktop the five steps read as one
           * sequence across the page, which is what makes it look like a
           * process instead of another bulleted list.
           *
           * The numeral is a 14px chip rather than a 24px figure. At display
           * size it collided with the section's own "01" eyebrow directly above
           * it — two numbering systems, both accent, both saying "01", meaning
           * different things.
           */}
          <ol className="grid list-none grid-cols-1 gap-x-8 gap-y-8 p-0 m-0 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step, i) => (
              <li
                key={step.name}
                className="reveal flex flex-col gap-3 border-t border-hairline pt-5"
                style={revealAt(i)}
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 items-center justify-center rounded-[var(--radius-pill)] bg-accent-weak text-[length:var(--text-meta-size)] font-[650] text-accent"
                >
                  {i + 1}
                </span>
                <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                  {step.name}
                </span>
                <Meta>{step.body}</Meta>
              </li>
            ))}
          </ol>
        </section>

        {/* ── 02 A real task and its marking scheme ──────────────────────── */}
        {/*
         * The one full-bleed accent field on the site, the second thing on the
         * page rather than the fourth, and the one place the page stops.
         *
         * §8.5.4 warns that large saturated fills glare in dark —
         * `--accent-weak` is a *tint* in light and a near-black jade in dark, so
         * it reads as a field in both without either one shouting.
         *
         * `pin-scene` makes the section 190vh and names a scroll timeline;
         * `pin-stage` sticks the card to the top of the viewport for that
         * length; and the rubric's four rungs build against the section's
         * progress while the card itself holds still. See `globals.css` for why
         * the named timeline is the load-bearing part — a pinned element's own
         * `view()` timeline is frozen by definition, so it has to be driven by
         * something that is still moving.
         *
         * Both extra properties live inside the `@supports` and
         * `prefers-reduced-motion` guards, so a browser that cannot run this —
         * or a reader who asked for less motion — gets an ordinary band of
         * ordinary height rather than a viewport and a half of dead scroll.
         */}
        <section className="pin-scene relative bg-accent-weak">
          <div className="pin-stage mx-auto flex max-w-5xl flex-col gap-8 px-6 py-16">
            <SectionHead
              step="02"
              label="What marking looks like"
              title="A real task, and the standard it is held to"
              icon={<ChecklistIcon />}
              onField
            />

            {/*
             * One card with two panes, not two cards.
             *
             * As two cards they were siblings in a grid with `items-stretch`,
             * and the brief is much shorter than a four-rung ladder — so the
             * left card carried 200px of empty surface at the bottom on every
             * viewport above 1024px. They are one artefact anyway: this is a
             * brief *and* its marking scheme, which is the whole point being
             * made, and a hairline says "two halves of one thing" where a gap
             * said "two things that failed to line up".
             */}
            <div className="grid grid-cols-1 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-lifted)] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              {/* The task */}
              <div className="flex flex-col gap-5 border-b border-hairline p-7 lg:border-r lg:border-b-0">
                <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-ink-faint">
                  The task
                </span>
                <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                  {featured.title}
                </span>
                <p className="m-0 text-ink-muted">{hook}</p>

                <div className="flex flex-col gap-2 border-t border-hairline pt-5">
                  <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                    What counts as done
                  </span>
                  <ul className="flex list-none flex-col gap-2 p-0 m-0">
                    {featured.acceptanceCriteria.map((line) => (
                      <li key={line} className="flex items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-accent"
                        />
                        <Meta>{line}</Meta>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* What it costs and what you hand in. Both were on the brief
                    page only, which meant the one example on the landing page
                    never said how big a piece of work it was. */}
                <span className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-hairline pt-5">
                  <Meta>{featured.topicName}</Meta>
                  <Meta>{featured.estimatedMinutes} min</Meta>
                  <Meta>Hand in: {featured.evidenceType}</Meta>
                </span>
              </div>

              {/* How it is marked */}
              <div className="flex flex-col gap-6 p-7">
                <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-ink-faint">
                  How it is marked
                </span>

                <RubricLadder criterion={leading!} />

                <div className="mt-auto flex flex-col gap-3 border-t border-hairline pt-5">
                  <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                    The other things it is marked on
                  </span>
                  <ul className="flex list-none flex-col gap-2.5 p-0 m-0">
                    {rest.map((criterion) => (
                      <li
                        key={criterion.id}
                        className="flex items-baseline justify-between gap-4"
                      >
                        <span className="text-[length:var(--text-label-size)] text-ink-muted">
                          {criterion.name}
                        </span>
                        <Meta tone="muted" className="shrink-0">
                          {Math.round(criterion.weight * 100)}%
                        </Meta>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* §8.5.4 — --ink-faint measures 4.15:1 on the accent field, under
                the 4.5:1 small-text bar, so meta text here steps up to muted. */}
            <Meta tone="muted">
              You see all of this before you start.{" "}
              <Link href={`/projects/${featured.slug}`} className={INLINE_LINK}>
                Read the full checklist
              </Link>
            </Meta>
          </div>
        </section>

        {/* ── 03 The subject nobody has written ──────────────────────────── */}
        {/*
         * The band that answers the headline's boldest word, and it sits after
         * the example rather than before it. "Here is what marking means" is
         * the argument; "and it applies to any subject you ask for" is the
         * scope of the argument. Scope after substance.
         *
         * Half its length went in this cut. The honest half — §7.1's "depth is
         * declared, not faked" — was four paragraphs and had become the longest
         * thing on the page, which is not the same as being the clearest. Same
         * two limits, two sentences.
         */}
        <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-16">
          <SectionHead
            step="03"
            label="Any subject"
            title="If nobody has written yours, we write it"
            icon={<PenIcon />}
          />

          <Card className="settle flex flex-col gap-8 p-7 sm:p-9">
            <Lead>
              Ask for something we don&rsquo;t cover and it gets written to
              order. It takes about three minutes, and what comes out is a
              subject like any other here.
            </Lead>

            <ul className="grid list-none grid-cols-1 gap-x-8 gap-y-6 p-0 m-0 sm:grid-cols-3">
              {WRITTEN.map((piece, i) => (
                <li
                  key={piece.name}
                  className="reveal flex flex-col gap-2 border-t border-hairline pt-4"
                  style={revealAt(i)}
                >
                  <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                    {piece.name}
                  </span>
                  <Meta>{piece.body}</Meta>
                </li>
              ))}
            </ul>

            {/*
             * The half of the offer that costs us something to say, and the
             * reason the band is worth its space. Both limits a built subject
             * carries, beside the badge that carries them, in the space the
             * four paragraphs used to take.
             */}
            <div className="flex flex-col gap-3 border-t border-hairline pt-6">
              <MaturityBadge maturity="generated" />
              {/* Held to the reading measure by hand: the card is the full page
                  width, and `Meta` — unlike `Lead` — carries no measure of its
                  own, so a paragraph in here runs to 110 characters. */}
              <Meta className="max-w-[var(--measure)]">
                That is what it is called until a person has read it, and we
                check it before you see it — if it comes out thin, we stop and
                tell you rather than hand it over. It also can&rsquo;t claim the
                strongest kind of marking, because running your work and
                checking the answer needs a marker somebody wrote by hand.
              </Meta>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-hairline pt-6">
              <Link
                href="/start"
                className="min-h-[var(--touch-min)] inline-flex items-center rounded-[var(--radius-control)] bg-accent px-5 font-[550] text-on-accent transition-opacity duration-[var(--dur-fast)] hover:opacity-90"
              >
                Have one built
              </Link>
              <Meta>
                A few questions about what you want to do with it, then it
                starts writing.
              </Meta>
            </div>
          </Card>
        </section>

        {/* ── 04 What is already here ────────────────────────────────────── */}
        {/*
         * One band where there were two.
         *
         * The old 04 drew a card per category whose only link was `/learn` —
         * five cards, one destination, no subject named. The old 05 drew the
         * three hand-written subjects under a claim only they could carry, and
         * because it was the one band that listed anything, a reader counted it
         * and concluded the site had three subjects. That is the same failure
         * the page had already been restructured twice to fix.
         *
         * A row list fixes both at once: it names every category *and* every
         * subject in it, it survives a catalogue of sixty without becoming a
         * wall, and it never leaves a two-thirds-empty grid row when a branch
         * holds one subject — which the card grid did for three of five.
         */}
        <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-16">
          <SectionHead
            step="04"
            label="What's here"
            /* No count of categories in the heading. "in three kinds" lasted
               exactly as long as it took to add a fourth. The rows below are
               the breadth signal; the reader counts them. */
            title={`${topics.length} subjects, grouped by kind`}
            icon={<GridIcon />}
          />

          <Card className="flex flex-col p-0">
            {categories.map(({ category, topics: inGroup }, i) => (
              <div
                key={category.slug}
                className="reveal grid gap-x-10 gap-y-4 border-b border-hairline p-6 last:border-b-0 sm:p-7 lg:grid-cols-[minmax(0,7fr)_minmax(0,10fr)]"
                style={revealAt(i)}
              >
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                    {category.name}
                  </h3>
                  <Meta>{category.blurb}</Meta>
                </div>

                <ul className="m-0 flex list-none flex-col p-0">
                  {inGroup.map((topic) => (
                    <li key={topic.slug}>
                      <Link
                        href={`/learn/${topic.slug}`}
                        className="group flex min-h-[var(--touch-min)] flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-hairline py-3 last:border-b-0"
                      >
                        <span className="text-[length:var(--text-label-size)] font-[650] text-ink transition-colors duration-[var(--dur-fast)] group-hover:text-accent">
                          {topic.name}
                        </span>
                        <Meta>
                          {topic.skillCount} skills · about {topic.totalHours}{" "}
                          hours
                        </Meta>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>

          {/*
           * The closing line, and the one place the page names both kinds of
           * subject. It replaces a whole band that existed to make the same
           * point — and unlike that band, it cannot be misread as a count of
           * everything on offer.
           */}
          <Meta className="reveal max-w-[var(--measure)]">
            Some of these were written and checked by hand; the rest are written
            when someone asks. Every subject says which it is, and what marking
            it can honestly do.{" "}
            <Link href="/learn" className={INLINE_LINK}>
              See all {topics.length}
            </Link>
            , or{" "}
            <Link href="/start" className={INLINE_LINK}>
              ask for a subject
            </Link>{" "}
            that isn&rsquo;t here.
          </Meta>
        </section>
      </main>
    </>
  );
}
