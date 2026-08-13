import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { todayFor } from "@/lib/goals/today";
import { loadIntake } from "@/lib/goals/intake-store";
import { resumableIntake } from "@/lib/goals/onboarding";
import { coursesFor, pickUpAgain } from "@/lib/goals/courses";
import { answeredTopics } from "@/lib/check/session";
import { allTopics } from "@/lib/content";
import { SubjectIcon } from "@/components/icons";
import { SubjectList } from "@/components/subject-list";
import { CourseList } from "@/components/course-list";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Lead,
  Meta,
  stagger,
  Status,
  Title,
  MaturityBadge,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import type { SessionBlock } from "@/lib/engine";
import { startSessionAction } from "../session/[id]/actions";

/**
 * §8 screen 6 — the daily dashboard, and the retention surface. It must answer
 * "what do I do now" in under two seconds, with one primary card and nothing
 * else: no feed, no browse.
 *
 * The sentence under the title is the planner's own `reason`, template-filled
 * from the score components that actually decided the choice (§16.1). It is not
 * generated, which is why it can be trusted: it cannot say something the
 * ranking did not.
 */
export const metadata: Metadata = {
  title: "Today",
  robots: { index: false, follow: false },
};

/** Minutes offered by "I have less time". */
const SHORTER = 15;

/**
 * How many subjects the no-goal screen shows before sending you to `/subjects`.
 *
 * Four rather than the whole catalogue, because §8.5.1's density rule counts
 * this band as one thing only while it stays a sample. A full list here would
 * make `/today` a browse screen, which is the one thing §8 screen 6 says it must
 * never be.
 */
const PREVIEW = 4;

const BLOCK_LABEL: Record<SessionBlock["type"], string> = {
  explain: "Read",
  check: "Recall",
  apply: "Do",
  review: "Review",
  reflect: "Reflect",
};

function blockDetail(block: SessionBlock, names: Map<string, string>): string {
  switch (block.type) {
    case "explain":
      return names.get(block.skillId) ?? block.skillId;
    case "check":
      return block.isRetrieval
        ? `${names.get(block.skillId) ?? block.skillId} — from memory`
        : (names.get(block.skillId) ?? block.skillId);
    case "apply":
      return names.get(block.skillId) ?? block.skillId;
    case "review":
      return block.focus;
    case "reflect":
      return block.prompt;
  }
}

/**
 * `/today` with no course running.
 *
 * It used to be one card saying "You don't have a goal yet" with one button —
 * and the same card, in the same words, was also the whole of `/calendar`,
 * `/mastery` and `/progress`. Four destinations, one dead end, four times. This
 * is the screen that owes the learner something instead, and it owes them
 * exactly three things in §8.5.1's budget: what they already started, what they
 * could start, and how to find out where they stand first.
 *
 * "Nothing running" rather than "no goal yet" is deliberate: `todayFor` also
 * returns nothing when a goal outlives the pack it was created against, and
 * telling that learner they never set a goal is false.
 */
async function nothingRunningYet(userId: string) {
  const topics = allTopics();
  const db = getDb();
  const [intake, courses, jar] = await Promise.all([
    loadIntake(db, userId),
    coursesFor(db, userId),
    cookies(),
  ]);

  const resume = resumableIntake(intake);
  const again = pickUpAgain(courses);
  const checked = answeredTopics(
    topics.map((t) => t.slug),
    (name) => jar.get(name)?.value,
  );

  return (
    <AppFrame>
      <AppHeader
        title="Today"
        lead="One thing at a time, chosen for you — once there is a course to choose from."
      />

      {/*
       * The primary card, and the only filled button on the screen (§8.5.5). A
       * conversation someone walked away from is a better offer than a fresh
       * one, so when there is one it takes this slot rather than sitting below
       * the invitation to start again.
       */}
      <Card className="rise flex flex-col items-start gap-4" style={stagger(1)}>
        {resume ? (
          <>
            <Title>
              {resume.ready
                ? "Your course is ready to build"
                : "You were partway through"}
            </Title>
            <Lead>
              {resume.subject
                ? `We were talking about ${resume.subject}.`
                : "We were working out what you wanted."}{" "}
              {resume.ready
                ? "Nothing more to answer — it just needs building."
                : `${resume.turns} of ${resume.ofTurns} questions answered.`}
            </Lead>
            <ButtonLink href="/start">
              {resume.ready ? "Build it" : "Carry on"}
            </ButtonLink>
          </>
        ) : (
          <>
            <Title>Pick something to get good at</Title>
            <Lead>
              Tell us in your own words and we&rsquo;ll work out what to do
              first — and what to skip because you can already do it. If we
              don&rsquo;t cover it yet, we&rsquo;ll build it.
            </Lead>
            <ButtonLink href="/start">Tell us what you want</ButtonLink>
          </>
        )}
      </Card>

      {/*
       * A course put aside beats anything on the catalogue: the learner has
       * already chosen it, already has mastery behind it, and the queue kept
       * running while it was away. Kept as its own band rather than competing
       * with the primary card, so both offers survive.
       */}
      {again.length > 0 ? (
        <section className="rise flex flex-col gap-6" style={stagger(2)}>
          <SectionHead label="You have these already" title="Pick one back up" />
          <CourseList courses={again} />
          <Meta>
            Everything you proved on these is still yours — picking one up puts
            it back on your Today.
          </Meta>
        </section>
      ) : null}

      <section className="rise flex flex-col gap-6" style={stagger(3)}>
        <SectionHead
          label="Or look around"
          title="Subjects we cover"
          action={
            <Link
              href="/subjects"
              className="font-[550] text-accent underline-offset-4 hover:underline"
            >
              See everything
            </Link>
          }
        />

        <Lead>
          Not sure where you&rsquo;d start? A ten-minute check finds your gaps
          before you commit to anything, and whatever you answer comes with you
          into the course.
        </Lead>

        <SubjectList topics={topics.slice(0, PREVIEW)} checked={checked} />
      </section>
    </AppFrame>
  );
}

