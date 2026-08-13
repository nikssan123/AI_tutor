import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { digestFor } from "@/lib/mastery/view";
import { coursesFor } from "@/lib/goals/courses";
import { standingFor } from "@/lib/goals/standing";
import { CourseList } from "@/components/course-list";
import { NothingRunning } from "@/components/nothing-running";
import {
  Card,
  Figure,
  Lead,
  Meta,
  stagger,
  Status,
  Title,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import { ArrowIcon } from "@/components/icons";

/**
 * §8 screen 11 — the weekly digest, for "weekly re-motivation and honest
 * recalibration".
 *
 * Five things and no more (§8.5.1's density rule): the hours against the
 * commitment, what moved, what was handed in, what is slipping, and how long
 * the rest looks from here. The recalibration is the second estimate — the same
 * remaining work priced at the pace actually kept rather than the one intended,
 * which is the number nobody else in this category will show you.
 *
 * No percentage anywhere, here either.
 */
export const metadata: Metadata = {
  title: "Your week",
  robots: { index: false, follow: false },
};

function hours(value: number): string {
  return `${value} ${value === 1 ? "hour" : "hours"}`;
}

function weeks(value: number): string {
  return `${value} ${value === 1 ? "week" : "weeks"}`;
}

export default async function ProgressPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const db = getDb();
  const [view, courses] = await Promise.all([
    digestFor(db, session.user.id, new Date()),
    coursesFor(db, session.user.id),
  ]);

  /*
   * The courses band, on both branches of this screen.
   *
   * It has to be on both: a learner who paused everything has no digest, and if
   * the list lived only under one there would be no way back to a course they
   * put aside. This is the one place in the product where a course is started,
   * stopped or picked up, which is deliberate — the same three buttons on three
   * screens would drift, and two of the three actions are hard to walk back.
   */
  const yourCourses =
    courses.length > 0 ? (
      <section className="rise flex flex-col gap-6" style={stagger(4)}>
        <SectionHead label="Your courses" title="What you have on" />
        <CourseList courses={courses} />
        <Meta>
          Putting a course aside keeps everything you proved on it. Finishing one
          isn&rsquo;t something you can press — it happens when every skill on the
          path has work behind it.
        </Meta>
      </section>
    ) : null;

  if (!view) {
    /*
     * Named for what this screen will hold rather than for what is missing,
     * and carrying whatever the learner has actually got on — the conversation
     * they left, or the subject being written for them right now. "No course
     * running" rather than "no goal yet" because `digestFor` also returns
     * nothing when a goal outlives its subject.
     *
     * No `PickBackUp` here: the band below already lists every course, this
     * one included, and is where they are managed rather than re-entered.
     */
    const standing = await standingFor(db, session.user.id);

    return (
      <AppFrame width="narrow">
        <AppHeader
          title="Your week"
          lead="Every seven days, an honest read on the pace you are actually keeping."
        />
        <NothingRunning
          standing={standing}
          note="Once a course is running, this is where the hours you kept get set against the hours you meant to."
        />
        {yourCourses}
      </AppFrame>
    );
  }

  const { digest } = view;

  return (
    <AppFrame>
      <AppHeader
        title="The last seven days"
        lead="What you put in, what moved because of it, and what that means for the rest."
      />

      {/* ── Hours against the commitment ─────────────────────────────────── */}
      {/*
       * The hero band. Time is the one number that decides whether any of the
       * others mean anything, so it is the only figure on the screen and it
       * sits on the accent field alone — the rest of the week is read after
       * this, not alongside it.
       */}
      <Card
        className="rise flex flex-wrap items-center justify-between gap-6 bg-accent-weak"
        style={stagger(1)}
      >
        <Figure
          value={digest.hoursLogged}
          unit={digest.hoursLogged === 1 ? "hour" : "hours"}
          caption={`logged of the ${hours(digest.committedHours)} you set aside${
            digest.sessions > 0
              ? `, across ${digest.sessions} ${digest.sessions === 1 ? "session" : "sessions"}`
              : ""
          }.`}
        />
        {digest.keptCommitment ? (
          <Status tone="verified">You did what you said you would</Status>
        ) : (
          <Status tone="attention">Short of what you planned</Status>
        )}
      </Card>

      {/* ── What moved, and what is slipping ─────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(2)}>
        <SectionHead label="The week" title="Where it went" />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="flex h-full flex-col gap-4">
            <Title>What changed</Title>
            {digest.moved.length > 0 ? (
              <ul className="flex list-none flex-col gap-2 p-0 m-0">
                {digest.moved.map((move) => (
                  <li key={move.name} className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="inline-block size-1.5 shrink-0 rounded-full bg-accent"
                    />
                    {move.name}
                  </li>
                ))}
              </ul>
            ) : (
              <Meta tone="muted">
                Nothing moved. Mastery only moves on work we can mark.
              </Meta>
            )}
            <Meta className="mt-auto border-t border-hairline pt-4">
              {digest.artefacts > 0
                ? `${digest.artefacts} ${digest.artefacts === 1 ? "piece" : "pieces"} of work handed in`
                : "Nothing handed in"}
            </Meta>
          </Card>

          <Card className="flex h-full flex-col gap-4">
            <Title>Holding on to it</Title>
            {digest.tracked > 0 ? (
              <>
                <Lead className="text-ink">
                  {digest.tracked} {digest.tracked === 1 ? "skill" : "skills"}{" "}
                  you have shown.{" "}
                  {digest.slipping > 0
                    ? `${digest.slipping} of them ${digest.slipping === 1 ? "is" : "are"} starting to slip.`
                    : "None of them are slipping."}
                </Lead>
                {digest.slipping > 0 ? (
                  <Link
                    href="/mastery?show=left"
                    className="mt-auto inline-flex w-fit items-center gap-1.5 font-[550] text-accent underline-offset-4 hover:underline"
                  >
                    See which
                    <ArrowIcon className="size-4" />
                  </Link>
                ) : null}
              </>
            ) : (
              <Meta tone="muted">
                Nothing to hold on to yet — this fills up as you show what you
                can do.
              </Meta>
            )}
          </Card>
        </div>
      </section>

      {/* ── The revised estimate ─────────────────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(3)}>
        {/* Not "What's left": that is the name of a list of skills on
            /mastery, and one label for two different things is how a product
            teaches people to distrust its words. */}
        <SectionHead label="From here" title="What's ahead" />

        <Card className="flex flex-col gap-3">
          <Lead className="text-ink">
            About {hours(digest.remainingHours)}, which is{" "}
            {weeks(digest.weeksAtCommitment)} at the{" "}
            {hours(digest.committedHours)} a week you planned for.
          </Lead>
          {/* The honest half. Pricing the same work at the pace actually kept
              is the difference between a plan and a wish. */}
          {digest.weeksAtActualPace === null ? (
            <Meta tone="muted">
              At last week&rsquo;s pace there is no finish date to give you.
            </Meta>
          ) : (
            <Meta tone="muted">
              At the {hours(digest.hoursLogged)} you actually did:{" "}
              {weeks(digest.weeksAtActualPace)}. Today&rsquo;s session already
              takes that into account.
            </Meta>
          )}
        </Card>
      </section>

      {yourCourses}
    </AppFrame>
  );
}
