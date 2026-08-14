// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  AppFrame,
  AppHeader,
  AuthFrame,
  SectionHead,
} from "@/components/app-shell";

/**
 * §8.5.9 reached the marketing pages and stopped there. These are the rules it
 * should always have applied to the product screens, pinned so the next screen
 * cannot go back to hand-rolling its own `<main>`.
 */

afterEach(cleanup);

describe("AppFrame — one width, one rhythm (§8.5.9)", () => {
  it("puts a reading screen in the full frame", () => {
    const { container } = render(
      <AppFrame>
        <p>child</p>
      </AppFrame>,
    );
    expect(container.querySelector("main")!.className).toContain("max-w-5xl");
  });

  it("keeps a task screen in the narrow column — the documented exception", () => {
    const { container } = render(
      <AppFrame width="narrow">
        <p>child</p>
      </AppFrame>,
    );
    const main = container.querySelector("main")!;
    expect(main.className).toContain("max-w-2xl");
    expect(main.className).not.toContain("max-w-5xl");
  });

  it("lets the operator's data grid off the measure entirely", () => {
    // A fourteen-column table in `max-w-5xl` does not become readable; it
    // becomes one where the columns you identify a row by are off-screen.
    // Prose is unaffected, because `Lead` carries its own `--measure` cap.
    const { container } = render(
      <AppFrame width="full">
        <p>child</p>
      </AppFrame>,
    );
    const main = container.querySelector("main")!;
    expect(main.className).toContain("max-w-none");
    expect(main.className).not.toContain("max-w-5xl");
    expect(main.className).not.toContain("max-w-2xl");
  });

  /**
   * The mobile nav is `fixed` to the bottom of the viewport, so a frame with
   * no bottom padding puts the last thing on every page underneath it.
   */
  it("leaves room for the mobile bottom bar", () => {
    const { container } = render(
      <AppFrame>
        <p>child</p>
      </AppFrame>,
    );
    expect(container.querySelector("main")!.className).toContain("pb-28");
  });

  it("takes extra classes without dropping its own", () => {
    const { container } = render(
      <AppFrame className="extra">
        <p>child</p>
      </AppFrame>,
    );
    const main = container.querySelector("main")!;
    expect(main.className).toContain("extra");
    expect(main.className).toContain("max-w-5xl");
  });
});

describe("AuthFrame", () => {
  it("centres a signed-out screen on the viewport", () => {
    const { container } = render(
      <AuthFrame>
        <p>child</p>
      </AuthFrame>,
    );
    const main = container.querySelector("main")!;
    expect(main.className).toContain("min-h-screen");
    expect(main.className).toContain("justify-center");
    expect(main.className).toContain("max-w-md");
  });
});

describe("AppHeader", () => {
  it("renders the title as the page's one h1", () => {
    render(<AppHeader title="Today" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Today");
  });

  it("draws nothing for the parts a screen does not give it", () => {
    const { container } = render(<AppHeader title="Today" />);
    // No eyebrow, no lead, no facts rule, no action.
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector(".border-t")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("carries an eyebrow, a lead, a facts row and one action when given them", () => {
    const { container } = render(
      <AppHeader
        eyebrow="Marked work"
        icon={<svg data-testid="icon" />}
        title="Your marked work"
        lead="One sentence."
        facts={<span>Tier 2 evidence</span>}
        action={<button type="button">Do the thing</button>}
      />,
    );

    expect(screen.getByText("Marked work")).toBeDefined();
    expect(screen.getByTestId("icon")).toBeDefined();
    expect(screen.getByText("One sentence.")).toBeDefined();
    expect(screen.getByText("Tier 2 evidence")).toBeDefined();
    expect(screen.getByRole("button", { name: "Do the thing" })).toBeDefined();
    // The facts sit on a rule; that is what makes them read as instruments.
    expect(container.querySelector(".border-t")).not.toBeNull();
  });
});

describe("SectionHead — what opens a band on a product screen", () => {
  /**
   * The whole point of §8.5.9's rule: a section that opens at the same weight
   * as its prose is a paragraph, not a section. Product screens had been
   * demoting every heading to `--text-label-size`, which is 14px.
   */
  it("opens at display size, not at body weight", () => {
    render(<SectionHead label="The week" title="Where it went" />);
    const heading = screen.getByRole("heading", { name: "Where it went" });
    expect(heading.className).toContain("var(--text-display-size)");
    expect(heading.className).not.toContain("var(--text-label-size)");
  });

  it("puts the label in the accent above the title", () => {
    render(<SectionHead label="The week" title="Where it went" />);
    expect(screen.getByText("The week").className).toContain("text-accent");
  });

  it("takes at most one trailing action, and omits the slot without one", () => {
    const { rerender } = render(
      <SectionHead label="The week" title="Where it went" />,
    );
    expect(screen.queryByRole("link")).toBeNull();

    rerender(
      <SectionHead
        label="The week"
        title="Where it went"
        action={<a href="/mastery">See all</a>}
      />,
    );
    expect(screen.getByRole("link", { name: "See all" })).toBeDefined();
  });
});
