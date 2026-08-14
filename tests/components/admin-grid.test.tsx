// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Cell, DataGrid } from "@/components/admin-grid";

/**
 * The operator grid — §8.5.5's documented exception to "row list, not a data
 * table". These assert the two things that make it worth the exception: values
 * line up in columns, and the sideways scroll belongs to the grid rather than
 * to the page.
 */

afterEach(cleanup);

describe("DataGrid", () => {
  const COLUMNS = ["id", "email"];
  const ROWS = [
    [<Cell key="a" value="u1" />, <Cell key="b" value="a@example.com" />],
    [<Cell key="a" value="u2" />, <Cell key="b" value="b@example.com" />],
  ];

  it("renders a real table with header cells", () => {
    render(<DataGrid columns={COLUMNS} rows={ROWS} />);

    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("scopes its headers, so a screen reader can announce them", () => {
    render(<DataGrid columns={COLUMNS} rows={ROWS} />);

    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.getAttribute("scope")).toBe("col");
    }
  });

  it("owns its horizontal scroll", () => {
    // A forty-column table must not make the whole document scroll sideways.
    const { container } = render(<DataGrid columns={COLUMNS} rows={ROWS} />);

    expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
  });

  it("is allowed to be wider than the wrapper", () => {
    // `w-full` pins the table to the visible width, so the browser compresses
    // every column to fit and the wrapper's scroll never engages. `min-w-full`
    // is what makes the sideways scroll real.
    const { container } = render(<DataGrid columns={COLUMNS} rows={ROWS} />);
    const table = container.querySelector("table")!;

    expect(table.className).toContain("min-w-full");
    expect(table.className).not.toMatch(/(^|\s)w-full(\s|$)/);
  });

  it("separates borders, so a pinned cell keeps them", () => {
    const { container } = render(<DataGrid columns={COLUMNS} rows={ROWS} />);

    expect(container.querySelector("table")!.className).toContain(
      "border-separate",
    );
  });

  describe("stickyLast", () => {
    it("pins the last column when asked", () => {
      // The actions column is the one you came to press; on a table wide
      // enough to scroll it would otherwise sit off-screen.
      const { container } = render(
        <DataGrid columns={COLUMNS} rows={ROWS} stickyLast />,
      );

      const headers = [...container.querySelectorAll("thead th")];
      expect(headers.at(-1)!.className).toContain("sticky");
      expect(headers[0]!.className).not.toContain("sticky");

      const cells = [...container.querySelectorAll("tbody tr")].map(
        (row) => [...row.querySelectorAll("td")].at(-1)!,
      );
      // Opaque, or the scrolled columns show through it.
      for (const cell of cells) {
        expect(cell.className).toContain("sticky");
        expect(cell.className).toContain("bg-surface");
      }
    });

    it("pins nothing by default", () => {
      // The SQL console's last column is data; pinning it would be arbitrary.
      const { container } = render(<DataGrid columns={COLUMNS} rows={ROWS} />);

      for (const cell of container.querySelectorAll("th, td")) {
        expect(cell.className).not.toContain("sticky");
      }
    });
  });

  it("shows the empty message instead of an empty table", () => {
    render(<DataGrid columns={COLUMNS} rows={[]} empty="Nothing here." />);

    expect(screen.getByText("Nothing here.")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("has a default empty message", () => {
    render(<DataGrid columns={COLUMNS} rows={[]} />);
    expect(screen.getByText("No rows.")).toBeDefined();
  });

  it("right-aligns the columns it is told to", () => {
    const { container } = render(
      <DataGrid columns={COLUMNS} rows={ROWS} align={(i) => i === 1} />,
    );

    const cells = [...container.querySelectorAll("tbody td")];
    expect(cells[0]!.className).toContain("text-left");
    // Numeric columns get tabular figures so digits line up down the column.
    expect(cells[1]!.className).toContain("text-right");
    expect(cells[1]!.className).toContain("tabular-nums");
  });

  it("left-aligns everything when not told otherwise", () => {
    const { container } = render(<DataGrid columns={COLUMNS} rows={ROWS} />);

    for (const cell of container.querySelectorAll("tbody td")) {
      expect(cell.className).toContain("text-left");
    }
  });
});

describe("Cell", () => {
  it("draws an actual null differently from the string", () => {
    // Constantly needed when reading a database, and nowhere else.
    const { container } = render(<Cell value="null" />);
    const span = container.querySelector("span")!;

    expect(span.className).toContain("italic");
    expect(span.className).not.toContain("font-mono");
  });

  it("renders values in monospace so columns align", () => {
    const { container } = render(<Cell value="abc" />);

    expect(container.querySelector("span")!.className).toContain("font-mono");
  });

  it("clips a long value on one line rather than wrapping it", () => {
    // Wrapping cost the column its width in the auto table layout — a wrapped
    // cell's min-content width is one character — which is what turned every
    // id into a five-line tower and pushed `email` off the visible area.
    const { container } = render(<Cell value={"x".repeat(200)} />);
    const span = container.querySelector("span")!;

    expect(span.className).toContain("truncate");
    expect(span.className).not.toContain("break-all");
    expect(span.className).toContain("max-w-[40ch]");
  });

  it("sizes to its content rather than claiming the whole cap", () => {
    // `block` would take the full max-width whatever it holds, so a
    // 13-character id would reserve the same width as a 40-character one and
    // the columns after it would be pushed off-screen.
    const { container } = render(<Cell value="short" />);

    expect(container.querySelector("span")!.className).toContain(
      "inline-block",
    );
  });

  it("keeps the full value reachable as a tooltip", () => {
    const value = "a".repeat(80);
    const { container } = render(<Cell value={value} />);

    expect(container.querySelector("span")!.getAttribute("title")).toBe(value);
  });
});
