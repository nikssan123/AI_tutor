// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LogoMark, Wordmark } from "@/components/logo";
import { light } from "@/lib/theme";

/**
 * The mark's rules are the ones a redraw would quietly break: the two strokes
 * have to stay two different colours, the accent has to stay a token rather
 * than a literal, and the name has to stay real text.
 */

afterEach(cleanup);

function paths(container: HTMLElement) {
  return [...container.querySelectorAll("path")];
}

describe("LogoMark", () => {
  it("draws the M in two strokes, only one of which is the accent", () => {
    // The whole idea of the mark: the arm that overshoots is the verified
    // stroke, so it cannot inherit the ink the rest of the M uses.
    const { container } = render(<LogoMark />);
    expect(paths(container).map((p) => p.getAttribute("stroke"))).toEqual([
      "currentColor",
      "var(--accent)",
    ]);
  });

  it("names the accent as a token, never as a hex value", () => {
    // §8.5.4 — a palette written twice is a palette that diverges. A literal
    // here would be correct in light and wrong in dark, invisibly.
    const { container } = render(<LogoMark />);
    expect(container.innerHTML).not.toContain(light.accent);
  });

  it("starts the arm where the valley ends, so the M cannot come apart", () => {
    const { container } = render(<LogoMark />);
    const [stem, arm] = paths(container).map((p) => p.getAttribute("d"));
    expect(stem?.endsWith("l7 7.5")).toBe(true);
    expect(arm?.startsWith("M11.25 16.25")).toBe(true);
  });

  it("keeps the icon set's grid and stroke", () => {
    const { container } = render(<LogoMark />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke-width")).toBe("1.5");
  });

  it("is decorative: the name beside it is the accessible one", () => {
    const { container } = render(<LogoMark />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("takes a className without dropping its own sizing", () => {
    const { container } = render(<LogoMark className="text-accent" />);
    const cls = container.querySelector("svg")!.getAttribute("class")!;
    expect(cls).toContain("text-accent");
    expect(cls).toContain("size-[1.15em]");
  });
});

describe("Wordmark", () => {
  it("says the name as text, so it can be read out and copied", () => {
    render(<Wordmark />);
    expect(screen.getByText("MeritKeep")).toBeTruthy();
  });

  it("carries the mark with it", () => {
    const { container } = render(<Wordmark />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("takes a className without dropping the type treatment", () => {
    const { container } = render(<Wordmark className="opacity-70" />);
    const cls = container.firstElementChild!.getAttribute("class")!;
    expect(cls).toContain("opacity-70");
    expect(cls).toContain("font-[650]");
  });
});
