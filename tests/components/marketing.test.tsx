// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Breadcrumbs,
  EvalTierNote,
  GoalSearch,
  JsonLdScript,
  SiteFooter,
  SiteHeader,
} from "@/components/marketing";

afterEach(cleanup);

describe("Breadcrumbs", () => {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Learn", path: "/learn" },
    { name: "SQL", path: "/learn/sql-data-analysis" },
  ];

  it("is a labelled navigation landmark", () => {
    render(<Breadcrumbs crumbs={crumbs} />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeDefined();
  });

  it("links every crumb except the current page", () => {
    render(<Breadcrumbs crumbs={crumbs} />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Home",
      "Learn",
    ]);
    // The last crumb is the page you are on, so it is text, not a link.
    expect(screen.getByText("SQL").closest("a")).toBeNull();
  });

  it("marks the current page for assistive technology", () => {
    render(<Breadcrumbs crumbs={crumbs} />);
    expect(screen.getByText("SQL").getAttribute("aria-current")).toBe("page");
  });

  it("renders a single crumb with no separator", () => {
    const { container } = render(
      <Breadcrumbs crumbs={[{ name: "Home", path: "/" }]} />,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });
});

describe("JsonLdScript", () => {
  it("emits a single ld+json script", () => {
    const { container } = render(<JsonLdScript blocks={[{ "@type": "Thing" }]} />);
    const script = container.querySelector(
      'script[type="application/ld+json"]',
    );
    expect(script).not.toBeNull();
    expect(JSON.parse(script!.innerHTML)).toEqual({ "@type": "Thing" });
  });

  it("emits an array when several blocks are given", () => {
    const { container } = render(
      <JsonLdScript blocks={[{ a: 1 }, { b: 2 }]} />,
    );
    const parsed = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')!.innerHTML,
    );
    expect(Array.isArray(parsed)).toBe(true);
  });
});

describe("SiteHeader", () => {
  it("offers three destinations, flat (§8.5.5)", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      [...nav.querySelectorAll("a")].map((a) => a.textContent),
    ).toEqual(["Learn", "Projects", "Sign in"]);
  });

  it("links the wordmark home", () => {
    render(<SiteHeader />);
    expect(screen.getByText("online_uni").getAttribute("href")).toBe("/");
  });
});

describe("SiteFooter", () => {
  it("carries the promise about published marking checklists", () => {
    render(<SiteFooter />);
    expect(screen.getByText(/read it before you start/)).toBeDefined();
    expect(screen.getByText(/Nothing counts as proof/)).toBeDefined();
  });

  it("puts the theme control in the footer, not in primary chrome (§8.5.4)", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("group", { name: "Appearance" })).toBeDefined();
  });
});

describe("GoalSearch", () => {
  it("is a labelled search that GETs to /learn", () => {
    render(<GoalSearch suggestions={["SQL & Data Analysis"]} />);
    const form = screen.getByRole("search");
    expect(form.getAttribute("action")).toBe("/learn");
    expect(form.getAttribute("method")).toBe("get");
  });

  it("ships no JavaScript — autocomplete is a native datalist (§8.5.8)", () => {
    const { container } = render(
      <GoalSearch suggestions={["SQL & Data Analysis", "Join grain"]} />,
    );
    expect(container.querySelector("script")).toBeNull();
    const options = [...container.querySelectorAll("datalist option")];
    expect(options.map((o) => o.getAttribute("value"))).toEqual([
      "SQL & Data Analysis",
      "Join grain",
    ]);
  });

  it("names the field `q` so the results page can read it", () => {
    render(<GoalSearch suggestions={[]} />);
    expect(screen.getByLabelText(/what do you want to get good at/i).getAttribute("name")).toBe("q");
  });

  it("keeps the previous query in the box on a results page", () => {
    render(<GoalSearch suggestions={[]} defaultValue="join grain" />);
    expect(
      (screen.getByLabelText(/what do you want to get good at/i) as HTMLInputElement)
        .value,
    ).toBe("join grain");
  });

  it("can take focus on the landing page", () => {
    render(<GoalSearch suggestions={[]} autoFocus />);
    expect(document.activeElement).toBe(
      screen.getByLabelText(/what do you want to get good at/i),
    );
  });
});

describe("EvalTierNote — §7.2's declared limits", () => {
  it.each([
    [1, "We run your work and check the answer is right"],
    [2, "We grade it against a checklist you can read first"],
    [3, "We check the technical side — whether it's any good is your call"],
    [4, "We score the parts that can be measured"],
    [5, "You log this one yourself; it doesn't count as proof"],
  ])("states the claim tier %i is allowed to make", (tier, text) => {
    render(<EvalTierNote tier={tier} />);
    expect(screen.getByText(text)).toBeDefined();
  });

  it("falls back to the most conservative claim for an unknown tier", () => {
    // Overclaiming is the failure mode §4.2 law 3 rules out, so an unexpected
    // tier must degrade downward, never upward.
    render(<EvalTierNote tier={99} />);
    expect(screen.getByText("You log this one yourself; it doesn't count as proof")).toBeDefined();
  });
});
