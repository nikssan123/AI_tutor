// @vitest-environment jsdom
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppLoading } from "@/components/app-shell";

import TodayLoading from "@/app/(app)/today/loading";
import CalendarLoading from "@/app/(app)/calendar/loading";
import MasteryLoading from "@/app/(app)/mastery/loading";
import SubjectsLoading from "@/app/(app)/subjects/loading";
import AccountLoading from "@/app/(app)/account/loading";
import BillingLoading from "@/app/(app)/account/billing/loading";
import ReferralsLoading from "@/app/(app)/account/referrals/loading";
import ProgressLoading from "@/app/(app)/progress/loading";
import SessionLoading from "@/app/(app)/session/[id]/loading";
import SubmissionLoading from "@/app/(app)/submission/[id]/loading";
import PathLoading from "@/app/(app)/goals/[id]/path/loading";

/**
 * The `loading.tsx` boundaries under `(app)`.
 *
 * These are what make a dynamic route prefetchable at all — Next skips
 * prefetching a dynamic route unless it has a loading boundary — so the thing
 * worth asserting is not that a skeleton renders, it is that *every*
 * authenticated screen someone navigates to still has one. A screen that
 * quietly loses its boundary goes back to a click that does nothing for a
 * couple of hundred milliseconds, and nothing else in the suite would notice.
 */

afterEach(cleanup);

/**
 * Every `(app)` route with a page, and the heading its boundary may show.
 * `null` is for the ones whose heading is itself the thing being fetched: the
 * shape of the week, the skill in front of you, the work being marked, the pack
 * you are pathing through.
 */
const BOUNDARIES: Array<
  [name: string, Loading: () => ReactElement, heading: string | null]
> = [
  ["/today", TodayLoading, "Today"],
  ["/calendar", CalendarLoading, "Your calendar"],
  ["/mastery", MasteryLoading, "What you can do"],
  ["/subjects", SubjectsLoading, "What you can learn here"],
  ["/account", AccountLoading, "Account"],
  ["/account/billing", BillingLoading, "Billing"],
  ["/account/referrals", ReferralsLoading, "Learn together"],
  ["/progress", ProgressLoading, null],
  ["/session/[id]", SessionLoading, null],
  ["/submission/[id]", SubmissionLoading, null],
  ["/goals/[id]/path", PathLoading, null],
];

describe("(app) loading boundaries", () => {
  it.each(BOUNDARIES)("%s announces itself while it waits", (_name, Loading) => {
    render(<Loading />);

    // §8.5.5's skeletons are `aria-hidden`, so this is the only thing a screen
    // reader is left with — which makes it the one thing that must be there.
    expect(screen.getByRole("status").textContent).toBe("Loading");
  });

  it.each(BOUNDARIES)(
    "%s writes only the heading it can be sure of",
    (_name, Loading, heading) => {
      render(<Loading />);

      if (heading) {
        expect(
          screen.getByRole("heading", { level: 1, name: heading }),
        ).toBeTruthy();
      } else {
        // A heading that changes under someone mid-read is worse than one that
        // arrives late, so these draw a bar instead of guessing.
        expect(screen.queryByRole("heading")).toBeNull();
      }
    },
  );

  it("holds the column the screen under it uses", () => {
    const { container } = render(<SessionLoading />);
    // A `wide` placeholder collapsing to `narrow` on arrival is a layout shift
    // the skeleton exists to prevent.
    expect(container.querySelector("main")?.className).toContain("max-w-2xl");
  });
});

describe("AppLoading", () => {
  /** The skeleton bars: everything the component draws `aria-hidden`. */
  const bars = (container: HTMLElement) =>
    container.querySelectorAll('[aria-hidden="true"]');

  it("draws one placeholder band per band the screen has", () => {
    const { container } = render(<AppLoading title="Today" bands={3} />);
    // A real heading, so: one lead line, two facts, three bands.
    expect(bars(container)).toHaveLength(6);
  });

  it("defaults to two bands in the wide column", () => {
    const { container } = render(<AppLoading title="Today" />);
    expect(bars(container)).toHaveLength(5);
    expect(container.querySelector("main")?.className).toContain("max-w-5xl");
  });

  it("blocks out the heading when the screen's own title depends on the data", () => {
    const { container } = render(<AppLoading bands={1} />);
    expect(screen.queryByRole("heading")).toBeNull();
    // Heading bar, lead line, two facts, one band.
    expect(bars(container)).toHaveLength(5);
  });
});
