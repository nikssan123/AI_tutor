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
import { CERTAINTIES } from "@/lib/calendar/month";
import { relativeDay, shortDate, WEEKDAYS } from "@/lib/calendar/dates";
import { formatDeadline } from "@/lib/goals/captured-display";
import { CourseList } from "@/components/course-list";
import { NothingRunning } from "@/components/nothing-running";
import {
  Card,
  cx,
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
import { ArrowIcon } from "@/components/icons";
import type { Certainty } from "@/lib/calendar/schedule";

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

/** §8.5.5 — a dot plus a word, never colour on its own. */
const LEGEND: Record<Certainty, string> = {
  recorded: "You worked",
  due: "Due",
  projected: "Projected",
};

function hours(value: number): string {
  return `${value} ${value === 1 ? "hour" : "hours"}`;
}

function weeks(value: number): string {
  return `${value} ${value === 1 ? "week" : "weeks"}`;
}

/**
 * The three marks. Recorded is the accent, because the accent means *verified*
 * and a session you finished is the only thing on this grid that happened.
 */
function Mark({ certainty }: { certainty: Certainty }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block size-1.5 rounded-full",
        certainty === "recorded" && "bg-accent",
        certainty === "due" && "bg-attention",
        // Hollow: nothing has happened, and nothing is owed. It is a guess with
        // arithmetic behind it, and it should look like one.
        certainty === "projected" && "border border-ink-faint",
      )}
    />
  );
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

        <Card className="flex flex-col gap-3">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day) => (
              <Meta key={day} className="py-1 text-center">
                {day}
              </Meta>
            ))}
          </div>

          {calendar.weeks.map((week) => (
            <ul
              // Seven by construction, so the row's first day names it.
              key={week[0]!.day}
              className="m-0 grid list-none grid-cols-7 gap-1 p-0"
            >
              {week.map((cell) => (
                <li
                  key={cell.day}
                  className={cx(
                    "flex min-h-14 flex-col items-center gap-1.5 rounded-[var(--radius-control)] py-2",
                    cell.certainties.length > 0 && "bg-raised",
                  )}
                >
                  <span
                    className={cx(
                      "flex size-6 items-center justify-center rounded-full text-[length:var(--text-meta-size)] tabular-nums",
                      cell.isToday && "bg-accent font-[650] text-on-accent",
                      !cell.isToday && cell.inMonth && "text-ink",
                      // Padding days are real days and stay readable, quietly:
                      // a session on the 31st belongs where you would look.
                      !cell.isToday && !cell.inMonth && "text-ink-faint",
                    )}
                  >
                    {Number(cell.day.slice(8))}
                  </span>
                  <span className="flex h-1.5 items-center gap-1">
                    {cell.certainties.map((certainty) => (
                      <Mark key={certainty} certainty={certainty} />
                    ))}
                  </span>
                  {/* §8.5.5 bans colour as the sole carrier of meaning, and a
                      grid of dots is exactly where that would happen. */}
                  {cell.description ? (
                    <span className="sr-only">{cell.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ))}

          <div className="flex flex-wrap gap-x-5 gap-y-3 border-t border-hairline pt-4">
            {CERTAINTIES.map((certainty) => (
              <span key={certainty} className="flex items-center gap-2">
                <Mark certainty={certainty} />
                <Meta>{LEGEND[certainty]}</Meta>
              </span>
            ))}
          </div>
          <Meta tone="muted">
            Projected days move as your pace does. Nothing on them has been
            promised to you.
          </Meta>
        </Card>
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
                      // `tone`, not a class: two competing `text-ink-*`
                      // utilities resolve by stylesheet order, so an override
                      // here works or does not depending on what Tailwind
                      // emitted last (see `Meta` in components/ui).
                      <Meta tone="muted">{shortDate(entry.day)}</Meta>
                    )}
                    <Meta>{relativeDay(today, entry.day)}</Meta>
                  </span>
                </Row>
              );
            })}
          </RowList>
        ) : (
          <Card>
            <Meta>
              Nothing is waiting on you and nothing is due. Today&rsquo;s
              session is the whole of it.
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
                    <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-hairline pt-3">
                      <Meta tone="muted">
                        {shortDate(checkpoint.day)} at the{" "}
                        {hours(commitment.weeklyHours)} a week you set aside
                      </Meta>
                      {/* The same second estimate the card above gives for the
                          whole course, per hand-in. */}
                      {checkpoint.dayAtActualPace === null ? (
                        <Meta>
                          Nothing logged this week, so there is no second date
                          to give you
                        </Meta>
                      ) : (
                        <Meta>
                          {shortDate(checkpoint.dayAtActualPace)} at the{" "}
                          {hours(commitment.thisWeekHours)} you actually did
                        </Meta>
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
