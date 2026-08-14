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
 * The horizontal scroll is owned by the wrapper, not the page. A forty-column
 * table must not make the whole document scroll sideways.
 */
export function DataGrid({
  columns,
  rows,
  align,
  empty = "No rows.",
}: {
  columns: React.ReactNode[];
  rows: React.ReactNode[][];
  /** Column indexes to right-align — numeric ones, so digits line up. */
  align?: (index: number) => boolean;
  empty?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] bg-surface px-5 py-8 text-center text-[length:var(--text-meta-size)] text-ink-muted">
        {empty}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] bg-surface">
      <table className="w-full border-collapse text-[length:var(--text-meta-size)]">
        <thead>
          <tr className="border-b border-hairline">
            {columns.map((column, i) => (
              <th
                key={i}
                scope="col"
                className={cx(
                  "whitespace-nowrap px-4 py-3 font-[650] text-ink-muted",
                  align?.(i) ? "text-right" : "text-left",
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-hairline last:border-b-0">
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={cx(
                    "px-4 py-3 align-top",
                    align?.(c) ? "text-right tabular-nums" : "text-left",
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
 * `null` is drawn faint and italic so an actual null is distinguishable at a
 * glance from the four-character string "null" — a distinction that matters
 * constantly when reading a database and never anywhere else.
 */
export function Cell({ value }: { value: string }) {
  if (value === "null") {
    return <span className="text-ink-faint italic">null</span>;
  }
  return <span className="font-mono break-all">{value}</span>;
}
