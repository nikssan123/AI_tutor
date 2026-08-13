// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Breadcrumbs,
  EvalTierNote,
  GoalSearch,
  JsonLdScript,
  PageFrame,
  PageIntro,
  RubricLadder,
  SectionHead,
  SiteFooter,
  SiteHeader,
} from "@/components/marketing";
import { StepsIcon } from "@/components/icons";
import type { RubricCriterion } from "@/lib/packs/types";

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

  it("renders taller on the landing page than in a results header", () => {
    // The default row height reads as a filter box. Above the fold it is the
    // only control on the page and has to look like the way in.
    const { container: hero } = render(
      <GoalSearch suggestions={[]} size="hero" />,
    );
    const { container: plain } = render(<GoalSearch suggestions={[]} />);

    expect(hero.querySelector("input")!.className).toContain("h-14");
    expect(plain.querySelector("input")!.className).not.toContain("h-14");
  });
});

/**
 * §8.5.9 — one width and one rhythm across the marketing routes. The pages used
 * to pick their own (max-w-2xl here, max-w-3xl there), which nobody notices on
 * any single page and everybody feels moving between four.
 */
describe("PageFrame", () => {
  const crumbs = [{ name: "Home", path: "/" }];

  it("is the main landmark and carries the breadcrumbs", () => {
    render(<PageFrame crumbs={crumbs}>body</PageFrame>);
    expect(screen.getByRole("main")).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeDefined();
  });

  it("uses one width for documents and a narrow one for tasks", () => {
    const { container: doc } = render(
      <PageFrame crumbs={crumbs}>body</PageFrame>,
    );
    const { container: task } = render(
      <PageFrame crumbs={crumbs} narrow>
        body
      </PageFrame>,
    );

    expect(doc.querySelector("main")!.className).toContain("max-w-5xl");
    // The running check is a task, not a document: one question on screen and
    // nothing else (§8.5.1), where a wide column would be actively worse.
    expect(task.querySelector("main")!.className).toContain("max-w-2xl");
  });
});

describe("PageIntro", () => {
  it("puts the page title in the one h1", () => {
    render(<PageIntro title="Graded projects" lead="Every rubric public." />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Graded projects",
    );
    expect(screen.getByText("Every rubric public.")).toBeDefined();
  });

  it("renders the optional icon, facts and action when given them", () => {
    render(
      <PageIntro
        icon={<StepsIcon />}
        title="SQL"
        lead="A path."
        facts={<span>26 skills</span>}
        action={<button type="button">Take the check</button>}
      />,
    );
    expect(screen.getByText("26 skills")).toBeDefined();
    expect(screen.getByRole("button", { name: "Take the check" })).toBeDefined();
  });

  it("omits the facts row entirely rather than leaving an empty rule", () => {
    // A bare border-t with nothing under it reads as a broken layout.
    const { container } = render(<PageIntro title="SQL" lead="A path." />);
    expect(container.querySelector(".border-t")).toBeNull();
  });
});

describe("SectionHead", () => {
  const props = { step: "01", label: "How it works", title: "Five steps" };

  it("numbers the section so a skimmer knows how much is left", () => {
    render(<SectionHead {...props} icon={<StepsIcon />} />);
    expect(screen.getByText(/01 · How it works/)).toBeDefined();
    expect(screen.getByText("Five steps")).toBeDefined();
  });

  it("swaps the icon chip to a surface when it sits on the accent field", () => {
    // On --ground the chip is an accent-weak tint. On the accent-weak field
    // that is the same fill as the background, so the chip vanishes.
    const { container: onGround } = render(
      <SectionHead {...props} icon={<StepsIcon />} />,
    );
    const { container: onField } = render(
      <SectionHead {...props} icon={<StepsIcon />} onField />,
    );

    expect(onGround.querySelector("span")!.className).toContain("bg-accent-weak");
    expect(onField.querySelector("span")!.className).toContain("bg-surface");
  });
});

/**
 * The band ladder is the page's whole argument, so it is asserted on content,
 * not on markup: if the four bands stop being visible the landing page is back
 * to claiming it grades work without ever showing what the grades mean.
 */
describe("RubricLadder", () => {
  const criterion: RubricCriterion = {
    id: "leads-with-the-news",
    name: "The news comes first",
    description: "The difficult part is in the opening.",
    weight: 0.35,
    bands: {
      absent: "The reader must reach the third paragraph.",
      developing: "Present in the first paragraph but softened.",
      competent: "The first sentence states the news plainly.",
      strong: "States it plainly and says what happens next.",
    },
  };

  it("shows every band, in the pack's own words", () => {
    render(<RubricLadder criterion={criterion} />);
    for (const text of Object.values(criterion.bands)) {
      expect(screen.getByText(text), text).toBeDefined();
    }
  });

  it("names the criterion and its weight as a standalone figure", () => {
    render(<RubricLadder criterion={criterion} />);
    expect(screen.getByText("The news comes first")).toBeDefined();
    // Its own element, so the page's "every weight is shown" assertion can
    // find the figure rather than a sentence that happens to contain it.
    expect(screen.getByText("35%")).toBeDefined();
    expect(screen.getByText(/of the grade/)).toBeDefined();
  });

  it("marks Competent as the pass bar", () => {
    // Four rungs with no marked line leaves the reader guessing which one they
    // have to reach — which is the question the whole section exists to answer.
    render(<RubricLadder criterion={criterion} />);
    expect(screen.getByText(/this is the pass mark/)).toBeDefined();
  });

  it("colours the two passing rungs with the accent and the rest faint", () => {
    render(<RubricLadder criterion={criterion} />);
    // §8.5.5 bans colour as the sole carrier of meaning, so the words Absent /
    // Developing / Competent / Strong are always present too.
    expect(screen.getByText("Competent").className).toContain("text-accent");
    expect(screen.getByText("Strong").className).toContain("text-accent");
    expect(screen.getByText("Absent").className).toContain("text-ink-faint");
    expect(screen.getByText("Developing").className).toContain("text-ink-faint");
  });
});

describe("EvalTierNote — §7.2's declared limits", () => {
  it.each([
    [1, "We run your work and check the answer is right"],
    [2, "We mark it against a checklist you can read first"],
    [3, "We check the technical side. Whether it's any good is your call"],
    [4, "We score the parts that can be measured"],
    [5, "You log this one yourself. It doesn't count as proof"],
  ])("states the claim tier %i is allowed to make", (tier, text) => {
    render(<EvalTierNote tier={tier} />);
    expect(screen.getByText(text)).toBeDefined();
  });

  it("falls back to the most conservative claim for an unknown tier", () => {
    // Overclaiming is the failure mode §4.2 law 3 rules out, so an unexpected
    // tier must degrade downward, never upward.
    render(<EvalTierNote tier={99} />);
    expect(screen.getByText("You log this one yourself. It doesn't count as proof")).toBeDefined();
  });
});
