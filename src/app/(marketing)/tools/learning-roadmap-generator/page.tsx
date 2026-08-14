import type { Metadata } from "next";
import Link from "next/link";
import { ChecklistIcon, StepsIcon } from "@/components/icons";
import {
  JsonLdScript,
  PageFrame,
  PageIntro,
  SectionHead,
} from "@/components/marketing";
import { Button, Card, Meta, revealAt, Status } from "@/components/ui";
import { allTopics, findPack } from "@/lib/content";
import {
  buildRoadmap,
  defaultSubject,
  groupByWeek,
  ROADMAP_TOOL_PATH,
  weeklyHoursFrom,
} from "@/lib/roadmap/plan";
import { breadcrumbs, webApplication } from "@/lib/seo/jsonld";
import { marketingMetadata } from "@/lib/seo/metadata";

/**
 * §10 E and §19.1 — the Roadmap Generator, and §17's last unbuilt MUST that is
 * not content or billing.
 *
 * **It generates nothing.** See `lib/roadmap/plan.ts` for why: by the time this
 * was reachable, the skill graph, the topological order, the projection and the
 * hours all existed as pack data and pure code, so a roadmap for a subject we
 * have is arithmetic. §19.2's precompute cache was the right answer to the
 * wrong question — there is no AI spend here to cache away, no quality gate to
 * run over the output, and nothing to spot-check.
 *
 * **It has no level field**, which is the part that makes it ours. Every
 * competing tool asks how good you are and shortens the plan on the answer;
 * §4.2 law 1 says self-report is not evidence, and `projection.ts` refuses to
 * read the stated level for exactly that reason. So this page draws the same
 * plan for everyone and says so — the only thing that takes work out of it is
 * work we have marked.
 *
 * §13.3 — the bare URL is the indexable one and every parameterised view is
 * `noindex, follow`, canonical to it. That is the faceted-nav rule, and it is
 * also §12's ban on timeframe-combinatorial pages (§17 lists them under DON'T
 * BUILD): seven subjects × forty paces is 280 near-identical pages, which is
 * the content-farm shape this product exists not to be.
 */
export const revalidate = 86_400;

const TITLE = "Learning roadmap generator: any subject, week by week";

const DESCRIPTION =
  "Pick a subject and the hours you actually have. Get the real skill order, the graded work it ends in, and an honest total in weeks. No account, no email.";

interface Params {
  searchParams: Promise<{ subject?: string; hours?: string }>;
}

export async function generateMetadata({
  searchParams,
}: Params): Promise<Metadata> {
  const { subject, hours } = await searchParams;

  return marketingMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: ROADMAP_TOOL_PATH,
    // Any choice at all makes this a view of the tool rather than the tool.
    indexable: subject === undefined && hours === undefined,
  });
}

/** The one link style used in running text on this page. */
const INLINE_LINK =
  "font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent";

const FIELD_LABEL = "text-[length:var(--text-label-size)] font-[650] text-ink";

