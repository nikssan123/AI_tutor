import { relativeDay, shortDate } from "@/lib/calendar/dates";
import type { CalendarEntry } from "@/lib/calendar/schedule";
import type { DayKey } from "@/lib/calendar/dates";
import { Card, Meta, Row, RowList, Status } from "@/components/ui";

/**
 * Everything that has not happened yet — overdue first, then soonest.
 *
 * Pulled out of `/progress` for the reason `CalendarMonth` was
 * (`ASSISTANT-PLAN.md` §6): "what's next" is about to be a question a learner
 * can ask anywhere, and the answer has to be this list rather than a second
 * description of it.
 *
 * The only page-specific thing in here was one sentence, so that is the only
 * prop that varies. Everything else — what counts as overdue, how a date is
 * set against the qualifier under it — is a claim about the learner's plan and
 * must read identically wherever it appears.
 */
export function AheadList({
  entries,
  today,
  hasCheckpoints,
  pendingNote = "Nothing is due yet: no questions are coming back to you and nothing has stopped counting. What you are working towards is dated on your progress page.",
}: {
  /** Already ordered by `calendarFor`; this does not re-sort. */
  entries: CalendarEntry[];
  today: DayKey;
  /**
   * Whether the learner has dated hand-ins that this list deliberately
   * excludes — they are priced in their own band, so an empty list with
   * checkpoints behind it means something different from an empty one without.
   */
  hasCheckpoints: boolean;
  /**
   * What to say when there is nothing due but there *are* checkpoints.
   *
   * The default points at `/progress`, which is right everywhere except on
   * `/progress` itself — where the checkpoints are further down the same page
   * and "go and look at this page" would be a link to where you already are.
   */
  pendingNote?: string;
}) {
  if (entries.length === 0) {
    return (
      <Card>
        {/*
          Two empty states, because there are two different reasons to be empty
          and only one of them means "there is nothing".

          A learner whose path has just been built has five dated hand-ins and
          an empty list here. Told "nothing is waiting on you", they reasonably
          conclude the build produced nothing. So when there *is* dated work,
          this says where it went.
        */}
        <Meta>
          {hasCheckpoints
            ? pendingNote
            : "Nothing is waiting on you and nothing is due. Today’s session is the whole of it."}
        </Meta>
      </Card>
    );
  }

  return (
    <RowList>
      {entries.map((entry) => {
        // Overdue is a fact about a date that has passed, so it is only ever
        // said about something that was actually owed.
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
                // The date is the reason the row is in this list, so it is set
                // in the row's own ink rather than in the faint grey the
                // qualifier under it uses.
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
  );
}
