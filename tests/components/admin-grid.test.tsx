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

  it("breaks long values rather than stretching the column", () => {
    const { container } = render(<Cell value={"x".repeat(200)} />);

    expect(container.querySelector("span")!.className).toContain("break-all");
  });
});
