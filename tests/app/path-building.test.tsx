// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PathBuild } from "@/lib/curriculum/build-state";
import { PATH_BUILD_TIMEOUT_MINUTES } from "@/lib/curriculum/build-state";

/**
 * What `/path` says about the build: the offer, the wait, or what stopped it.
 *
 * The wait screen is the reason the build left the request. A server action
 * posts over `fetch`, so a build that ran inside one had no browser throbber,
 * no row to read and nothing for a reload to find — the learner pressed the
 * button and watched an unchanged page for up to two model calls. What follows
 * is the honest alternative asserted state by state.
 */

vi.mock("@/app/(app)/path/actions", () => ({
  buildPathAction: vi.fn(),
  setDepthAction: vi.fn(),
}));

const { PathBuildState } = await import("@/app/(app)/path/building");
const { PATH_BUILD_STEPS, currentStep, pathStepStates } = await import(
  "@/app/(app)/path/progress"
);

const NOW = new Date("2026-08-16T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const build = (over: Partial<PathBuild> = {}): PathBuild => ({
  goalId: "goal-1",
  status: "building",
  stage: null,
  detail: null,
  startedAt: ago(1),
  ...over,
});

afterEach(cleanup);

describe("currentStep", () => {
  it("is null while nothing has picked the run up", () => {
    expect(currentStep(pathStepStates(null))).toBeNull();
  });

  it("counts off the phase the pipeline says it is in", () => {
    expect(currentStep(pathStepStates("saving"))).toBe(2);
  });
});

describe("no build has ever been asked for", () => {
  it("offers to build the path, and says what that gets them", () => {
    render(<PathBuildState build={undefined} hasPath={false} goalId="g" now={NOW} />);

    expect(screen.getByRole("button", { name: "Build my path" })).toBeDefined();
    expect(screen.getByText(/regroup them into modules/)).toBeDefined();
  });

  /**
   * No figure, deliberately. `aiCurriculum` is false on a free account, so the
   * path is arithmetic over the graph and comes back at once — and this screen
   * has no idea which plan is reading it, so any single number is wrong for
   * somebody. The wait is reported as it happens instead.
   */
  it("quotes no duration at anybody", () => {
    render(<PathBuildState build={undefined} hasPath={false} goalId="g" now={NOW} />);
    expect(document.body.textContent).not.toMatch(/minutes?\b/i);
  });
});

