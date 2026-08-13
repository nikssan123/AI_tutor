import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { calendarFor } from "@/lib/calendar/view";
import { standingFor } from "@/lib/goals/standing";
import { deadlineVerdict } from "@/lib/calendar/checkpoints";
import { CERTAINTIES } from "@/lib/calendar/month";
import { relativeDay, shortDate, WEEKDAYS } from "@/lib/calendar/dates";
import { formatDeadline } from "@/lib/goals/captured-display";
import { CalendarIcon } from "@/components/icons";
import { NothingRunning, PickBackUp } from "@/components/nothing-running";
import {
  Card,
  cx,
  Figure,
  Lead,
  Meta,
  Row,
  RowList,
  stagger,
  Status,
  Title,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import type { Certainty } from "@/lib/calendar/schedule";

/**
 * The calendar — what the product has a date for, on one screen.
 *
 * §2.4 lists accountability as one of the five durable answers to "why not
 * ChatGPT", and names its parts: *scheduled commitments, streaks, overdue work,
 * spaced retrieval*. Every one of those existed in the database already and none
 * of them had a surface. `/today` answers "what now" and refuses to show
 * anything else; `/progress` reports the week that has gone. Nothing said when.
 *
 * The rule the screen is built on: **a date is only as good as what it rests
 * on, and it says which.** Work you did is recorded, a queued question or a
 * deadline you set is due, and everything else — when a claim lapses, when a
 * checkpoint lands — is where the arithmetic points, drawn differently and
 * labelled as a projection. §4.2 law 3 forbids overclaiming; on a calendar the
 * temptation to overclaim is the dates themselves.
 *
 * No percentage anywhere (§24 E9), and no daily streak: see `schedule.ts` for
 * why the one streak here is measured in weeks against the learner's own
 * commitment.
 */
export const metadata: Metadata = {
  title: "Calendar",
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

export default async function CalendarPage({ searchParams }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { month } = await searchParams;
  const view = await calendarFor(getDb(), session.user.id, new Date(), {
    month,
  });

  if (!view) {
    // Not a dead end and not a different learner from the one `/today` knows
    // about: the same offer, in the same words, with this screen's own note on
    // what it will hold once there is something to date.
    const standing = await standingFor(getDb(), session.user.id);

    return (
      <AppFrame width="narrow">
        <AppHeader
          title="Your calendar"
          lead="When the work lands, what comes back to you, and what you have already done. Nothing to date until a course is running."
        />
        <NothingRunning
          standing={standing}
          note="Once a course is running, everything owed and everything already done turns up here."
        />
        <PickBackUp courses={standing.again} />
      </AppFrame>
    );
  }

  const { pack, commitment, checkpoints, deadline, today } = view;
  const toGo = Math.round((commitment.weeklyHours - commitment.thisWeekHours) * 10) / 10;
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
        icon={<CalendarIcon />}
        title="Your calendar"
        lead="What you have done, what comes back to you, and where the work ahead lands."
        facts={
          <>
            <Meta>{pack.name}</Meta>
            <Meta>{hours(commitment.weeklyHours)} a week</Meta>
            {deadline ? <Meta>by {formatDeadline(deadline)}</Meta> : null}
          </>
        }
      />

      {/* ── The commitment ───────────────────────────────────────────────── */}
      {/*
       * The hero band, and the only figure on the screen. §2.4's accountability
       * claim in one number — and measured in weeks against the learner's own
       * commitment, so three hours a week done properly is a kept week rather
       * than four missed days.
       */}
      <Card
        className="rise flex flex-wrap items-center justify-between gap-6 bg-accent-weak"
        style={stagger(1)}
      >
        {commitment.weeksKept > 0 ? (
          <Figure
            value={commitment.weeksKept}
            unit={commitment.weeksKept === 1 ? "week" : "weeks"}
            caption="running, in which you did what you said you would."
          />
        ) : (
          <Figure
            value={commitment.thisWeekHours}
            unit={commitment.thisWeekHours === 1 ? "hour" : "hours"}
            caption={`in the last seven days, of the ${hours(commitment.weeklyHours)} you set aside.`}
          />
        )}
        {commitment.keptThisWeek ? (
          <Status tone="verified">This week is already done</Status>
        ) : (
          // Not "you are behind": the week is not over, and §8 screen 6 spends
          // a whole interaction refusing to build guilt mechanics.
          <Status tone="neutral">{hours(toGo)} to go this week</Status>
        )}
      </Card>

      {/* ── The month ────────────────────────────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(2)}>
        <SectionHead
          label="The month"
          title={view.label}
          action={
            <span className="flex items-center gap-4">
              <Link
                href={`/calendar?month=${view.previousMonth}`}
                className="font-[550] text-accent underline-offset-4 hover:underline"
              >
                Earlier
              </Link>
              <Link
                href={`/calendar?month=${view.nextMonth}`}
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

          {view.weeks.map((week) => (
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
      <section className="rise flex flex-col gap-6" style={stagger(3)}>
        <SectionHead label="Ahead" title="What's coming" />

        {view.ahead.length > 0 ? (
          <RowList>
            {view.ahead.map((entry) => {
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

      {/* ── Checkpoints ──────────────────────────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(4)}>
        <SectionHead label="Milestones" title="Your checkpoints" />

        {!view.hasPath ? (
          <Card className="flex flex-col items-start gap-4">
            <Meta>
              Your path hasn&rsquo;t been built yet, so there is nothing to put
              a date on.
            </Meta>
            <Link
              href={`/goals/${view.goal.id}/path`}
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
                      {/* The honest half, the same one `/progress` shows: the
                          same work priced at the pace actually kept. */}
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
            {/* Two different problems, so two different sentences. A plan that
                does not fit is the planner's to compress; a pace that does not
                keep up is the learner's to decide about. */}
            {late?.verdict === "plan" ? (
              <Card className="flex flex-col gap-2">
                <Status tone="attention">More work than time</Status>
                <Meta>
                  Even at the {hours(commitment.weeklyHours)} a week you set
                  aside, a checkpoint lands after {formatDeadline(late.deadline)}.
                  Today&rsquo;s session already takes the date into account, and
                  will drop work to make it rather than let you arrive late.
                </Meta>
              </Card>
            ) : null}
            {late?.verdict === "pace" ? (
              <Card className="flex flex-col gap-2">
                <Status tone="attention">Behind the pace, not the plan</Status>
                <Meta>
                  The plan fits {formatDeadline(late.deadline)}. At the{" "}
                  {hours(commitment.thisWeekHours)} you did last week it does
                  not — a checkpoint lands after it.
                </Meta>
              </Card>
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
    </AppFrame>
  );
}
