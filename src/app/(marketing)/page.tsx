import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  type Faq,
  FaqList,
  GoalSearch,
  JsonLdScript,
  RubricLadder,
  SectionHead,
  CARD_TITLE,
} from "@/components/marketing";
import {
  ArrowIcon,
  ChecklistIcon,
  GridIcon,
  PriceIcon,
  QuestionIcon,
  TickIcon,
} from "@/components/icons";
import {
  ButtonLink,
  Card,
  cx,
  HeroTitle,
  Lead,
  LinkCard,
  MaturityBadge,
  Meta,
  revealAt,
  stagger,
  Status,
  Title,
} from "@/components/ui";
import { allProjects, allTopics, featuredProject } from "@/lib/content";
import { LISTED_PLAN_IDS } from "@/lib/billing/catalog";
import { PLAN_COPY } from "@/lib/billing/plan-copy";
import {
  annualSavingPercent,
  CURRENCY_COOKIE,
  formatMoney,
  requirePrice,
  resolveCurrency,
} from "@/lib/billing/prices";
import {
  MAX_GENERATED_SKILLS,
  MIN_GENERATED_ITEMS,
  MIN_GENERATED_SKILLS,
  MIN_ITEMS_PER_SKILL,
} from "@/lib/contracts/pack";
import { faqPage, organisation, priceOffers, website } from "@/lib/seo/jsonld";
import { groupByCategory } from "@/lib/content/categories";
import { handInLabel } from "@/lib/content/evidence";
import { marketingMetadata } from "@/lib/seo/metadata";
import { supportAddress } from "@/lib/site";

/**
 * §8 screen 1 — the landing page.
 *
 * Eleventh cut, and the second measured on a phone. The ninth added what the
 * page was missing — a price, an answer to the objection, an ask — and reached
 * six numbered bands and 13.9 phone screens. The tenth merged two bands and
 * tightened everything to 11.0. This one takes it to four bands and about nine.
 *
 * §8.5.7's licence is "Long is fine; *dense* is not", and that is a rule about
 * a page you scroll past, not one you scroll *through*. Fourteen screens is not
 * depth; it is a reader deciding around screen five that this will take all day.
 *
 * The cuts, across both passes, in order of what they bought:
 *
 * 1. **Two bands became one.** "If nobody has written yours, we write it" and
 *    "N subjects, grouped by kind" answered different questions and nobody read
 *    them as different questions — they were the catalogue, and then a card
 *    1,300px later explaining that the catalogue is not the limit. The offer is
 *    the last row of the catalogue card now, on the accent field, closing the
 *    list instead of joining it.
 * 2. **`How it works` went to the fold.** Five steps with a line of explanation
 *    each was the most restated content here: step 1 is the search box above
 *    it, steps 4 and 5 are the marking band entire, steps 2 and 3 are answered
 *    at length in the questions. The sequence survives as five names across the
 *    hero's closing rule — where it also replaced three abstract promises
 *    saying the same things without the order.
 * 3. **The hero's specimen is desktop-only.** It is the marking band's argument
 *    in compressed form, and below `lg` there is no second column for it to
 *    fill, so it became 500px of content the reader meets again in full.
 * 4. **The price cards carry two quantities, not three, and no pitch.** Graded
 *    work and sessions are what *bound* a plan; tutor turns are a limit inside
 *    a session, and the pitch is a sentence of voice. Both belong on the page
 *    that is asking for the sale, one tap away.
 * 5. **Padding, everywhere, under `sm` only.**
 *
 * What survived every cut, because it is what makes the page honest: the
 * published rubric with its four rungs, §7.1's two limits on a built subject
 * (Experimental until read, and no claim to the strongest marking), Free's
 * session cap, every subject linked by name, and every price and quota read
 * rather than typed.
 *
 * - **01 · What marking looks like.** The pinned band, and the one place the
 *   page stops.
 * - **02 · Subjects.** The catalogue, ending in the offer to write what is not
 *   in it.
 * - **03 · What it costs.** Every figure read from `prices.ts` and every quota
 *   from `PLAN_COPY`, exactly as `/pricing` does, in the currency the same
 *   cookie decides. A landing page that quotes a price it typed by hand is one
 *   edit away from advertising an amount we do not charge — which is why this
 *   file reads the cookie and is async.
 * - **04 · Questions.** Five objections, in `<details>`, with `FAQPage` markup
 *   drawn from the same array. The sharpest is first and it is the one we would
 *   rather not be asked.
 * - **The close.** Not a numbered band: no eyebrow, no rule, one thing to do.
 *
 * Each band still has a shape of its own — a pinned two-pane card, a row list,
 * a price grid, a disclosure list, a close — so the page never reads as one
 * shape repeated until it runs out.
 *
 * **On filled buttons.** §8.5.5 allows one per *screen*. Three carry a fill —
 * the hero's submit, the catalogue's "Have one built", and the close — and no
 * two are ever in the same viewport. Everything else, the price cards included,
 * is a link or a text button.
 *
 * §13.1 — revalidated daily; the cookie reads make it per-request in practice,
 * as they already do for every route under `(marketing)/layout`.
 */
