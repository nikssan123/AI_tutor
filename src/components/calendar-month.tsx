import Link from "next/link";
import { CERTAINTIES, type DayCell } from "@/lib/calendar/month";
import { monthLabel, monthOf, shortDate, WEEKDAYS } from "@/lib/calendar/dates";
import type { CalendarEntry, Certainty } from "@/lib/calendar/schedule";
import { Card, cx, Meta } from "@/components/ui";

/**
 * A month of the learner's own calendar, as squares.
 *
 * The rule the grid is built on: **a date is only as good as what it rests on,
 * and it says which.** Work you did is recorded, a queued question or a deadline
 * you set is due, and everything else — when a claim lapses, when a checkpoint
 * lands — is where the arithmetic points, drawn differently and labelled as a
 * projection. §4.2 law 3 forbids overclaiming; on a calendar the temptation to
 * overclaim is the dates.
 *
 * It lived inside `/progress` and is a component because a month is about to be
 * asked for in a second place — see `ASSISTANT-PLAN.md` §6. The point of pulling
 * it out is that the second place renders *this*, not a chat-flavoured imitation
 * of it: one grid, one legend, one set of empty states, both themes, and any
 * correction lands everywhere at once.
 *
 * The month *navigation* deliberately stayed on the page. Earlier/Later belong
 * to a screen that owns a URL; a month quoted somewhere else is a view of a
 * date, not a place you page through.
 */

/** §8.5.5 — a mark plus a word, never colour on its own. */
const LEGEND: Record<Certainty, string> = {
  recorded: "You worked",
  due: "Due",
  projected: "Projected",
};

/**
 * The day number, in the colour of the strongest thing on that day.
 *
 * The same three hues as the bar under it, so a day reads as one object rather
 * than as a number with an unrelated stripe. `--accent` and `--attention` are
 * the tokens `Status` already sets text in, so the contrast is measured rather
 * than assumed.
 *
 * Projected is `--planned`, which exists because of this screen. It had been
 * `--ink-muted` — quieter than an ordinary day — so on the calendar of somebody
 * whose path has just been built, where every dated thing is a projection, the
 * only marks on the month were drawn in the faintest ink available. See the
 * token's note in `theme.ts` for why it is not simply the accent.
 */
const NUMERAL: Record<Certainty, string> = {
  recorded: "text-accent",
  due: "text-attention",
  projected: "text-planned",
};

/**
 * The three marks: a bar under the day, in the colour of what sits on it.
 *
 * **It was a 6px dot, and one of the three was a hairline ring.** A projected
 * day — which is every day on the calendar of somebody whose path has just been
 * built — carried its entire meaning in a hollow circle of `--ink-faint` a
 * third the height of the numeral beside it, on a square tinted `--raised`,
 * which in light *is* `--surface`. Nothing marked anything, and the report was
 * the obvious one: the dates are hardly visible.
 *
 * The mistake underneath it was encoding *uncertainty* as *low contrast*. A
 * projection is not a promise, and the way to say so is hue and the legend that
 * spells it out — not by drawing the only thing on the calendar in the faintest
 * ink available. A bar carries several times the ink of a dot at the same
 * width, which buys the legibility without a ring round the numeral or a box
 * behind it: the grid stays a grid, and today's filled disc stays the one thing
 * on it that is filled.
 *
 * Recorded is the accent, because the accent means *verified* and a session you
 * finished is the only thing here that happened.
 */
function Mark({ certainty }: { certainty: Certainty }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        // `w-4` is the width it wants; flex shrinks it when a day carries all
        // three and the column is a phone's width, rather than pushing the
        // marks out of the square.
        "inline-block h-[3px] w-4 rounded-full",
        certainty === "recorded" && "bg-accent",
        certainty === "due" && "bg-attention",
        certainty === "projected" && "bg-planned",
      )}
    />
  );
}

