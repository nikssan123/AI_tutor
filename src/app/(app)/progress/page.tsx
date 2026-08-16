import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { digestFor } from "@/lib/mastery/view";
import { calendarFor } from "@/lib/calendar/view";
import { coursesFor } from "@/lib/goals/courses";
import { standingFor } from "@/lib/goals/standing";
import { deadlineVerdict } from "@/lib/calendar/checkpoints";
import { relativeDay, shortDate } from "@/lib/calendar/dates";
import { formatDeadline } from "@/lib/goals/captured-display";
import { CalendarMonth } from "@/components/calendar-month";
import { CourseList } from "@/components/course-list";
import { NothingRunning } from "@/components/nothing-running";
import { WeekDigest } from "@/components/week-digest";
import {
  Card,
  Figure,
  HeroBand,
  Lead,
  Meta,
  Row,
  RowList,
  Signal,
  stagger,
  Status,
  Title,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";

/**
 * §8 screen 11 and §8 screen 14, on one screen — "how it is going" and "when".
 *
 * They shipped as two destinations and should never have been. Both opened with
 * a `Figure` about the same commitment, both carried the same honest second
 * estimate — the remaining work priced at the pace actually kept — and between
 * them they took two of five slots in a rail that had no slot at all for the
 * course itself. §8.5.5 names three destinations and Path was the missing one;
 * this is where the room for it came from.
 *
 * The merge is a merge rather than a concatenation, in two places:
 *
 *   - **One hero, not two.** `/calendar` led with a streak in weeks and
 *     `/progress` with the hours in the last seven days, which are the same
 *     commitment read twice. The hours keep the `Figure` — they are what the
 *     learner can still act on today — and the streak becomes a `Status` beside
 *     it. §8.5.10's "one Figure per band, never a row" is why the streak could
 *     not simply be moved across.
 *   - **One band for what is ahead.** `/progress` priced the whole course at two
 *     paces and `/calendar` priced each checkpoint at the same two, in separate
 *     bands on separate screens. Same question at two granularities, so: the
 *     whole course as the band's lead, the checkpoints under it, and the deadline
 *     verdict at the bottom where it belongs.
 *
 * No percentage anywhere (§24 E9), and the one streak here is measured in weeks
 * against the learner's own commitment — see `schedule.ts` for why a daily one
 * would be a lie about their own plan.
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

type Props = { searchParams: Promise<{ month?: string }> };

export default async function ProgressPage({ searchParams }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const db = getDb();
  const { month } = await searchParams;
  const now = new Date();

  const [view, calendar, courses] = await Promise.all([
    digestFor(db, session.user.id, now),
    calendarFor(db, session.user.id, now, { month }),
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
      <section className="rise flex flex-col gap-6" style={stagger(6)}>
        <SectionHead label="Your courses" title="What you have on" />
        <CourseList courses={courses} />
        <Meta>
          Putting a course aside keeps everything you proved on it. Finishing one
          isn&rsquo;t something you can press — it happens when every skill on the
          path has work behind it.
        </Meta>
      </section>
    ) : null;

  /*
   * Two reads, so both are checked.
   *
   * `digestFor` and `calendarFor` ask the same two questions — is there an
   * active goal, and does its pack still resolve — but they ask them
   * separately, and a course paused between the two answers would leave one
   * view and not the other. Rendering half a screen is worse than rendering the
   * offer, so either being absent means the same thing here.
   */
  if (!view || !calendar) {
    /*
     * Named for what this screen will hold rather than for what is missing,
     * and carrying whatever the learner has actually got on — the conversation
     * they left, or the subject being written for them right now.
     *
     * No `PickBackUp` here: the band below already lists every course, this
     * one included, and is where they are managed rather than re-entered.
     */
    const standing = await standingFor(db, session.user.id);

    return (
      /* The same width this screen has once there is a digest, and the same
         width `/today` meets the same learner at. A route that is narrow while
         it is empty and wide once it fills moves the whole page under someone
         who only pressed "Build it". */
      <AppFrame>
        <AppHeader
          title="Your week"
          lead="Every seven days, an honest read on the pace you are actually keeping — and where the work ahead lands."
        />
        <NothingRunning
          standing={standing}
          note="Once a course is running, this is where the hours you kept get set against the hours you meant to, and everything owed turns up on a date."
        />
        {yourCourses}
      </AppFrame>
    );
  }

  const { digest } = view;
  const { pack, commitment, checkpoints, deadline, today } = calendar;
  // Paired with the date it is about, so the sentences below cannot be written
  // without one — a deadline warning that has lost its deadline is worse than
  // no warning at all.
  const late =
    deadline === null
      ? null
      : { deadline, verdict: deadlineVerdict(checkpoints, deadline) };

  return (
    <AppFrame>
      <AppHeader
        title="The last seven days"
        lead="What you put in, what moved because of it, and where the rest of it lands."
        facts={
          <>
            <Meta>{pack.name}</Meta>
            <Meta>{hours(commitment.weeklyHours)} a week</Meta>
            {deadline ? <Meta>by {formatDeadline(deadline)}</Meta> : null}
          </>
        }
      />

      {/* ── Hours against the commitment ─────────────────────────────────── */}
      {/*
       * The hero band. Time is the one number that decides whether any of the
       * others mean anything, so it is the only figure on the screen and it
       * sits on the accent field alone — the rest of the week is read after
       * this, not alongside it.
       *
       * The streak rides here as a `Status` rather than as the second `Figure`
       * it used to be on `/calendar`. A week you have already kept is context
       * for the hours; it is not a second thing to look at.
       */}
      <HeroBand
        className="rise"
        style={stagger(1)}
        field={
          <>
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
            {/* Not "you are behind" and never a daily count: §8 screen 6 spends
                a whole interaction refusing to build guilt mechanics, and a
                streak is where they come back. */}
            {commitment.weeksKept > 0 ? (
              <Status tone="verified">
                {weeks(commitment.weeksKept)} running, kept
              </Status>
            ) : null}
          </>
        }
      />

      {/* ── What moved, and what is slipping ─────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(2)}>
        <SectionHead label="The week" title="Where it went" />

        <WeekDigest digest={digest} />
      </section>

      {/* ── The month ────────────────────────────────────────────────────── */}
      {/*
       * The rule the grid is built on: **a date is only as good as what it rests
       * on, and it says which.** Work you did is recorded, a queued question or
       * a deadline you set is due, and everything else — when a claim lapses,
       * when a checkpoint lands — is where the arithmetic points, drawn
       * differently and labelled as a projection. §4.2 law 3 forbids
       * overclaiming; on a calendar the temptation to overclaim is the dates.
       */}
      <section className="rise flex flex-col gap-6" style={stagger(3)}>
        <SectionHead
          label="The month"
          title={calendar.label}
          action={
            <span className="flex items-center gap-4">
              <Link
                href={`/progress?month=${calendar.previousMonth}`}
                className="font-[550] text-accent underline-offset-4 hover:underline"
              >
                Earlier
              </Link>
              <Link
                href={`/progress?month=${calendar.nextMonth}`}
                className="font-[550] text-accent underline-offset-4 hover:underline"
              >
                Later
              </Link>
            </span>
          }
        />

        <CalendarMonth
          label={calendar.label}
          weeks={calendar.weeks}
          hasMarks={calendar.hasMarks}
          next={calendar.next}
        />
      </section>

      {/* ── What's coming ────────────────────────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(4)}>
        <SectionHead label="Ahead" title="What's coming" />

        {calendar.ahead.length > 0 ? (
          <RowList>
            {calendar.ahead.map((entry) => {
              // Overdue is a fact about a date that has passed, so it is only
              // ever said about something that was actually owed.
              const waiting = entry.certainty === "due" && entry.day < today;
              return (
                <Row key={`${entry.day}-${entry.kind}-${entry.title}`}>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-[550] text-ink">{entry.title}</span>
                    <Meta>{entry.detail}</Meta>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {waiting ? (
                      <Status tone="attention">Waiting</Status>
                    ) : (
                      // The date is the reason the row is in this list, so it
                      // is set in the row's own ink rather than in the faint
                      // grey the qualifier under it uses.
                      <span className="text-[length:var(--text-label-size)] font-[650] text-ink tabular-nums">
                        {shortDate(entry.day)}
                      </span>
                    )}
                    <Meta>{relativeDay(today, entry.day)}</Meta>
                  </span>
                </Row>
              );
            })}
          </RowList>
        ) : (
          <Card>
            {/*
              Two empty states, because there are two different reasons to be
              empty and only one of them means "there is nothing".

              A learner whose path has just been built has five dated hand-ins
              and an empty list here, because this band deliberately excludes
              checkpoints — they are priced in their own band below. Told
              "nothing is waiting on you", they reasonably conclude the build
              produced nothing. So when there *is* dated work, this says where
              it went.
            */}
            <Meta>
              {checkpoints.length > 0
                ? "Nothing is due yet: no questions are coming back to you and nothing has stopped counting. What you are working towards is dated below."
                : "Nothing is waiting on you and nothing is due. Today’s session is the whole of it."}
            </Meta>
          </Card>
        )}
      </section>

      {/* ── What's ahead: the whole course, then each hand-in ─────────────── */}
      {/*
       * The band the merge earned. `/progress` priced the whole course at two
       * paces and `/calendar` priced every checkpoint at the same two, on two
       * screens, under two headings. It is one question asked at two
       * granularities: when do I finish, and when is each thing due.
       */}
      <section className="rise flex flex-col gap-6" style={stagger(5)}>
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

        {!calendar.hasPath ? (
          <Card className="flex flex-col items-start gap-4">
            <Meta>
              Your path hasn&rsquo;t been built yet, so there is nothing to put
              a date on.
            </Meta>
            <Link
              href="/path"
              className="font-[550] text-accent underline-offset-4 hover:underline"
            >
              Build my path
            </Link>
          </Card>
        ) : checkpoints.length > 0 ? (
          <>
            <Lead>
              Each one is a piece of work to hand in. The dates are arithmetic,
              not a promise: the hours still owed, divided by a pace.
            </Lead>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {checkpoints.map((checkpoint) => (
                <li key={checkpoint.title}>
                  <Card className="flex flex-col gap-3 p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
                      <Title className="text-[length:var(--text-lead-size)]">
                        {checkpoint.title}
                      </Title>
                      {checkpoint.graded ? (
                        <Status tone="verified">Marked against a rubric</Status>
                      ) : null}
                    </div>
                    <Meta>
                      About {hours(checkpoint.hoursAway)} of work between here
                      and it.
                    </Meta>
                    {/*
                      The date, set like the fact it is.

                      Both dates used to be inside `Meta` — 13px, faint, the
                      smallest type on a card whose entire purpose is to tell
                      you when something lands. The pace each one rests on is
                      the qualifier, so the qualifier is what takes the small
                      type, and the date takes the line.
                    */}
                    <div className="flex flex-wrap gap-x-10 gap-y-3 border-t border-hairline pt-3">
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[length:var(--text-lead-size)] font-[650] text-ink tabular-nums">
                          {shortDate(checkpoint.day)}
                        </span>
                        <Meta tone="muted">
                          at the {hours(commitment.weeklyHours)} a week you set
                          aside
                        </Meta>
                      </span>
                      {/* The same second estimate the card above gives for the
                          whole course, per hand-in. */}
                      {checkpoint.dayAtActualPace === null ? (
                        <Meta>
                          Nothing logged this week, so there is no second date
                          to give you
                        </Meta>
                      ) : (
                        <span className="flex flex-col gap-0.5">
                          <span className="text-[length:var(--text-lead-size)] font-[650] text-ink tabular-nums">
                            {shortDate(checkpoint.dayAtActualPace)}
                          </span>
                          <Meta>
                            at the {hours(commitment.thisWeekHours)} you
                            actually did
                          </Meta>
                        </span>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
            {/*
              Two different problems, so two different sentences. A plan that
              does not fit is the planner's to compress; a pace that does not
              keep up is the learner's to decide about.

              Both are Signals, and this is the band that most needed one: the
              single actionable fact among a screen of dates — *you will not make
              it*. The two are mutually exclusive by construction
              (`deadlineVerdict` returns one verdict), so the band still carries
              at most one marked edge.
            */}
            {late?.verdict === "plan" ? (
              <Signal
                tone="attention"
                state="More work than time"
                title={`The plan does not fit ${formatDeadline(late.deadline)}`}
              >
                <Lead>
                  Even at the {hours(commitment.weeklyHours)} a week you set
                  aside, a checkpoint lands after it. Today&rsquo;s session
                  already takes the date into account, and will drop work to
                  make it rather than let you arrive late.
                </Lead>
              </Signal>
            ) : null}
            {late?.verdict === "pace" ? (
              <Signal
                tone="attention"
                state="Behind the pace, not the plan"
                title={`At last week’s pace you miss ${formatDeadline(late.deadline)}`}
              >
                <Lead>
                  The plan itself fits. At the{" "}
                  {hours(commitment.thisWeekHours)} you did last week it does
                  not — a checkpoint lands after the date.
                </Lead>
              </Signal>
            ) : null}
          </>
        ) : (
          <Card>
            <Meta>
              Nothing left on your path has a hand-in attached to it.
            </Meta>
          </Card>
        )}
      </section>

      {yourCourses}
    </AppFrame>
  );
}