export const revalidate = 86_400;

export const metadata: Metadata = marketingMetadata({
  title: "Learn anything — and prove you actually learned it",
  // §13.3's metadata rule — title ≤60 characters, description 140–160, so
  // neither is cut mid-promise in a result. Both halves of the offer have to
  // survive the truncation, which is what decides the wording here.
  description:
    "Ask for any subject. If nobody has written it, we write it in a few minutes — then your work is marked against a checklist you read first.",
  path: "/",
  social: {
    description:
      "There is no catalogue. Ask for a subject nobody has written and we write it — the skills, the questions, and the checklist your work is marked against.",
  },
});

/**
 * What happens, in order, on the fold — and the band that used to say it.
 *
 * `01 · How it works` was five steps with a line of explanation each, and it
 * was the most restated content on the page: step 1 is the search box directly
 * above it, step 4 and step 5 are the whole of the marking band, and steps 2
 * and 3 are answered at length by "How much time does this take?" in the
 * questions. A reader met each of those points twice, once as a promise and
 * once as the thing itself.
 *
 * So the band is gone and the sequence moved up to the fold, names only. It
 * replaces the three promises that sat there — which were the same three
 * points again, stated abstractly ("You hand in real work, not a quiz" against
 * "Do a real piece of work"). A visitor who reads nothing else now knows the
 * shape of the thing rather than three of its adjectives, and it costs five
 * lines instead of a screen and an eighth.
 *
 * Names only, because the explanation is what made it a band. If a step needs a
 * sentence to be legible, the step is wrong.
 */
const STEPS = [
  "Say what you want to learn",
  "Take a ten-minute check",
  "Get a plan that skips what you know",
  "Do a real piece of work",
  "Get it marked, with the evidence",
];

/**
 * The plans this page draws a column for — every listed one except the trial.
 *
 * The trial is not a plan and the billing code has never treated it as one:
 * `checkoutBody` puts the **Pro** price on the line item, `trial_period_days`
 * holds the charge off, and the fee rides the first invoice as a one-off. Given
 * a column of its own it asks a visitor to compare four days against three
 * monthly rates, so it gets the strip under the grid instead — where the price
 * it renews at can sit in the same breath as the price it starts at (§13 risk
 * 3: an unexpected renewal is a chargeback, not revenue).
 */
const PRICED_PLANS = LISTED_PLAN_IDS.filter((id) => id !== "trial");

/**
 * Where a price card goes, and what its last line says.
 *
 * Free is the only one that can be acted on from here — there is nothing to
 * charge, so it goes straight to sign-up. The other two go to `/pricing`, and
 * their labels say so: `PLAN_COPY`'s own CTAs are "Choose Learner" and "Choose
 * Pro", which would be a lie on a card that opens a price list rather than a
 * checkout.
 */
const PLAN_ROUTE: Record<string, { href: string; cta: string }> = {
  free: { href: "/sign-up", cta: "Start free" },
  learner: { href: "/pricing", cta: "See Learner" },
  pro: { href: "/pricing", cta: "See Pro" },
};

/** The one link style used in running text on this page. */
const INLINE_LINK =
  "font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent";

/** The eyebrow over a block that is not a numbered band. */
const EYEBROW =
  "text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-ink-faint";

