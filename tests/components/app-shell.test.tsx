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

  /**
   * §8.5.9's narrow column is retired: a product screen gets one width, and
   * the only other option is the operator's data grid.
   *
   * The type no longer admits `width="narrow"`, which is the real guard — this
   * pins the runtime half, that there is no third value the map still answers
   * to and no path by which a frame emits `max-w-2xl`.
   */
  it("answers to two widths, and neither of them is the narrow column", () => {
    for (const width of ["wide", "full"] as const) {
      const { container } = render(
        <AppFrame width={width}>
          <p>child</p>
        </AppFrame>,
      );
      expect(container.querySelector("main")!.className).not.toContain(
        "max-w-2xl",
      );
      cleanup();
    }
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

  /**
   * The regression this exists to catch: these screens had no route out of
   * them at all. No nav, no logo, nothing — someone who landed on `/sign-in`
   * from a search result or an emailed reset link could only go back.
   */
  it("offers a way home to someone with no nav to use", () => {
    render(
      <AuthFrame>
        <p>child</p>
      </AuthFrame>,
    );
    expect(
      screen.getByRole("link", { name: /MeritKeep/ }).getAttribute("href"),
    ).toBe("/");
  });

  /**
   * `/forgot-password`, `/reset-password` and `/verify-email` have no guest
   * guard, so they can render inside the signed-in shell — where the rail is
   * already showing the wordmark. Two of them is the same brand twice.
   */
  it("leaves the wordmark to the nav when there is one", () => {
    render(
      <AuthFrame brand={false}>
        <p>child</p>
      </AuthFrame>,
    );
    expect(screen.queryByRole("link", { name: /MeritKeep/ })).toBeNull();
  });

  it("puts the footer outside the card, and omits it when there is none", () => {
    const { container: bare } = render(
      <AuthFrame>
        <p>child</p>
      </AuthFrame>,
    );
    expect(bare.textContent).not.toContain("Already have an account?");
    cleanup();

    render(
      <AuthFrame footer={<span>Already have an account?</span>}>
        <p>child</p>
      </AuthFrame>,
    );
    expect(screen.getByText("Already have an account?")).toBeTruthy();
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