export default async function RoadmapToolPage({ searchParams }: Params) {
  const { subject, hours } = await searchParams;
  const topics = allTopics();

  // An unknown subject falls back rather than 404s: this is a URL a stranger
  // can edit, and a tool's failure mode is "here is a plan anyway".
  const chosen = topics.find((t) => t.slug === subject) ?? defaultSubject(topics)!;
  const pack = findPack(chosen.slug)!;
  const weeklyHours = weeklyHoursFrom(hours);

  /*
   * No mastery, and no reading of the check cookie — see `plan.ts` for the
   * measurement behind that. A nine-question check cannot lift a skill to the
   * bar `projectSkills` excludes at, so a plan built on one would be identical
   * to this and a band claiming otherwise would never render.
   */
  const now = new Date().toISOString();
  const roadmap = buildRoadmap({ pack, mastery: [], weeklyHours, now });
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Roadmap generator", path: ROADMAP_TOOL_PATH },
  ];

  return (
    <>
      <JsonLdScript
        blocks={[
          breadcrumbs(crumbs),
          webApplication({
            name: "Learning roadmap generator",
            description: DESCRIPTION,
            path: ROADMAP_TOOL_PATH,
          }),
        ]}
      />

      <PageFrame crumbs={crumbs}>
        <PageIntro
          icon={<StepsIcon />}
          title="Plan any subject, week by week"
          /* §11 item 1 — the 40–60 word direct answer, for the snippet and for
             the person who reads one paragraph and decides. */
          lead="Pick a subject and say how many hours a week you actually have. You get the real order the skills have to be learned in, the graded work each stretch ends in, and an honest total in weeks. It is arithmetic over a published skill map, not a plan a model wrote on the way to you."
          facts={
            <>
              <Meta>No account</Meta>
              <Meta>No email</Meta>
              <Meta>{topics.length} subjects</Meta>
            </>
          }
        />

        {/* ── The tool, above the fold ───────────────────────────────────── */}
        {/*
         * A plain GET form: the answer is a URL, so it survives a refresh, a
         * bookmark and a paste into a message. That is also what keeps §8.5.8's
         * "marketing routes ship zero component-library JS" true on the one
         * marketing page that takes input.
         */}
        <Card className="flex flex-col gap-0 p-0">
          <form method="get" className="flex flex-col gap-0">
            <fieldset className="flex flex-col gap-4 border-0 p-0 m-0">
              <legend className="sr-only">Subject</legend>
              <span className={`${FIELD_LABEL} px-6 pt-6`}>Subject</span>
              <ul className="flex list-none flex-col gap-0 p-0 m-0">
                {topics.map((topic) => (
                  <li key={topic.slug} className="border-t border-hairline">
                    <label className="flex min-h-[var(--touch-min)] cursor-pointer items-center gap-3 px-6 py-4 transition-colors duration-[var(--dur-fast)] hover:bg-accent-weak has-checked:bg-accent-weak">
                      <input
                        type="radio"
                        name="subject"
                        value={topic.slug}
                        defaultChecked={topic.slug === chosen.slug}
                        className="accent-[var(--color-accent)]"
                      />
                      <span className="font-[550]">{topic.name}</span>
                      <span className="ml-auto flex items-center gap-3">
                        {/* --ink-faint is under the small-text bar on the
                            accent-weak fill a checked row takes (§8.5.4). */}
                        <Meta tone="muted">{topic.skillCount} skills</Meta>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            <div className="flex flex-wrap items-end gap-6 border-t border-hairline p-6">
              <div className="flex flex-col gap-2">
                <label htmlFor="hours" className={FIELD_LABEL}>
                  Hours a week
                </label>
                <input
                  id="hours"
                  name="hours"
                  type="number"
                  min={0.5}
                  max={40}
                  step={0.5}
                  defaultValue={weeklyHours}
                  className="min-h-[var(--touch-min)] w-32 rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-ink focus:border-accent transition-colors duration-[var(--dur-fast)]"
                />
              </div>
              <Button type="submit" className="sm:ml-auto">
                Build the plan
              </Button>
            </div>
          </form>
        </Card>

        {roadmap === null ? (
          /*
           * Reachable exactly two ways: a subject too small to make three
           * modules out of, and a visitor whose check already cleared nearly
           * all of it. The second is the good news it looks like, and saying so
           * is better than padding the plan back up to a respectable length.
           */
          <Card className="flex flex-col items-start gap-4">
            <Status tone="verified">Nothing to lay out</Status>
            <Meta className="max-w-[var(--measure)]">
              {chosen.name} does not have enough in it to spread across weeks —
              it is shorter than a plan. The way to find out where you stand in
              it is the check, and the way to prove it is a graded brief.
            </Meta>
            <span className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Link href={`/check/${chosen.slug}`} className={INLINE_LINK}>
                Take the check
              </Link>
              <Link href="/projects" className={INLINE_LINK}>
                Read a graded brief
              </Link>
            </span>
          </Card>
        ) : (
          <>
            {/* ── 01 The estimate ──────────────────────────────────────── */}
            <section className="flex flex-col gap-8">
              <SectionHead
                step="01"
                label="The estimate"
                title={`${roadmap.weeks} weeks at ${roadmap.weeklyHours} hours a week`}
                icon={<ChecklistIcon />}
              />

              <Card className="flex flex-col gap-6">
                <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                  {[
                    ["Hours of work", String(roadmap.totalHours)],
                    ["Weeks", String(roadmap.weeks)],
                    ["Things to do", String(roadmap.entries.length)],
                    ["Marked", String(roadmap.gradedCount)],
                  ].map(([label, value], i) => (
                    <div
                      key={label}
                      className="reveal flex flex-col gap-1"
                      style={revealAt(i)}
                    >
                      <span className="text-[length:var(--text-display-size)] font-[650] leading-none tracking-[var(--text-display-tracking)] text-accent">
                        {value}
                      </span>
                      <Meta>{label}</Meta>
                    </div>
                  ))}
                </div>

                {/*
                 * §11 item 3 — "an explicit range with stated assumptions", and
                 * the range is a real one rather than a margin of error nobody
                 * measured. The pack declares which skills are the specialist
                 * tail; `projectSkills` leaves them out of the estimate on
                 * purpose, so the honest upper bound is the plan with them in.
                 */}
                <Meta className="max-w-[var(--measure)] border-t border-hairline pt-5">
                  {roadmap.optionalHours > 0 ? (
                    <>
                      That is the core path. {chosen.name} also declares{" "}
                      {roadmap.optionalHours} hours of specialist skills that
                      are not counted above — take those too and it is{" "}
                      {roadmap.weeksWithOptional} weeks. Both numbers assume you
                      hit {roadmap.weeklyHours} hours every week, which nobody
                      does; the plan does not expire if you don&rsquo;t.
                    </>
                  ) : (
                    <>
                      That assumes you hit {roadmap.weeklyHours} hours every
                      week, which nobody does. The plan does not expire if you
                      don&rsquo;t.
                    </>
                  )}
                </Meta>
              </Card>
            </section>

            {/* ── The plan ─────────────────────────────────────────────── */}
            <section className="flex flex-col gap-8">
              <SectionHead
                step="02"
                label="The plan"
                title="Week by week, in the order it has to be learned"
                icon={<StepsIcon />}
              />
              <Meta>
                Each line is one thing to be able to do. The order is the skill
                map&rsquo;s own: nothing appears before what it needs.
              </Meta>

              <ol className="flex list-none flex-col gap-0 p-0 m-0">
                {groupByWeek(roadmap.entries).map((group, i) => (
                  <li
                    key={group.week}
                    className="reveal grid gap-x-10 gap-y-3 border-b border-hairline py-6 last:border-b-0 lg:grid-cols-[minmax(0,3fr)_minmax(0,10fr)]"
                    style={revealAt(i)}
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                        Week {group.week}
                      </span>
                      {/*
                       * "starts here", not "this week". A week holds whatever
                       * is still running from the last one, so the sum of the
                       * rows below can be more than the pace — 6.5h under a
                       * 4-hour week, when a 3-hour project begins on the
                       * Thursday. Printing that as the week's workload would be
                       * wrong; printing it as what begins is exactly right, and
                       * it is also what explains the light week after it.
                       */}
                      <Meta>{group.hours}h starts here</Meta>
                    </div>

                    <ul className="flex list-none flex-col gap-4 p-0 m-0">
                      {group.entries.map((entry) => (
                        <li
                          key={entry.title}
                          className="flex flex-col gap-1.5"
                        >
                          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="text-[length:var(--text-label-size)] font-[550] text-ink">
                              {entry.title}
                            </span>
                            {entry.graded ? (
                              <Status tone="verified">Marked</Status>
                            ) : null}
                          </span>
                          {entry.brief === null ? (
                            <Meta>{entry.canDo}</Meta>
                          ) : (
                            <Meta>
                              <Link
                                href={`/projects/${entry.brief}`}
                                className={INLINE_LINK}
                              >
                                Read the checklist it is marked against
                              </Link>
                            </Meta>
                          )}
                          <Meta>
                            {entry.hours}h
                            {entry.through > entry.week
                              ? ` · runs into week ${entry.through}`
                              : ""}
                          </Meta>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>

            {/* ── What this plan is, and is not ────────────────────────── */}
            {/*
             * §11 item 12's CTA and §4.2 law 5's declared limit, which here are
             * the same sentence — and it is deliberately not the sentence every
             * other roadmap tool ends on.
             *
             * Theirs is "tell us your level and we'll tailor this". Ours is that
             * the plan is the subject's and nothing you *say* moves it. That is
             * law 1 written as a feature rather than as an apology, and it is
             * also simply what is true: see `plan.ts` for why even the check
             * cannot currently move it, and why claiming otherwise here would be
             * a band nobody could ever see.
             */}
            <section className="flex flex-col gap-6">
              <Card className="settle flex flex-col items-start gap-5 p-7 sm:p-9">
                <span className="text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink">
                  This is the same plan we would give anyone
                </span>
                <Meta className="max-w-[var(--measure)]">
                  There is no box here for how good you already are, because
                  saying so has never made it true. This is what{" "}
                  {chosen.name} takes, and the only thing that takes work out of
                  it is work of yours that has been marked. What the ten-minute
                  check gives you is the other half: where you stand in it
                  before you start.
                </Meta>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <Link
                    href={`/check/${chosen.slug}`}
                    className="min-h-[var(--touch-min)] inline-flex items-center rounded-[var(--radius-control)] bg-accent px-5 font-[550] text-on-accent transition-opacity duration-[var(--dur-fast)] hover:opacity-90"
                  >
                    Check where you stand in {chosen.name}
                  </Link>
                  <Meta>About ten minutes. No account.</Meta>
                </div>
              </Card>

              <Meta className="max-w-[var(--measure)]">
                The plan above is{" "}
                <Link href={`/learn/${chosen.slug}`} className={INLINE_LINK}>
                  {chosen.name}
                </Link>{" "}
                in full, and the marked work in it is{" "}
                <Link href="/projects" className={INLINE_LINK}>
                  published with its checklist
                </Link>{" "}
                before you start. Want a subject nobody has written?{" "}
                <Link href="/start" className={INLINE_LINK}>
                  Ask for it
                </Link>{" "}
                — that one does need an account, and about three minutes.
              </Meta>
            </section>
          </>
        )}
      </PageFrame>
    </>
  );
}