/**
 * The five things a stranger actually wants to know, in the order they occur to
 * them — and the first is the one we would rather not be asked.
 *
 * A function rather than a constant because three of the answers quote numbers
 * the page has no business typing: how long the subjects here run, and what the
 * free plan includes. Same rule as the price cards. `/pricing` answers the
 * billing questions — what happens when the trial ends, how to cancel, how to
 * switch currency — and none of those are repeated here.
 */
function faqs(input: {
  shortestHours: number;
  longestHours: number;
  freeMarking: string;
}): Faq[] {
  return [
    {
      question: "Is this just a chatbot with a syllabus on top?",
      answer:
        "The material is written by a model, and every subject says so. What is different is what happens to your work: you hand in something you actually made, it is marked against a checklist that was published before you started, and every judgement quotes the part of your work it came from. You can read a complete checklist on this site right now, without an account.",
    },
    {
      question: "Can I trust the marking?",
      answer:
        "You can check it, which is worth more than trusting it. Every score names the criterion, the band it landed in, and the words of yours it came from — so a verdict you disagree with is one you can argue with. Each subject also states up front what its marking can honestly settle: for some kinds of work we can only check the technical side, and whether the result is any good is your call. That is on the page before you start, not after you are disappointed.",
    },
    /*
     * Not "what if you don't cover my subject" — band 03 is four hundred
     * pixels up and answers that at length, with the same two numbers and the
     * same sentence about stopping when a build comes out thin. An FAQ that
     * restates the band above it teaches a reader that the section is padding
     * and to skip the rest of it.
     *
     * This is the question nothing else on the page answers. Band 02 shows one
     * brief's `evidenceType` in a metadata row and never says what the general
     * case is, so "real work, not a quiz" is a promise the page makes three
     * times and never once cashes.
     */
    {
      question: "What do I actually hand in?",
      answer: `Something you made — a piece of writing, a query and the plan it produced, a photograph, a spreadsheet. Every brief names which of those it wants, roughly how long it should take, and the checklist it will be marked against, all before you start. The ten-minute check that finds your level asks you questions; the work that counts as proof never does.`,
    },
    {
      question: "How much time does this take?",
      answer: `The check that finds your level takes about ten minutes and needs no account. A subject here runs between ${input.shortestHours} and ${input.longestHours} hours end to end, and your plan skips whatever the check proved you can already do — so what you work through is shorter than what is on the page, and it tells you what it skipped.`,
    },
    {
      question: "Do I have to pay to find out whether it works?",
      answer: `No. The ten-minute check on any subject we already cover is free and anonymous. The free plan then includes ${input.freeMarking}, which is enough to hand in a real piece of work and see exactly how it gets marked. Paying buys more marked work — not a different product.`,
    },
  ];
}

