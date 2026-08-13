import type { Metadata } from "next";
import Link from "next/link";
import {
  Breadcrumbs,
  EvalTierNote,
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
  SubjectIcon,
} from "@/components/icons";
import {
  Card,
  HeroTitle,
  Lead,
  LinkCard,
  MaturityBadge,
  Meta,
  stagger,
} from "@/components/ui";
import { allTopics, featuredProject } from "@/lib/content";
import {
  MAX_GENERATED_SKILLS,
  MIN_GENERATED_ITEMS,
  MIN_GENERATED_SKILLS,
  MIN_ITEMS_PER_SKILL,
} from "@/lib/contracts/pack";
import { organisation, website } from "@/lib/seo/jsonld";
import { canonical } from "@/lib/site";

/**
 * §8 screen 1 — the landing page.
 *
 * Fourth cut. The third fixed the copy — one line per idea, never two
 * paragraphs in a row — and it worked, but it fixed only the copy. Every band
 * on the page was still 672px wide, on `--ground`, with a heading and a list
 * under it; the largest thing on screen was 40px; the accent appeared at 13px
 * in three eyebrows; and the cards were `--surface` on `--ground`, which is a
 * 2% value step and therefore invisible in light. Correct, and dull.
 *
 * So this cut is about *form*, and it changes three things:
 *
 * 1. **The page has a spine.** Three full-width bands alternating ground →
 *    accent field → ground, rather than one narrow column. The reader can feel
 *    where they are without reading.
 * 2. **The marking section shows the marking.** It used to render the strongest
 *    asset the product has — a published rubric — as `name … 35%`, which proves
 *    nothing. It now shows the band ladder: what Absent, Developing, Competent
 *    and Strong actually say, in the pack's own words. §4.2 law 2, legible.
 * 3. **Everything on it is real.** No mocked-up dashboard, no invented
 *    screenshot of a graded submission. Every string below comes out of a
 *    Domain Pack, for the reason §12 gives — a page cannot promise something
 *    the product does not actually do.
 *
 * §8.5.7 is the licence for the length: "Long is fine; *dense* is not." One
 * idea per scroll band, four bands, nothing stacked.
 *
 * Fifth cut, and it touches only words. The form was right and the sentences
 * were not: the headline was a riddle ("Anyone can teach you. Almost no one
 * checks whether you learned it."), and half the step bodies inverted or
 * qualified themselves rather than saying the thing. §8.5.1 asks for "plain
 * language everywhere", which is a rule about copy that had only ever been
 * enforced against layout. Every string below is now a plain sentence in the
 * order a reader would think it.
 *
 * Sixth cut, and it is about what the product now does. §7.1's Generated tier
 * shipped (§24 E7.5): a subject nobody has written gets written on request, in
 * about three minutes. The headline had already been changed to promise it —
 * "Learn anything" — and the page underneath still argued the opposite. Three
 * subject cards under "What you can learn today", and the offer to build a
 * fourth as a card at the very bottom, below the fold, phrased as an
 * exception ("Not one of those three?"). A reader who believed the page rather
 * than the headline came away thinking this was a three-subject site.
 *
 * So the build is now a band of its own, above the catalogue, and it is
 * specific rather than enthusiastic: what gets written, what is checked before
 * a learner sees it, and the two things a built subject is never allowed to
 * claim. The numbers in it are imported from the generator's own floor rather
 * than typed here, so the promise cannot drift away from the code that keeps
 * it — §12's rule that a page cannot promise what the product does not do,
 * enforced by the compiler instead of by memory.
 *
 * The three curated subjects keep their band and lose their billing: they are
 * no longer "what you can learn", they are the ones a person wrote by hand,
 * and their badge now says so beside the tier note.
 *
 * §13.1 — statically rendered, revalidated daily.
 */
