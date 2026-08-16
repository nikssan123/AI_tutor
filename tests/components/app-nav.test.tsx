// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * §8.5.5's authenticated navigation — a bottom bar on mobile, a quiet left
 * rail on desktop, and an active state on both. The surface had neither: four
 * same-weight text links in a header that never said where you were.
 */

const pathname = vi.fn(() => "/today");
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

const { AppNav, isCurrent } = await import("@/components/app-nav");

afterEach(cleanup);

describe("isCurrent", () => {
  it("matches the destination itself", () => {
    expect(isCurrent("/today", "/today")).toBe(true);
  });

  it("matches a screen underneath it", () => {
    expect(isCurrent("/account/email", "/account")).toBe(true);
  });

  it("does not match a different destination", () => {
    expect(isCurrent("/mastery", "/today")).toBe(false);
  });

  /**
   * The reason this is a function and not `startsWith(href)`: a prefix match
   * without the boundary lights `/today` up on any future `/today-digest`.
   */
  it("only matches on a path boundary", () => {
    expect(isCurrent("/today-digest", "/today")).toBe(false);
  });

});

describe("AppNav", () => {
  it("marks the destination you are on, in both bars", () => {
    pathname.mockReturnValue("/mastery");
    render(<AppNav />);

    const current = screen.getAllByRole("link", { name: "Mastery" });
    // Rail and bottom bar: the same component drawn twice, hidden by
    // breakpoint. Both must agree about where you are.
    expect(current.length).toBe(2);
    for (const link of current) {
      expect(link.getAttribute("aria-current")).toBe("page");
    }

    for (const link of screen.getAllByRole("link", { name: "Today" })) {
      expect(link.getAttribute("aria-current")).toBeNull();
    }
  });

  it("names every destination in words, never by icon alone", () => {
    pathname.mockReturnValue("/today");
    render(<AppNav />);

    // §8.5.5 bans "tooltips that explain an icon" — which in practice means an
    // icon may never be the only label.
    for (const label of ["Today", "Path", "Mastery", "Progress", "You"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBe(2);
    }
  });

  /**
   * A responsive shell draws two bars and hides one, so anything in both is in
   * the DOM twice. That is fine for a link and a defect for a submit button,
   * which is why sign-out lives on /account instead.
   */
  /**
   * §8.5.5 names three destinations — "Today · Path · You" — and Path was the
   * one the rail did not have. It could not have had it: the screen lives at
   * `/goals/{id}/path` and this is a Client Component with no session to
   * resolve an id from, which is what `/path` exists to solve.
   */
  it("carries the destination the spec names and the rail was missing", () => {
    pathname.mockReturnValue("/today");
    render(<AppNav />);

    for (const link of screen.getAllByRole("link", { name: "Path" })) {
      expect(link.getAttribute("href")).toBe("/path");
    }
  });

  it("marks Path as current on the course screen", () => {
    pathname.mockReturnValue("/path");
    render(<AppNav />);

    const current = screen.getAllByRole("link", { name: "Path" });
    expect(current.length).toBe(2);
    for (const link of current) {
      expect(link.getAttribute("aria-current")).toBe("page");
    }
    for (const link of screen.getAllByRole("link", { name: "Today" })) {
      expect(link.getAttribute("aria-current")).toBeNull();
    }
  });

  it("holds no sign-out", () => {
    pathname.mockReturnValue("/today");
    render(<AppNav />);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("keeps the brand pointing home", () => {
    pathname.mockReturnValue("/today");
    render(<AppNav />);
    for (const link of screen.getAllByRole("link", { name: "MeritKeep" })) {
      expect(link.getAttribute("href")).toBe("/today");
    }
  });
});
