import { cx } from "@/components/ui";

/**
 * A real `<table>`, which §8.5.5 forbids — "row list, not a data table" — and
 * which this surface is the documented exception to.
 *
 * The rule exists because a learner reading their own record is reading a small
 * number of meaningful things, and a grid turns those into a spreadsheet. An
 * operator comparing forty rows across twelve columns is doing the opposite
 * job, and a row list makes it impossible: values stop aligning, so scanning a
 * column for the odd one out — the entire reason to open this page — no longer
 * works. `src/app/admin/page.tsx` already carved out `Stat` on the same
 * grounds, and this is the same carve-out for the same reason.
 *
 * Two layout decisions carry the whole thing, and the first version got both
 * wrong in a way that made the `user` table unreadable:
 *
 * - The table is `min-w-full`, not `w-full`. `w-full` pins it to the visible
 *   width, so the browser compresses fourteen columns into the viewport
 *   instead of letting the wrapper scroll. The wrapper owns the sideways
 *   scroll; the table is allowed to be wider than it.
 * - Cells do not wrap. A wrapping cell's min-content width is one character,
 *   so the auto table layout stops allocating width by content and allocates
 *   it by *header name* instead — which handed `stripe_customer_id` 173px of
 *   nulls while squeezing `id` to 56px and shredding it down a five-line
 *   tower. Content sets the width now, and anything genuinely long is clipped
 *   with an ellipsis rather than allowed to wrap.
 *
 * `border-separate` rather than `border-collapse` because a sticky cell loses
 * its borders under `collapse`; the row rule moves onto the cells instead.
 */
export function DataGrid({
  columns,
  rows,
  align,
  stickyLast = false,
  empty = "No rows.",
}: {
  columns: React.ReactNode[];
  rows: React.ReactNode[][];
  /** Column indexes to right-align — numeric ones, so digits line up. */
  align?: (index: number) => boolean;
  /**
   * Pins the last column to the right edge.
   *
   * For the row-actions column: it is the one column you came to press, and on
   * a table wide enough to scroll it would otherwise sit off-screen behind
   * eleven columns of nulls. Off by default — the SQL console's last column is
   * data, and pinning data would be arbitrary.
   */
  stickyLast?: boolean;
  empty?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] bg-surface px-5 py-8 text-center text-[length:var(--text-meta-size)] text-ink-muted">
        {empty}
      </p>
    );
  }

  const pinned = (index: number) => stickyLast && index === columns.length - 1;

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] bg-surface">
      <table className="min-w-full border-separate border-spacing-0 text-[length:var(--text-meta-size)]">
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th
                key={i}
                scope="col"
                className={cx(
                  "whitespace-nowrap border-b border-hairline bg-surface px-4 py-3 font-[650] text-ink-muted",
                  align?.(i) ? "text-right" : "text-left",
                  pinned(i) && "sticky right-0 z-10 border-l border-hairline",
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="last:[&>td]:border-b-0">
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={cx(
                    "border-b border-hairline px-4 py-3 align-top",
                    align?.(c) ? "text-right tabular-nums" : "text-left",
                    pinned(c) &&
                      "sticky right-0 z-10 border-l border-hairline bg-surface",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A value in a grid cell.
 *
 * One line, always. It is clipped at a width that fits a UUID and a plausible
 * email — the two things you identify a row by — and the full text stays
 * reachable as the native tooltip. Wrapping instead would be worse than
 * useless here: it costs the column its width in the auto layout, which is
 * what turned every id into a vertical tower of two-character fragments.
 *
 * `null` is drawn faint and italic so an actual null is distinguishable at a
 * glance from the four-character string "null" — a distinction that matters
 * constantly when reading a database and never anywhere else.
 */
export function Cell({ value }: { value: string }) {
  if (value === "null") {
    return <span className="text-ink-faint italic">null</span>;
  }
  // `inline-block`, not `block`: a block element takes its full max-width
  // whatever it contains, so every cell would claim 40ch and a 13-character id
  // would reserve the same 345px as a long one. Inline-block sizes to the
  // content and only the cap bites.
  return (
    <span
      title={value}
      className="inline-block max-w-[40ch] truncate align-bottom font-mono"
    >
      {value}
    </span>
  );
}