export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "Learn anything — and prove you actually learned it",
  // §13.3's metadata rule — title ≤60 characters, description 140–160, so
  // neither is cut mid-promise in a result. Both halves of the offer have to
  // survive the truncation, which is what decides the wording here.
  description:
    "Ask for any subject. If nobody has written it, we write it in about three minutes — then your work is marked against a checklist you read first.",
  alternates: { canonical: canonical("/") },
  openGraph: {
    title: "Learn anything — and prove you actually learned it",
    description:
      "There is no catalogue. Ask for a subject nobody has written and we write it — the skills, the questions, and the checklist your work is marked against.",
    url: canonical("/"),
    type: "website",
  },
};

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

export default function HomePage() {
  const topics = allTopics();
  const featured = featuredProject();

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
        <section className="mx-auto flex max-w-5xl flex-col gap-8 px-6 pt-20 pb-24 sm:pt-28 sm:pb-32">
          {/* ~22ch resolves against the h1's own font size, so the headline
              breaks to three lines at desktop and wraps naturally on a phone. */}
          <HeroTitle className="rise max-w-[22ch]">
            Learn anything. Then prove you actually learned it.
          </HeroTitle>

          <Lead className="rise" style={stagger(1)}>
            Type any subject. If nobody has written it yet, we write it — the
            skills, the questions that find your level, and the checklist your
            work gets marked against.
          </Lead>

          <div className="rise flex flex-col gap-3" style={stagger(2)}>
            <GoalSearch suggestions={suggestions} autoFocus size="hero" />
            {/* Precise about *which* thing is free of an account: the check on
                a subject we have written is anonymous, and having one built for
                you is not. The line this replaced ("No account until you have
                seen your result") was true of the first and read as a promise
                about the second — which is the one a "learn anything" headline
                sends people towards. */}
            <Meta>Free to start. The ten-minute check needs no account.</Meta>
          </div>
        </section>

        {/* ── 01 How it works ────────────────────────────────────────────── */}
        <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 pb-24">
          <SectionHead
            step="01"
            label="How it works"
            title="Five steps"
            icon={<StepsIcon />}
          />

          {/*
           * A rail rather than a stack: at desktop the five steps read as one
           * sequence across the page, which is what makes it look like a
           * process instead of another bulleted list.
           */}
          <ol className="grid list-none grid-cols-1 gap-x-8 gap-y-10 p-0 m-0 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step, i) => (
              <li
                key={step.name}
                className="rise flex flex-col gap-3 border-t border-hairline pt-4"
                style={stagger(i)}
              >
                <span
                  aria-hidden="true"
                  className="text-[length:var(--text-title-size)] font-[650] leading-none tracking-[var(--text-title-tracking)] text-accent"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                  {step.name}
                </span>
                <Meta>{step.body}</Meta>
              </li>
            ))}
          </ol>
        </section>

        {/* ── 02 The subject nobody has written ──────────────────────────── */}
        {/*
         * The band that answers the headline's boldest word. It sits on
         * `--ground` in one card rather than on the accent field, because the
         * field belongs to 03: a reader meeting two full-bleed fills in a row
         * stops seeing either as emphasis.
         */}
        <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 pb-24">
          <SectionHead
            step="02"
            label="Any subject"
            title="If nobody has written yours, we write it"
            icon={<PenIcon />}
          />

          <Card className="rise flex flex-col gap-8 p-7 sm:p-9">
            <Lead>
              Ask for something we don&rsquo;t cover and it gets written to
              order. It takes about three minutes, and what comes out is a
              subject like any other here.
            </Lead>

            <ul className="grid list-none grid-cols-1 gap-x-8 gap-y-6 p-0 m-0 sm:grid-cols-3">
              {WRITTEN.map((piece) => (
                <li
                  key={piece.name}
                  className="flex flex-col gap-2 border-t border-hairline pt-4"
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
             * reason the band is worth its space: §7.1's "depth is declared,
             * not faked". A thin subject is refused rather than shipped, and
             * the two claims a built subject may never make are named here
             * rather than discovered later.
             */}
            <div className="flex flex-col gap-4 border-t border-hairline pt-6">
              <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                And what we won&rsquo;t do
              </span>
              {/* Held to the reading measure by hand: the card is the full
                  page width, and `Meta` — unlike `Lead` — carries no measure of
                  its own, so a paragraph in here runs to 110 characters. */}
              <Meta className="max-w-[var(--measure)]">
                We check it before you see it. If it comes out thin — too few
                questions, skills with nothing to ask about, no task anyone
                could mark — we stop and tell you, rather than hand it over.
              </Meta>
              <MaturityBadge maturity="generated" />
              <Meta className="max-w-[var(--measure)]">
                That is what a subject we built for you is called until a person
                has read it. It also can&rsquo;t claim the strongest kind of
                marking — running your work and checking the answer needs a
                marker somebody wrote by hand.
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

        {/* ── 03 A real task and its marking scheme ──────────────────────── */}
        {/*
         * The one full-bleed accent field on the site. §8.5.4 warns that large
         * saturated fills glare in dark — `--accent-weak` is a *tint* in light
         * and a near-black jade in dark, so it reads as a field in both without
         * either one shouting.
         */}
        <section className="bg-accent-weak">
          <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-24">
            <SectionHead
              step="03"
              label="What marking looks like"
              title="A real task, and how it is marked"
              icon={<ChecklistIcon />}
              onField
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              {/* The task */}
              <div className="rise flex flex-col gap-5 rounded-[var(--radius-card)] bg-surface p-7 shadow-[var(--shadow-lifted)]">
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
              </div>

              {/* How it is marked */}
              <div
                className="rise flex flex-col gap-6 rounded-[var(--radius-card)] bg-surface p-7 shadow-[var(--shadow-lifted)]"
                style={stagger(1)}
              >
                <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-ink-faint">
                  How it is marked
                </span>

                <RubricLadder criterion={leading!} />

                <div className="flex flex-col gap-3 border-t border-hairline pt-5">
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
              <Link
                href={`/projects/${featured.slug}`}
                className="font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
              >
                Read the full checklist
              </Link>
            </Meta>
          </div>
        </section>

        {/* ── 04 The hand-written subjects ───────────────────────────────── */}
        {/*
         * These three used to head the page as "What you can learn today",
         * which is the sentence that made a site offering any subject look
         * like a site offering three. They are not the catalogue; they are the
         * deep end, and the honest contrast with 02 is the whole point of
         * showing them — §7.1's declared depth needs both halves visible or it
         * declares nothing.
         */}
        <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-24">
          <SectionHead
            step="04"
            label="Written by hand"
            title="Three we wrote and checked ourselves"
            icon={<GridIcon />}
          />

          <Lead className="max-w-[var(--measure)]">
            A person wrote every skill, question and checklist in these, which
            is why they go deeper than three minutes of writing can.
          </Lead>

          <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((topic, i) => (
              <li key={topic.slug} className="rise" style={stagger(i)}>
                <LinkCard href={`/learn/${topic.slug}`} className="gap-4 p-6">
                  <span className="flex size-10 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-accent">
                    <SubjectIcon taxonomyParent={topic.taxonomyParent} />
                  </span>
                  <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                    {topic.name}
                  </span>
                  <Meta>
                    {topic.skillCount} skills · {topic.projectCount} pieces of
                    work · about {topic.totalHours} hours
                  </Meta>
                  {/* The maturity badge joins the tier note here, because the
                      page now shows two kinds of subject and a reader can only
                      tell them apart if both say which they are. */}
                  <span className="mt-auto flex flex-col gap-2 border-t border-hairline pt-4">
                    <MaturityBadge maturity={topic.maturity} />
                    <EvalTierNote tier={topic.evalTier} />
                  </span>
                </LinkCard>
              </li>
            ))}
          </ul>

          <Meta>
            Everything else is written when someone asks for it, and says so on
            every screen it appears.{" "}
            <Link
              href="/start"
              className="font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
            >
              Ask for a subject
            </Link>
          </Meta>

          <Breadcrumbs crumbs={[{ name: "Home", path: "/" }]} />
        </section>
      </main>
    </>
  );
}