describe("a build in flight", () => {
  it("names the phase, counts it, and says nothing has failed", () => {
    render(
      <PathBuildState
        build={build({ stage: "checking" })}
        hasPath={false}
        goalId="g"
        now={NOW}
      />,
    );

    expect(screen.getByText("Step 2 of 3")).toBeDefined();
    // Twice: once as the loudest thing on the screen, once in its place in the
    // list — the same pairing `/start/building` uses, so a glance and a read
    // give the same answer.
    expect(screen.getAllByText(PATH_BUILD_STEPS[1]!.title)).toHaveLength(2);
    expect(screen.getByText("Running")).toBeDefined();
    expect(screen.getByText(/Nothing has failed/)).toBeDefined();
    // The one fact a learner in a hurry needs: they are not the thing holding
    // it up, and closing the tab does not cost them the build.
    expect(screen.getByText(/keeps building without you/)).toBeDefined();
  });

  it("says it is queued rather than pretending a phase has started", () => {
    render(<PathBuildState build={build()} hasPath={false} goalId="g" now={NOW} />);

    expect(screen.getByText("In the queue")).toBeDefined();
    expect(screen.getByText("Queued")).toBeDefined();
    expect(screen.queryByText("Step 1 of 3")).toBeNull();
  });

  it("asks the browser to come back, rather than shipping a poller", () => {
    render(<PathBuildState build={build()} hasPath={false} goalId="g" now={NOW} />);

    // Every other screen here works without JavaScript; the one that reports on
    // a background job does too.
    const meta = document.head.querySelector('meta[http-equiv="refresh"]');
    expect(meta?.getAttribute("content")).toBe("5");
  });

  it("offers no button at all while it is running", () => {
    render(<PathBuildState build={build()} hasPath={false} goalId="g" now={NOW} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says how long it has been going, in minutes rather than seconds", () => {
    render(
      <PathBuildState build={build({ startedAt: ago(3) })} hasPath={false} goalId="g" now={NOW} />,
    );
    expect(screen.getByText("Started 3 minutes ago")).toBeDefined();
  });
});

describe("a build that stopped", () => {
  it("shows what went wrong and offers another go", () => {
    render(
      <PathBuildState
        build={build({ status: "failed", detail: "We could not hand it over." })}
        hasPath={false}
        goalId="g"
        now={NOW}
      />,
    );

    expect(screen.getByText("Stopped")).toBeDefined();
    expect(screen.getByText("We could not hand it over.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("falls back to admitting it does not know why", () => {
    render(
      <PathBuildState
        build={build({ status: "failed" })}
        hasPath={false}
        goalId="g"
        now={NOW}
      />,
    );
    expect(screen.getByText(/did not say why/)).toBeDefined();
  });

  /**
   * A row still saying `building` past the timeout was written by nothing at
   * all — the worker died without reaching the end — so the honest report is
   * how long it has been going, not an error message nobody wrote.
   */
  it("calls a run that outlived the timeout stopped, not still going", () => {
    render(
      <PathBuildState
        build={build({ startedAt: ago(PATH_BUILD_TIMEOUT_MINUTES + 5) })}
        hasPath={false}
        goalId="g"
        now={NOW}
      />,
    );

    expect(screen.getByText("Stopped")).toBeDefined();
    expect(screen.getByText(/15 minutes with nothing finished/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("still lets a learner who already had a path get on with it", () => {
    render(
      <PathBuildState
        build={build({ status: "failed", detail: "It broke." })}
        hasPath
        goalId="g"
        now={NOW}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Start today/ }).getAttribute("href"),
    ).toBe("/today");
  });
});

/**
 * The best possible news, and the one this screen has to get right: somebody
 * who has already proved everything their course covers has *finished* it.
 * "We couldn't build your path" would be the worst available reading of it, and
 * a retry would reach the same conclusion at the same price.
 */
describe("nothing to build", () => {
  it("says why, calmly, and does not offer to try again", () => {
    render(
      <PathBuildState
        build={build({
          status: "skipped",
          detail: "There is nothing left to build a path through.",
        })}
        hasPath={false}
        goalId="g"
        now={NOW}
      />,
    );

    expect(screen.getByText("Nothing to build")).toBeDefined();
    expect(
      screen.getByText("There is nothing left to build a path through."),
    ).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("a path that is already built", () => {
  it("gets out of the way and points at today", () => {
    render(
      <PathBuildState
        build={build({ status: "ready" })}
        hasPath
        goalId="g"
        now={NOW}
      />,
    );

    expect(
      screen.getByRole("link", { name: /Start today/ }).getAttribute("href"),
    ).toBe("/today");
    // One filled button per screen: the offer to build is replaced, not joined.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("points at today even for a goal whose row predates the queue", () => {
    render(<PathBuildState build={undefined} hasPath goalId="g" now={NOW} />);
    expect(screen.getByRole("link", { name: /Start today/ })).toBeDefined();
  });

  /**
   * The same wall `/today` draws, on the other screen that offers the button.
   *
   * This one is only a link, so it could never start a session it should not —
   * but "Start today's session" offered to a learner with none left is a door
   * with nothing behind it, and they find that out by walking through it.
   */
  it("shows the button locked when the month's sessions are gone", () => {
    render(<PathBuildState build={undefined} hasPath goalId="g" locked now={NOW} />);

    const button = screen.getByRole("button", { name: /Start today/ });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("link", { name: /Start today/ })).toBeNull();
    // And the way past it, since this screen carries no upgrade card.
    expect(
      screen.getByRole("link", { name: /paid plan/ }).getAttribute("href"),
    ).toBe("/pricing");
  });

  it("defaults its clock to now, so the page need not pass one", () => {
    render(<PathBuildState build={build({ status: "ready" })} hasPath goalId="g" />);
    expect(screen.getByRole("link", { name: /Start today/ })).toBeDefined();
  });
});
