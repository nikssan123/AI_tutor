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
  StepsIcon,
  SubjectIcon,
} from "@/components/icons";
import { HeroTitle, Lead, Meta } from "@/components/ui";
import { allTopics, featuredProject } from "@/lib/content";
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
 * §13.1 — statically rendered, revalidated daily.
 */
export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "Learn something properly — and prove you did",
  description:
    "Say what you want to get good at. A ten-minute check finds what you already know, you get a plan for the gaps, and the real work you hand in gets marked against a checklist you can read up front.",
  alternates: { canonical: canonical("/") },
  openGraph: {
    title: "Learn something properly — and prove you did",
    description:
      "Most courses cannot tell you whether you learned anything. This one marks the work you actually produce, against a checklist you see before you start.",
    url: canonical("/"),
    type: "website",
  },
};

/** One line each. If a step needs two, the step is wrong. */
const STEPS = [
  {
    name: "Name the goal",
    body: "In your own words. You do not pick from a catalogue.",
  },
  {
    name: "Take a ten-minute check",
    body: "It gets harder or easier as you answer, so it finds your level fast.",
  },
  {
    name: "Get a plan for your gaps",
    body: "Whatever you can already do is skipped, and it says what it skipped.",
  },
  {
    name: "Do one real piece of work",
    body: "Not a quiz. You hand in the thing you actually made.",
  },
  {
    name: "Get it marked",
    body: "Every point quotes your own work back at you.",
  },
];

/** §8.5.6 — 24ms between items, first render only. */
const stagger = (i: number) => ({ "--rise-delay": `${i * 24}ms` }) as React.CSSProperties;

export default function HomePage() {
  const topics = allTopics();
  const featured = featuredProject();

  // Suggestions come from real pack content, so the autocomplete can never
  // promise a subject the product does not actually teach.
  const suggestions = topics.map((t) => t.name);

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
            Anyone can teach you. Almost no one checks whether you learned it.
          </HeroTitle>

          <Lead className="rise" style={stagger(1)}>
            Say what you want to get good at. We find your gaps, set you real
            work, and mark it against a checklist you can read up front.
          </Lead>

          <div className="rise flex flex-col gap-3" style={stagger(2)}>
            <GoalSearch suggestions={suggestions} autoFocus size="hero" />
            <Meta>Free to start. No account until you have seen your result.</Meta>
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

        {/* ── 02 A real task and its marking scheme ──────────────────────── */}
        {/*
         * The one full-bleed accent field on the site. §8.5.4 warns that large
         * saturated fills glare in dark — `--accent-weak` is a *tint* in light
         * and a near-black jade in dark, so it reads as a field in both without
         * either one shouting.
         */}
        <section className="bg-accent-weak">
          <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-24">
            <SectionHead
              step="02"
              label="What marking looks like"
              title="A real task, and the checklist behind it"
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
                    Done means
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
                    Marked the same way
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

        {/* ── 03 Subjects ────────────────────────────────────────────────── */}
        <section className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-24">
          <SectionHead
            step="03"
            label="Subjects"
            title="What you can learn today"
            icon={<GridIcon />}
          />

          <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((topic, i) => (
              <li key={topic.slug} className="rise" style={stagger(i)}>
                <Link
                  href={`/learn/${topic.slug}`}
                  className={
                    "flex h-full flex-col gap-4 rounded-[var(--radius-card)] bg-surface p-6 " +
                    "shadow-[var(--shadow-raised)] " +
                    "transition-[box-shadow,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] " +
                    "hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)]"
                  }
                >
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
                  <span className="mt-auto border-t border-hairline pt-4">
                    <EvalTierNote tier={topic.evalTier} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <Meta>
            Three so far. A subject appears only once it has been written and
            checked by hand.
          </Meta>

          <Breadcrumbs crumbs={[{ name: "Home", path: "/" }]} />
        </section>
      </main>
    </>
  );
}