export default async function HomePage() {
  const topics = allTopics();
  const projects = allProjects();
  const featured = featuredProject();
  // Band 04's shape. A new pack changes this page by existing, rather than by
  // anyone remembering to come back here and add it — which is the failure that
  // made the page claim a three-subject site twice.
  const categories = groupByCategory(topics);

  /*
   * The same cookie `/pricing` reads, resolved the same way, so the two pages
   * cannot show a visitor two different currencies. There is no switcher here —
   * one lives on the price list, and a second control for the same setting on
   * the page whose job is to get somebody *to* the price list is clutter.
   */
  const jar = await cookies();
  const currency = resolveCurrency(undefined, jar.get(CURRENCY_COOKIE)?.value);

  /** Free has no Stripe product, so it has no row in the price table. */
  const monthlyCents = (planId: (typeof PRICED_PLANS)[number]) =>
    planId === "free"
      ? 0
      : requirePrice(planId as "learner" | "pro", "month", currency)
          .amountCents;

  const trialCents = requirePrice("trial", "month", currency).amountCents;
  const proCents = monthlyCents("pro");
  // Named per plan since Learner started selling a year too: the sentence below
  // says "Pro is N% cheaper", so it has to be Pro's discount and not the
  // smaller one the price list's switch quotes over both cards.
  const saving = annualSavingPercent("pro", currency);

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

  const hours = topics.map((t) => t.totalHours);
  const questions = faqs({
    shortestHours: Math.min(...hours),
    longestHours: Math.max(...hours),
    // Read, never typed: `PLAN_COPY` builds this line off the catalog's own
    // quota, and it is the first feature on every card because the three
    // quantities lead in the same order on all of them.
    freeMarking: PLAN_COPY.free.features[0]!,
  });

  return (
    <>
      <JsonLdScript
        blocks={[
          organisation(),
          website(),
          /*
           * Marked up because the page renders them, and only the ones it
           * renders — the annual price is named as a saving here rather than as
           * an amount, so it is not in this list. `/pricing` carries the full
           * offer graph including the year.
           */
          priceOffers({
            name: "MeritKeep",
            description:
              "Learn any subject and hand in real work, marked against a checklist published before you start.",
            path: "/",
            currency,
            amountsCents: [trialCents, monthlyCents("learner"), proCents],
          }),
          faqPage(questions),
        ]}
      />

      <main>
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        {/*
         * Two columns on a field, because one on flat ground was the problem.
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
         *
         * `aurora` is the wash behind it (globals.css) and it is the only
         * atmospheric fill on the site: two soft radials of `--accent-weak`
         * that drift against the scroll, so the page opens on a field rather
         * than on the same flat ground as everything under it.
         */}
        <section className="aurora recede mx-auto max-w-5xl px-6 pt-10 pb-12 sm:pt-20 sm:pb-16">
          <div className="grid grid-cols-1 items-center gap-x-12 gap-y-10 sm:gap-y-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="flex flex-col items-start gap-6 sm:gap-7">
              {/*
               * The counts, above the headline.
               *
               * Not a badge and not a slogan: it is the one thing a stranger
               * cannot tell from a headline promising "anything", which is
               * whether there is anything here at all. Both numbers are counted
               * from the packs at render, so the chip cannot outlive the
               * catalogue it describes — and neither is a vanity figure about
               * users, which we would have to make up.
               */}
              <span className="rise inline-flex rounded-[var(--radius-pill)] bg-surface px-4 py-2 shadow-[var(--shadow-raised)]">
                <Status tone="verified">
                  {topics.length} subjects · {projects.length} graded briefs
                </Status>
              </span>

              {/* No measure of its own — the column is the measure now, and a
                  `max-w` on top of it only ever fights the grid. `text-balance`
                  on `HeroTitle` evens the lines out. */}
              <HeroTitle className="rise" style={stagger(1)}>
                Learn anything. Then prove you actually learned it.
              </HeroTitle>

              <Lead className="rise" style={stagger(2)}>
                Type any subject. If nobody has written it yet, we write it —
                the skills, the questions that find your level, and the
                checklist your work gets marked against.
              </Lead>

              {/*
               * `relative z-10` is what keeps the search's dropdown on top,
               * and it is not decoration.
               *
               * `.rise` animates a transform, and an element with a transform
               * animation is a stacking context — so the panel's own `z-20`
               * only orders it *inside this div*. Against the steps rail and
               * the specimen card, both of which are `.rise`/`.drift` and both
               * of which come later in the DOM, it lost on document order: the
               * suggestions rendered underneath them, with "Say what you want
               * to learn" printed straight through the middle of the list.
               *
               * Lifting the wrapper — not the panel — is the fix, because the
               * wrapper is the context that actually competes.
               */}
              <div
                className="rise relative z-10 flex w-full flex-col gap-3"
                style={stagger(3)}
              >
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
             *
             * **Desktop only, and that is a content decision rather than a
             * layout one.** This card is band 02's argument in compressed form:
             * the same brief, the same criteria, the same weights. On a wide
             * viewport it earns its space by filling the column beside the
             * headline — without it the fold is a search box and forty per cent
             * white. Below `lg` there is no column to fill, so it stops being a
             * specimen and becomes 500px of the same content the reader meets
             * again, in full, one band later. A phone gets it once.
             */}
            <div
              className="drift hidden lg:block"
              style={{ "--drift": "56px" } as CSSProperties}
            >
              <Card className="rise flex flex-col gap-5 p-7" style={stagger(3)}>
                <span className={EYEBROW}>What your work is marked on</span>
                <span className={CARD_TITLE}>{featured.title}</span>

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
           * The whole sequence across the fold's closing rule, in place of the
           * band that used to carry it. A numbered `<ol>` rather than a row of
           * accent dots, because the order is the content — "check, then plan,
           * then work, then marked" is the product, and three unordered claims
           * were the same thing with the shape taken out.
           *
           * One line each. At `lg` it reads as one rail across the page; below
           * that it stacks into five short rows, which is 180px for the answer
           * to "what actually happens", where the band cost 885.
           */}
          <ol
            className="rise m-0 mt-10 grid list-none grid-cols-1 gap-x-6 gap-y-3 border-t border-hairline p-0 pt-6 sm:mt-12 sm:grid-cols-3 lg:grid-cols-5"
            style={stagger(4)}
          >
            {STEPS.map((step, i) => (
              <li key={step} className="flex items-baseline gap-2.5">
                {/* Decorative: the list is already ordered, so a screen reader
                    numbers it without our help, and reading "1 1 Say what you
                    want to learn" is the sort of thing this chip causes. */}
                <span
                  aria-hidden="true"
                  className="flex size-5 shrink-0 translate-y-0.5 items-center justify-center rounded-[var(--radius-pill)] bg-accent-weak text-[length:var(--text-meta-size)] font-[650] text-accent"
                >
                  {i + 1}
                </span>
                <span className="text-[length:var(--text-label-size)] leading-[var(--text-body-line)] text-ink">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── 01 A real task and its marking scheme ──────────────────────── */}
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
          <div className="pin-stage mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10 sm:gap-8 sm:py-16">
            <SectionHead
              step="01"
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
              <div className="flex flex-col gap-5 border-b border-hairline p-5 sm:p-7 lg:border-r lg:border-b-0">
                <span className={EYEBROW}>The task</span>
                <span className={CARD_TITLE}>{featured.title}</span>
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
                  <Meta>Hand in: {handInLabel(featured.evidence)}</Meta>
                </span>
              </div>

              {/* How it is marked */}
              <div className="flex flex-col gap-6 p-5 sm:p-7">
                <span className={EYEBROW}>How it is marked</span>

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

        {/* ── 02 Subjects ────────────────────────────────────────────────── */}
        {/*
         * One band where there were two, and the merge is the single biggest
         * cut in this pass.
         *
         * They were separate because they answer different questions — "what is
         * already written" and "what if mine isn't" — but a reader does not
         * experience them as different questions. They experience a list of
         * subjects, and then, thirteen hundred pixels later on a phone, a card
         * explaining that the list is not the limit. Both bands opened with a
         * numbered head and a rule; both closed with a paragraph about which
         * kind of subject is which; between them they cost 3.4 phone screens to
         * make one point.
         *
         * The point is one point, so it is one band: the catalogue, and then
         * "and anything else you ask for" as the last row of the same card, on
         * the accent field so it reads as the end of the list rather than as
         * another item in it. §7.1's two limits survive intact — a built
         * subject is Experimental until somebody reads it, and it cannot claim
         * the strongest kind of marking — because those are the half of the
         * offer that costs us something to say, and dropping them to save space
         * would be the one cut this page is not allowed to make.
         */}
        <section className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10 sm:gap-10 sm:py-16">
          <SectionHead
            step="02"
            label="Subjects"
            /* Both halves of the band in one line, and no count of categories:
               "in three kinds" lasted exactly as long as it took to add a
               fourth. The rows below are the breadth signal. */
            title={`${topics.length} subjects, and anything else you ask for`}
            icon={<GridIcon />}
          />

          {/* `overflow-hidden` because the last row is a fill rather than
              content on the card's own surface — without it the accent block
              keeps its square corners inside the card's rounded ones. */}
          <Card className="flex flex-col overflow-hidden p-0">
            {categories.map(({ category, topics: inGroup }, i) => (
              <div
                key={category.slug}
                className="reveal grid gap-x-10 gap-y-3 border-b border-hairline p-5 sm:gap-y-4 sm:p-7 lg:grid-cols-[minmax(0,7fr)_minmax(0,10fr)]"
                style={revealAt(i)}
              >
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                    {category.name}
                  </h3>
                  {/* The blurb is orientation for a reader scanning a wide
                      page. On a phone the category name sits directly above its
                      own subjects with nothing between them, so it orients
                      nobody and costs two lines per category. */}
                  <Meta className="hidden sm:block">{category.blurb}</Meta>
                </div>

                <ul className="m-0 flex list-none flex-col p-0">
                  {inGroup.map((topic) => (
                    <li key={topic.slug}>
                      <Link
                        href={`/learn/${topic.slug}`}
                        className="group flex min-h-[var(--touch-min)] flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-hairline py-2.5 last:border-b-0 sm:py-3"
                      >
                        <span className="text-[length:var(--text-label-size)] font-[650] text-ink transition-colors duration-[var(--dur-fast)] group-hover:text-accent">
                          {topic.name}
                        </span>
                        {/* Choosing information, and nobody chooses a subject
                            here — they choose on `/learn`, where it is on every
                            card. At 390px it wraps to a second line under every
                            subject and turns a list you scan into a list you
                            read. */}
                        <Meta className="hidden sm:block">
                          {topic.skillCount} skills · about {topic.totalHours}{" "}
                          hours
                        </Meta>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {/*
             * The offer, as the last row of the catalogue rather than as a band
             * of its own — which is exactly what it is: the row after the last
             * subject. On the accent field so it closes the list instead of
             * joining it, which also means every `Meta` in here steps up to
             * `muted` (§8.5.4 — `--ink-faint` measures 4.15:1 on that fill).
             *
             * The generator's floor is one sentence now instead of a
             * three-column grid of headed items. Every figure still comes from
             * `contracts/pack` rather than the copy, which is the part that
             * matters: a promise this specific stays true only while nobody can
             * edit it without editing the contract.
             */}
            <div className="reveal flex flex-col gap-4 bg-accent-weak p-5 sm:p-7">
              <div className="flex flex-col gap-1.5">
                <h3 className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                  Anything else
                </h3>
                <Meta tone="muted">
                  Ask for a subject nobody has written and it gets written to
                  order in a few minutes: {MIN_GENERATED_SKILLS} to{" "}
                  {MAX_GENERATED_SKILLS} skills in the order they depend on each
                  other, at least {MIN_ITEMS_PER_SKILL} questions per skill and{" "}
                  {MIN_GENERATED_ITEMS} in all, and a real task with the
                  checklist it will be marked against.
                </Meta>
              </div>

              <div className="flex flex-col gap-2 border-t border-accent/20 pt-4">
                <MaturityBadge maturity="generated" />
                <Meta tone="muted" className="max-w-[var(--measure)]">
                  That is what it is called until a person has read it — and if
                  it comes out thin we stop and tell you rather than hand it
                  over. It also can&rsquo;t claim the strongest kind of marking,
                  which needs a marker somebody wrote by hand.
                </Meta>
              </div>

              <ButtonLink href="/start" className="mt-1">
                Have one built
              </ButtonLink>
            </div>
          </Card>

          {/*
           * The one place the page names both kinds of subject. It is the
           * survivor of two closing paragraphs that said overlapping things.
           */}
          <Meta className="reveal max-w-[var(--measure)]">
            Some of these were written and checked by hand; the rest are written
            when someone asks. Every subject says which it is.{" "}
            <Link href="/learn" className={INLINE_LINK}>
              See all {topics.length}
            </Link>
            .
          </Meta>
        </section>

        {/* ── 03 What it costs ───────────────────────────────────────────── */}
        {/*
         * A price grid, which is a shape this page does not otherwise use, and
         * the first band whose figures come from outside `content/`.
         *
         * Every one of them is read: the amounts from `prices.ts` in the
         * currency the cookie resolved, the quotas from `PLAN_COPY`, the annual
         * discount computed and rounded down. A landing page is an even easier
         * place than a price list to tell a lie by accident, because nobody
         * thinks of it as the place the prices live — so nothing here is typed.
         *
         * Whole cards are the link rather than a button per card. Three buttons
         * in a row is three primary actions, and the choice a visitor is making
         * here is which *card* they want, not which button.
         */}
        <section className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10 sm:gap-10 sm:py-16">
          <SectionHead
            step="03"
            label="What it costs"
            title={`Free to start, ${formatMoney(trialCents, currency)} to try everything`}
            icon={<PriceIcon />}
          />

          <div className="grid gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3">
            {PRICED_PLANS.map((planId, i) => {
              const copy = PLAN_COPY[planId];
              const route = PLAN_ROUTE[planId]!;
              const cents = monthlyCents(planId);
              // Pro is the one with the offer on it, which is what earns it the
              // border. Emphasis follows the product decision rather than a
              // guess about which card sells best.
              const offered = planId === "pro";

              return (
                <LinkCard
                  key={planId}
                  href={route.href}
                  style={revealAt(i)}
                  /*
                   * The border is on every card and only its colour changes.
                   * Put it on the emphasised one alone and that card's content
                   * sits 2px lower than the others — `border-box` takes the 2px
                   * out of the padding — which is a misalignment a reader feels
                   * without being able to name.
                   */
                  className={cx(
                    "reveal group gap-4 border-2 p-5 sm:gap-5 sm:p-6",
                    offered ? "border-accent" : "border-transparent",
                  )}
                >
                  <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className={CARD_TITLE}>{copy.name}</span>
                    {offered ? (
                      <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
                        Everything
                      </span>
                    ) : null}
                  </span>

                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[length:var(--text-display-size)] font-[650] leading-[var(--text-display-line)] tracking-[var(--text-display-tracking)] text-ink tabular-nums">
                      {formatMoney(cents, currency)}
                    </span>
                    <Meta>{planId === "free" ? "forever" : "a month"}</Meta>
                  </span>

                  {/*
                   * Two lines, not three, and no pitch above them.
                   *
                   * `plan-copy.ts` guarantees the first two features are the
                   * same two quantities in the same order on every card —
                   * graded work, then sessions — and those are the two that
                   * *bound* a plan. The third (tutor questions in a session) is
                   * a limit inside a session rather than a size of plan, and
                   * `copy.pitch` is a sentence of voice; both belong on the page
                   * that is asking for the sale, which is one tap away.
                   *
                   * Free's session cap stays visible, which is the part that
                   * matters: `plan-copy.ts` is explicit that a learner who finds
                   * out on their third session that free stops at two has been
                   * misled by a list that mentioned only what was included.
                   */}
                  <ul className="m-0 flex list-none flex-col gap-2.5 border-t border-hairline p-0 pt-4">
                    {copy.features.slice(0, 2).map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <TickIcon className="mt-px size-4 shrink-0 text-accent" />
                        <Meta>{feature}</Meta>
                      </li>
                    ))}
                  </ul>

                  <span className="mt-auto flex items-center gap-2 border-t border-hairline pt-4 text-[length:var(--text-label-size)] font-[550] text-accent">
                    {route.cta}
                    <ArrowIcon className="size-4 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] group-hover:translate-x-0.5" />
                  </span>
                </LinkCard>
              );
            })}
          </div>

          {/*
           * The trial, and the renewal in the same breath.
           *
           * §13 risk 3 makes an unexpected renewal the trial's main danger, and
           * the defence is not burying the fee — it is never letting the fee
           * appear without the price it turns into. So both amounts are in one
           * sentence, and the strip that carries them is the last thing in the
           * band rather than a fourth column asking a visitor to compare four
           * days against three monthly rates.
           */}
          <div className="reveal flex flex-col gap-4 rounded-[var(--radius-card)] bg-accent-weak px-5 py-5 sm:flex-row sm:px-6 sm:py-6 sm:items-center sm:justify-between sm:gap-8">
            <div className="flex flex-col gap-1.5">
              <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                Try Pro for {formatMoney(trialCents, currency)}
              </span>
              {/*
                Two words in here are load-bearing and were missing from the
                first draft: *automatically* and *until you cancel*. §13 risk 3
                is not about the amount — it is about a charge somebody did not
                know was coming, and a summary that says "then $27.99 a month"
                leaves a reader free to assume it asks first. `TRIAL_TERMS` on
                the price list is the full statement and is not restated here;
                this is the short form, and the short form still has to carry
                the part a chargeback would be argued over.
              */}
              <Meta tone="muted">
                Four days of everything. It then renews automatically at{" "}
                {formatMoney(proCents, currency)} a month until you cancel —
                stop it before day four and pay nothing more.
              </Meta>
            </div>
            <Link
              href="/pricing"
              className="inline-flex shrink-0 items-center gap-2 text-[length:var(--text-label-size)] font-[550] text-accent"
            >
              See the full price list
              <ArrowIcon className="size-4" />
            </Link>
          </div>

          {/* The annual mention links to the annual *view* rather than to the
              top of the price list, because `/pricing` has a monthly/yearly
              switch and landing on the wrong side of it makes the reader hunt
              for the number this sentence just quoted at them. */}
          <Meta className="reveal">
            Prices in {currency.toUpperCase()}, switchable on the price list.{" "}
            <Link href="/pricing?interval=year" className={INLINE_LINK}>
              Pay for a year
            </Link>{" "}
            instead and Pro is {saving}% cheaper.
          </Meta>
        </section>

        {/* ── 04 Questions ───────────────────────────────────────────────── */}
        {/*
         * The objections, and the first one is the one we would rather not be
         * asked. A page that answers the easy questions and leaves the hard one
         * standing has not answered anything — a reader who walked all the way
         * down here is not wondering how long it takes, they are wondering
         * whether any of it is real.
         *
         * `FaqList` is shared with `/pricing` and draws the same array the
         * `FAQPage` markup above is built from, so a question can never reach
         * the markup without being visible on the page.
         */}
        <section className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10 sm:gap-8 sm:py-16">
          <SectionHead
            step="04"
            label="Questions"
            title="The things people ask first"
            icon={<QuestionIcon />}
          />

          <FaqList faqs={questions} />

          <Meta>
            Billing questions — cancelling, switching plan, what happens when
            the trial ends — are answered on the{" "}
            <Link href="/pricing" className={INLINE_LINK}>
              price list
            </Link>
            . Anything else,{" "}
            <a href={`mailto:${supportAddress()}`} className={INLINE_LINK}>
              {supportAddress()}
            </a>
            .
          </Meta>
        </section>

        {/* ── The close ──────────────────────────────────────────────────── */}
        {/*
         * The page used to end on a caption under a list of subjects, which is
         * a page that stops rather than a page that closes. This is the ask,
         * and it is deliberately not a sixth numbered band: no eyebrow, no
         * rule, one surface, one thing to do.
         *
         * It asks for a *capability* rather than a subject, because that is the
         * question the intake actually opens with and the one that produces a
         * usable path — "write a launch email that gets replies" plans, "learn
         * marketing" does not.
         */}
        {/* `pb-8`, not the band rhythm's `pb-16`: `SiteFooter` already opens on
            `mt-24`, and the two together left a screenful of nothing between
            the last thing to press and the first thing under it. */}
        <section className="mx-auto max-w-5xl px-6 pt-2 pb-8 sm:pt-4">
          <Card className="settle flex flex-col items-start gap-5 p-6 sm:gap-6 sm:p-10">
            <Title className="text-[length:var(--text-display-size)] leading-[var(--text-display-line)] tracking-[var(--text-display-tracking)] text-balance">
              Pick one thing you want to be able to do
            </Title>
            <Lead>
              Not a subject — a thing. Write a launch email that gets replies.
              Work out why a query is slow. We build the path that gets you
              there, and mark the work that proves you arrived.
            </Lead>

            {/*
              `w-full` here, not just on the buttons. §8.5.5 wants a filled
              button full-width on mobile and `buttonClass` asks for exactly
              that — but this card is `items-start`, so the row shrank to its
              content and `w-full` resolved to *that*, leaving a 160px pill
              floating in a 390px card with the text button centred under it.
              The row has to claim the width before the button can fill it.
            */}
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
              <ButtonLink href="/sign-up">Start free</ButtonLink>
              <ButtonLink href="/start" variant="text">
                Have a subject built
              </ButtonLink>
            </div>

            <Meta className="border-t border-hairline pt-6">
              The ten-minute check needs no account. Nothing counts as proof
              until your work has been marked.
            </Meta>
          </Card>
        </section>
      </main>
    </>
  );
}
