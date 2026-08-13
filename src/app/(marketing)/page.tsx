import type { Metadata } from "next";
import Link from "next/link";
import {
  Breadcrumbs,
  EvalTierNote,
  GoalSearch,
  JsonLdScript,
  SectionHead,
} from "@/components/marketing";
import {
  ChecklistIcon,
  GridIcon,
  StepsIcon,
  SubjectIcon,
} from "@/components/icons";
import { DisplayTitle, Lead, Meta } from "@/components/ui";
import { allTopics, featuredProject } from "@/lib/content";
import { organisation, website } from "@/lib/seo/jsonld";
import { canonical } from "@/lib/site";

/**
 * §8 screen 1 — the landing page.
 *
 * Third cut. The first was a slogan over jargon; the second was accurate but
 * was, verbatim, "just a long list of stuff" — every block a paragraph at the
 * same weight, with nothing to tell a skimmer where one idea stopped.
 *
 * So the rule here is: **one line per idea, and never two paragraphs in a row.**
 * Prose is reserved for the hero. Everything after it is a numbered section
 * with a rule above it, and rows that can be read at a glance. The detail all
 * still exists — it lives on /projects/[slug] and /learn/[topic], one click
 * away, which is where someone who has decided to care will go.
 *
 * §8.5.1's density rule: four things at rest, plus the hero.
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

export default function HomePage() {
  const topics = allTopics();
  const featured = featuredProject();

  // Suggestions come from real pack content, so the autocomplete can never
  // promise a subject the product does not actually teach.
  const suggestions = topics.map((t) => t.name);

  // The brief's opening paragraph is the hook; the rest is on the brief page.
  const hook = featured.brief.split("\n")[0]!;

  return (
    <>
      <JsonLdScript blocks={[organisation(), website()]} />

      <main className="mx-auto flex max-w-2xl flex-col gap-16 px-6 py-20">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-8">
          <DisplayTitle>
            Anyone can teach you. Almost no one checks whether you learned it.
          </DisplayTitle>
          <Lead>
            Say what you want to get good at. We find your gaps, set you real
            work, and mark it against a checklist you can read up front.
          </Lead>

          <GoalSearch suggestions={suggestions} autoFocus />

          <Meta>Free to start. No account until you have seen your result.</Meta>
        </section>

        {/* ── 01 How it works ──────────────────────────────────────────── */}
        <section className="flex flex-col gap-6">
          <SectionHead
            step="01"
            label="How it works"
            title="Five steps"
            icon={<StepsIcon />}
          />
          <ol className="flex list-none flex-col gap-4 p-0 m-0">
            {STEPS.map((step, i) => (
              <li key={step.name} className="flex items-baseline gap-4">
                <span
                  aria-hidden="true"
                  className="w-5 shrink-0 text-[length:var(--text-meta-size)] font-[650] text-accent"
                >
                  {i + 1}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-[550]">{step.name}</span>
                  <Meta>{step.body}</Meta>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── 02 A real task and its marking scheme ────────────────────── */}
        <section className="flex flex-col gap-6">
          <SectionHead
            step="02"
            label="What marking looks like"
            title="A real task, and the checklist behind it"
            icon={<ChecklistIcon />}
          />

          <div className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface p-5">
            <span className="font-[550]">{featured.title}</span>
            <Meta>{hook}</Meta>
          </div>

          <ul className="flex list-none flex-col gap-0 p-0 m-0 rounded-[var(--radius-card)] bg-surface overflow-hidden">
            {featured.rubricDetail.criteria.map((criterion) => (
              <li
                key={criterion.id}
                className="flex items-center justify-between gap-4 border-b border-hairline px-5 py-4 last:border-b-0"
              >
                <span className="font-[550]">{criterion.name}</span>
                <Meta>{Math.round(criterion.weight * 100)}%</Meta>
              </li>
            ))}
          </ul>

          <Meta>
            You see this before you start.{" "}
            <Link href={`/projects/${featured.slug}`} className="text-accent">
              Read the full checklist
            </Link>
          </Meta>
        </section>

        {/* ── 03 Subjects ──────────────────────────────────────────────── */}
        <section className="flex flex-col gap-6">
          <SectionHead
            step="03"
            label="Subjects"
            title="What you can learn today"
            icon={<GridIcon />}
          />
          <ul className="flex list-none flex-col gap-3 p-0 m-0">
            {topics.map((topic) => (
              <li key={topic.slug}>
                <Link
                  href={`/learn/${topic.slug}`}
                  className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface p-5 hover:bg-accent-weak"
                >
                  <span className="flex items-center gap-2.5 font-[550]">
                    <span className="text-accent">
                      <SubjectIcon taxonomyParent={topic.taxonomyParent} />
                    </span>
                    {topic.name}
                  </span>
                  <Meta>
                    {topic.skillCount} skills · {topic.projectCount} pieces of
                    work · about {topic.totalHours} hours
                  </Meta>
                  <EvalTierNote tier={topic.evalTier} />
                </Link>
              </li>
            ))}
          </ul>
          <Meta>
            Three so far. A subject appears only once it has been written and
            checked by hand.
          </Meta>
        </section>

        <Breadcrumbs crumbs={[{ name: "Home", path: "/" }]} />
      </main>
    </>
  );
}