type Props = { searchParams: Promise<{ minutes?: string }> };

export default async function TodayPage({ searchParams }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { minutes } = await searchParams;
  const requested = Number(minutes);
  const view = await todayFor(getDb(), session.user.id, new Date(), {
    availableMinutes:
      Number.isFinite(requested) && requested > 0 ? requested : undefined,
  });

  // Awaited rather than rendered as an element: an async component nested in a
  // returned tree is resolved by the RSC renderer, which means the page's own
  // tests would be asserting against a promise.
  if (!view) return nothingRunningYet(session.user.id);

  const { pack, projection, session: planned, skillNames, openSessionId } = view;

  return (
    <AppFrame>
      <AppHeader
        icon={<SubjectIcon taxonomyParent={pack.taxonomyParent} />}
        title="Today"
        facts={
          <>
            <Meta>{pack.name}</Meta>
            <Meta>{planned.totalMinutes} min</Meta>
            {/*
              §7.1 — depth is declared, not faked, and this is where it has to
              be declared: a learner who never saw the wait screen would
              otherwise have nothing telling them their course was written on
              request and has not been read by a person. Only shown when there
              is something to say, so a curated pack does not carry a badge on
              every visit.
            */}
            {pack.maturity !== "curated" ? (
              <MaturityBadge maturity={pack.maturity} />
            ) : null}
          </>
        }
      />

      {/*
       * The session card is the one thing on this screen, so it is the only
       * thing at full width and the only thing carrying the accent field. The
       * bands under it are the context you read *after* deciding to start.
       */}
      <Card className="rise p-0 overflow-hidden" style={stagger(1)}>
        <div className="flex flex-col gap-6 p-7">
          {/* The planner's own `reason`, template-filled from the components
              that actually decided the choice (§16.1). It is the single most
              important sentence on the screen, so it gets the accent field and
              the largest type in the card rather than sitting in the same grey
              as everything else. */}
          <div className="rounded-[var(--radius-card)] bg-accent-weak px-6 py-5">
            <Title className="text-ink">{planned.reason}</Title>
          </div>

          {planned.backingOff ? (
            <Status tone="attention">
              Backing off — a worked example today, nothing to hand in
            </Status>
          ) : null}

          {planned.blocks.length > 0 ? (
            <ul className="flex list-none flex-col gap-0 p-0 m-0 overflow-hidden rounded-[var(--radius-control)] bg-raised">
              {planned.blocks.map((block, i) => (
                <li
                  key={`${block.type}-${i}`}
                  className="rise flex items-center justify-between gap-4 border-b border-hairline px-5 py-3.5 last:border-b-0"
                  style={stagger(i + 2)}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex min-w-14 justify-center rounded-[var(--radius-pill)] bg-accent-weak px-2.5 py-1 text-[length:var(--text-meta-size)] font-[650] text-accent">
                      {BLOCK_LABEL[block.type]}
                    </span>
                    <span className="min-w-0">
                      {blockDetail(block, skillNames)}
                    </span>
                  </span>
                  <Meta className="shrink-0">{block.estMinutes} min</Meta>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="Nothing is unlocked right now — every skill on your path is either done or waiting on a prerequisite." />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline px-7 py-5">
          {/* A form, not a link: starting a session writes rows. The action
              hands back the session already in progress if there is one, so a
              second click cannot split a learner's answers across two. */}
          {planned.blocks.length > 0 ? (
            <form action={startSessionAction}>
              <Button type="submit">
                {openSessionId ? "Carry on" : "Start session"}
              </Button>
            </form>
          ) : (
            <Meta>Nothing to start today.</Meta>
          )}
          <Link
            href={`/today?minutes=${SHORTER}`}
            className="text-accent font-[550] hover:underline underline-offset-4"
          >
            I have less time
          </Link>
        </div>
      </Card>

      {planned.compression ? (
        <Card className="rise flex flex-col gap-2" style={stagger(3)}>
          <Status tone="attention">Deadline</Status>
          <Meta>{planned.compression.message}</Meta>
        </Card>
      ) : null}

      <section className="rise flex flex-col gap-6" style={stagger(4)}>
        <SectionHead label="The rest of it" title="Your path" />

        <Lead>
          {projection.requiredSkillIds.length} skills to go ·{" "}
          {projection.estimatedHours} hours at your current level
          {projection.optionalSkillIds.length > 0
            ? ` · ${projection.optionalSkillIds.length} optional`
            : ""}
        </Lead>

        {/* §8 screen 5's honesty half, on the screen people actually open
            daily: what we took off the path, and why. */}
        {projection.excludedSkillIds.length > 0 ? (
          <ul className="grid list-none grid-cols-1 gap-3 p-0 m-0 sm:grid-cols-2">
            {projection.excludedSkillIds.map((id) => (
              <li
                key={id}
                className="rounded-[var(--radius-control)] bg-surface px-4 py-3 shadow-[var(--shadow-raised)]"
              >
                <Meta>{projection.exclusionReasons[id]}</Meta>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </AppFrame>
  );
}