export function CalendarMonth({
  label,
  weeks,
  hasMarks,
  next,
}: {
  /** The month in words, as `CalendarView` already formats it. */
  label: string;
  weeks: DayCell[][];
  /** Whether the month on screen has anything on it at all. */
  hasMarks: boolean;
  /** The next dated thing this month does not reach, if there is one. */
  next: CalendarEntry | undefined;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <Meta key={day} className="py-1 text-center">
            {day}
          </Meta>
        ))}
      </div>

      {weeks.map((week) => (
        <ul
          // Seven by construction, so the row's first day names it.
          key={week[0]!.day}
          className="m-0 grid list-none grid-cols-7 gap-1 p-0"
        >
          {week.map((cell) => {
            const marked = cell.certainties.length > 0;

            return (
              <li
                key={cell.day}
                /* `group` and `relative` for the card below; the tab stop so
                   it is not hover-only for anybody driving by keyboard. Only
                   days that have something to say become stops. */
                className={cx(
                  "relative flex min-h-14 flex-col items-center gap-1.5 rounded-[var(--radius-control)] py-2",
                  cell.description &&
                    "group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                )}
                tabIndex={cell.description ? 0 : undefined}
              >
                <span
                  className={cx(
                    "flex size-6 items-center justify-center rounded-full text-[length:var(--text-meta-size)] tabular-nums",
                    /*
                     * Exactly one colour class, chosen here rather than
                     * layered as conditions. Two competing `text-*`
                     * utilities resolve by stylesheet order, not by the order
                     * they appear in the attribute — see `Meta` in
                     * components/ui, which learned this the hard way.
                     */
                    cell.isToday
                      ? "bg-accent font-[650] text-on-accent"
                      : marked
                        ? cx(NUMERAL[cell.certainties[0]!], "font-[650]")
                        : cell.inMonth
                          ? "text-ink"
                          : // Padding days are real days and stay readable,
                            // quietly: a session on the 31st belongs where you
                            // would look for it.
                            "text-ink-faint",
                  )}
                >
                  {Number(cell.day.slice(8))}
                </span>
                {/* Bounded and centred, so three marks on one day shrink to
                    fit the column instead of widening it. */}
                <span className="flex h-[3px] w-full max-w-16 items-center justify-center gap-1">
                  {cell.certainties.map((certainty) => (
                    <Mark key={certainty} certainty={certainty} />
                  ))}
                </span>
                {/* §8.5.5 bans colour as the sole carrier of meaning, and a
                    grid of marks is exactly where that would happen. */}
                {cell.description ? (
                  <span className="sr-only">{cell.description}</span>
                ) : null}

                {/*
                 * What is on the day, on hover and on focus.
                 *
                 * The grid can only ever carry three hues and a date; the
                 * sentence saying *which* checkpoint lands on the 25th lived
                 * in a list further down the page, or in a screen reader's
                 * ear, and for anybody with a mouse it was a scroll away from
                 * the square they were pointing at.
                 *
                 * It is a card, not a tooltip: the same surface, hairline and
                 * elevation every other card on the product uses, so it
                 * belongs to the page rather than looking like something the
                 * browser drew. One row per thing, each carrying the mark it
                 * has in the grid, so the card explains the square rather
                 * than repeating it.
                 *
                 * `aria-hidden`, because the `sr-only` line above already
                 * says all of it and hearing it twice is worse than once. And
                 * CSS only — a card on hover is not worth a byte of
                 * JavaScript on a screen that works without any.
                 */}
                {cell.items.length > 0 ? (
                  <span
                    aria-hidden="true"
                    className={cx(
                      "pointer-events-none invisible absolute bottom-[calc(100%+8px)] left-1/2 z-20",
                      "flex w-max max-w-64 -translate-x-1/2 flex-col gap-2.5 text-left",
                      "rounded-[var(--radius-card)] border border-hairline bg-raised p-3.5",
                      "opacity-0 shadow-[var(--shadow-raised)]",
                      "transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                      "group-hover:visible group-hover:opacity-100",
                      "group-focus-visible:visible group-focus-visible:opacity-100",
                    )}
                  >
                    <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                      {shortDate(cell.day)}
                    </span>

                    {cell.items.map((item) => (
                      <span
                        key={`${item.kind}-${item.title}`}
                        className="flex items-start gap-2.5"
                      >
                        <span className="mt-[7px] flex shrink-0">
                          <Mark certainty={item.certainty} />
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-[length:var(--text-meta-size)] font-[550] leading-[var(--text-meta-line)] text-ink">
                            {item.title}
                          </span>
                          <Meta>{item.detail}</Meta>
                        </span>
                      </span>
                    ))}

                    {/* The point of the card, drawn as a corner of it: same
                        fill, same hairline, two sides showing. */}
                    <span className="absolute -bottom-[5px] left-1/2 size-2 -translate-x-1/2 rotate-45 border-r border-b border-hairline bg-raised" />
                  </span>
                ) : null}
              </li>
            );
          })}
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
      {/*
       * A month with nothing on it, saying which.
       *
       * The grid could not tell the difference between "your calendar is
       * empty" and "everything on it is in September", and a learner who
       * had just watched a path get built read the first when the second
       * was true — five dated hand-ins, four of them past the end of this
       * grid. A calendar that cannot say where its own dates went is a
       * calendar people stop opening.
       */}
      {!hasMarks ? (
        <Meta>
          {next ? (
            <>
              Nothing lands in {label}. The next thing on your calendar is{" "}
              {shortDate(next.day)} &mdash;{" "}
              <Link
                href={`/progress?month=${monthOf(next.day)}`}
                className="font-[550] text-accent underline-offset-4 hover:underline"
              >
                {monthLabel(monthOf(next.day))}
              </Link>
              .
            </>
          ) : (
            <>
              Nothing lands in {label} yet. Days fill in as you work, as
              questions come back to you, and as the work you hand in gets
              dated.
            </>
          )}
        </Meta>
      ) : null}
      <Meta tone="muted">
        Projected days move as your pace does. Nothing on them has been promised
        to you.
      </Meta>
    </Card>
  );
}
