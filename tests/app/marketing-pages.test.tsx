// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  allProjects,
  allTopics,
  featuredProject,
  findPack,
  findProject,
  findSkill,
} from "@/lib/content";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const { default: MarketingLayout } = await import("@/app/(marketing)/layout");
const { default: HomePage } = await import("@/app/(marketing)/page");
const learn = await import("@/app/(marketing)/learn/page");
const topic = await import("@/app/(marketing)/learn/[topic]/page");
const projects = await import("@/app/(marketing)/projects/page");
const project = await import("@/app/(marketing)/projects/[slug]/page");
const check = await import("@/app/(marketing)/check/[topic]/[skill]/page");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const params = <T,>(value: T) => Promise.resolve(value);

/**
 * The per-tier promise, in the words a visitor reads. Kept in one place so the
 * copy and the assertions cannot drift apart — the wording is user-facing, but
 * *which* tier says what is a §7.2 correctness property.
 */
const CLAIM: Record<number, string> = {
  1: "We run your work and check the answer is right",
  2: "We mark it against a checklist you can read first",
  3: "We check the technical side. Whether it's any good is your call",
};

describe("marketing layout", () => {
  it("wraps content in the site header and footer", () => {
    render(<MarketingLayout>{<p>content</p>}</MarketingLayout>);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeDefined();
    expect(screen.getByText("content")).toBeDefined();
  });
});

describe("landing page (§8 screen 1)", () => {
  it("leads with a plain statement of the problem and one input", () => {
    render(<HomePage />);
    // Not "Prove it" — the old headline was a slogan, and a visitor could not
    // tell from it what the product does. Nor a riddle: the headline before
    // this one ("Anyone can teach you. Almost no one checks whether you
    // learned it.") made the reader work out the offer for themselves.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Then prove you actually learned it",
    );
    // "One input. Nothing else." — exactly one search field on the page.
    expect(screen.getAllByRole("search")).toHaveLength(1);
  });

  it("suggests only subjects the product actually teaches", () => {
    const { container } = render(<HomePage />);
    const values = [...container.querySelectorAll("datalist option")].map((o) =>
      o.getAttribute("value"),
    );
    expect(values).toContain("SQL & Data Analysis");
    expect(values.length).toBeGreaterThan(1);
  });

  it("walks through what happens, in order, one line per step", () => {
    render(<HomePage />);
    for (const phrase of [
      /Say what you want to learn/,
      /Take a ten-minute check/,
      /Get a plan/,
      /Do a real piece of work/,
      /Get it marked/,
    ]) {
      expect(screen.getByText(phrase), String(phrase)).toBeDefined();
    }
  });

  /**
   * The page reads as "a long list of stuff" the moment sections stop being
   * visually distinct, so the numbered heads are structural, not decorative.
   */
  it("separates its sections with numbered headings", () => {
    render(<HomePage />);
    for (const label of [/01 · How it works/, /02 · What marking looks like/, /03 · Subjects/]) {
      expect(screen.getByText(label), String(label)).toBeDefined();
    }
  });

  /**
   * The landing page used to list every brief as a bare title. That told a
   * newcomer nothing, so it now shows one real task with its complete grading
   * checklist — the single most convincing artefact the product has.
   */
  it("shows one real task, every criterion, and every weight", () => {
    render(<HomePage />);
    const featured = featuredProject();
    expect(screen.getByText(featured.title)).toBeDefined();
    expect(
      screen.getByText((t) => t.startsWith(featured.brief.slice(0, 40))),
    ).toBeDefined();

    // Weights shown for all of them or the marking has a hidden half.
    const total = featured.rubricDetail.criteria.reduce(
      (sum, c) => sum + c.weight,
      0,
    );
    expect(total).toBeCloseTo(1);
    for (const c of featured.rubricDetail.criteria) {
      expect(screen.getByText(c.name), c.id).toBeDefined();
      expect(
        screen.getAllByText(`${Math.round(c.weight * 100)}%`).length,
        c.id,
      ).toBeGreaterThan(0);
    }
  });

  it("links to the full checklist rather than reproducing all of it", () => {
    render(<HomePage />);
    const link = screen.getByText("Read the full checklist");
    expect(link.getAttribute("href")).toBe(
      `/projects/${featuredProject().slug}`,
    );
  });

  /**
   * The page used to render the rubric as `name … 35%`, which proves only that
   * a rubric exists. The bands are the actual claim — they are the standard the
   * work is held to, published before it is done (§4.2 law 2) — and a visitor
   * can only check us against a standard they can read.
   */
  it("shows what the grades mean, not just that grading happens", () => {
    render(<HomePage />);
    const heaviest = [...featuredProject().rubricDetail.criteria].sort(
      (a, b) => b.weight - a.weight,
    )[0]!;

    for (const band of Object.values(heaviest.bands)) {
      expect(screen.getByText(band), band).toBeDefined();
    }
    expect(screen.getByText(/this is the pass mark/)).toBeDefined();
  });

  it("shows what finishing the task means, from the brief itself", () => {
    render(<HomePage />);
    for (const line of featuredProject().acceptanceCriteria) {
      expect(screen.getByText(line), line).toBeDefined();
    }
  });

  /**
   * §8 screen 1 — "one input: what do you want to get good at?" The landing
   * page is the one place that input is the entire proposition, so it gets the
   * hero treatment; anywhere else it is a filter and must not.
   */
  it("gives the goal input hero weight and the headline the hero size", () => {
    const { container } = render(<HomePage />);
    expect(container.querySelector('input[name="q"]')!.className).toContain(
      "h-14",
    );
    expect(
      screen.getByRole("heading", { level: 1 }).className,
    ).toContain("var(--text-hero-size)");
  });

  /**
   * §8.5.6 — "list items stagger 24ms on first render only, never on
   * re-render." A CSS animation is the only way to get the "first render only"
   * half for free, and it keeps the route at zero motion JS (§8.5.8).
   */
  it("staggers its entrance in CSS rather than JavaScript", () => {
    const { container } = render(<HomePage />);
    const risen = [...container.querySelectorAll(".rise")];
    expect(risen.length).toBeGreaterThan(5);
    expect(container.querySelector("script[src]")).toBeNull();

    const delays = risen
      .map((el) => el.getAttribute("style"))
      .filter((s): s is string => s !== null && s.includes("--rise-delay"));
    expect(delays.some((s) => s.includes("24ms"))).toBe(true);
  });

  /**
   * The differentiator is only legible when subjects sit at different tiers: a
   * page where every subject says "verified" teaches the reader nothing about
   * what verification means. So the landing page must show the honest ceiling
   * of each subject, including the one that says a machine cannot judge it.
   */
  it("states a per-subject evaluation claim, not one blanket claim (§7.2)", () => {
    render(<HomePage />);
    for (const claim of Object.values(CLAIM)) {
      expect(screen.getAllByText(claim).length, claim).toBeGreaterThan(0);
    }
  });

  it("shows a non-technical subject first, so it cannot read as a dev tool", () => {
    render(<HomePage />);
    const names = allTopics().map((t) => t.name);
    expect(names[0]).toBe("Business Writing & Communication");
    for (const name of names) expect(screen.getByText(name), name).toBeDefined();
  });

  it("sets an explicit canonical and an OG image-less social card", async () => {
    const { metadata } = await import("@/app/(marketing)/page");
    expect(metadata.alternates?.canonical).toBeTruthy();
    expect(metadata.openGraph?.title).toContain("prove you did");
  });
});

describe("/learn", () => {
  it("lists subjects and graded projects", async () => {
    render(await learn.default({ searchParams: params({}) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "What you can learn",
    );
    expect(screen.getByText(/01 · Subjects/)).toBeDefined();
    expect(screen.getByText(/02 · Graded projects/)).toBeDefined();

    // Every subject and every brief is reachable from the hub — it is the top
    // of the internal link graph (§13.3), so a missing card is a dead branch.
    for (const topic of allTopics()) {
      expect(screen.getByText(topic.name), topic.slug).toBeDefined();
    }
    for (const project of allProjects()) {
      expect(screen.getByText(project.title), project.slug).toBeDefined();
    }
  });

  it("states what each subject can verify, not just how deep it goes", async () => {
    render(await learn.default({ searchParams: params({}) }));
    for (const claim of Object.values(CLAIM)) {
      expect(screen.getAllByText(claim).length, claim).toBeGreaterThan(0);
    }
  });

  it("returns real results for a query", async () => {
    render(await learn.default({ searchParams: params({ q: "join" }) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "join",
    );
    expect(screen.getByText(/matches$/)).toBeDefined();
  });

  it("says so honestly when nothing matches", async () => {
    render(
      await learn.default({ searchParams: params({ q: "basket weaving" }) }),
    );
    expect(screen.getByText(/Nothing matches/)).toBeDefined();
  });

  it("is indexable unfiltered, and noindex,follow when searched (§13.3)", async () => {
    const plain = await learn.generateMetadata({ searchParams: params({}) });
    expect(plain.robots).toBeUndefined();
    expect(plain.alternates?.canonical).toContain("/learn");

    const searched = await learn.generateMetadata({
      searchParams: params({ q: "join" }),
    });
    // A parameterised view is never indexed and canonicals to the bare URL —
    // §13.3 calls faceted URLs the #1 index-bloat source.
    expect(searched.robots).toEqual({ index: false, follow: true });
    expect(searched.alternates?.canonical).toMatch(/\/learn$/);
  });
});

describe("/learn/[topic]", () => {
  const p = params({ topic: "sql-data-analysis" });

  it("groups skills by area and states each capability", async () => {
    render(await topic.default({ params: p }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "SQL & Data Analysis",
    );
    expect(screen.getByText(/prove the totals were not inflated/)).toBeDefined();
  });

  it("links each skill to its check page", async () => {
    const { container } = render(await topic.default({ params: p }));
    expect(
      container.querySelectorAll('a[href^="/check/sql-data-analysis/"]').length,
    ).toBe(findPack("sql-data-analysis")!.skills.length);
  });

  it("pre-renders a route for every pack", () => {
    expect(topic.generateStaticParams().map((x) => x.topic).sort()).toEqual(
      allTopics().map((t) => t.slug).sort(),
    );
  });

  it("is noindex until the pack is human-reviewed (§12.1)", async () => {
    const meta = await topic.generateMetadata({ params: p });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.title).toBeTruthy();
    // §13.3 — title ≤60 characters.
    expect(String(meta.title).length).toBeLessThanOrEqual(60);
  });

  it("tells the reader why it is not indexed rather than hiding it", async () => {
    render(await topic.default({ params: p }));
    expect(screen.getByText(/Nobody has reviewed this subject/)).toBeDefined();
  });

  it("404s and returns empty metadata for an unknown topic", async () => {
    await expect(
      topic.default({ params: params({ topic: "nope" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(
      await topic.generateMetadata({ params: params({ topic: "nope" }) }),
    ).toEqual({});
  });
});

describe("/projects", () => {
  it("lists every brief across every subject", async () => {
    render(projects.default());
    expect(
      screen.getAllByRole("link").filter((a) =>
        a.getAttribute("href")?.startsWith("/projects/"),
      ),
    ).toHaveLength(allProjects().length);
  });
});

/**
 * §4.2 law 3, "never overclaim", asserted structurally.
 *
 * Regression: the project brief hardcoded the Tier 1 note, so a photograph —
 * graded at Tier 3, where the system explicitly cannot judge the result — was
 * telling readers "your work is run and checked". The claim has to come from
 * the pack that will actually do the grading, on every page that makes one.
 */
describe("no page claims more than its evaluator can honour (§4.2 law 3)", () => {
  it.each(allProjects().map((p) => [p.slug, p.evalTier] as const))(
    "%s states the tier-%d claim",
    async (slug, tier) => {
      render(await project.default({ params: params({ slug }) }));
      expect(screen.getByText(CLAIM[tier]!)).toBeDefined();
      for (const [other, text] of Object.entries(CLAIM)) {
        if (Number(other) !== tier) expect(screen.queryByText(text)).toBeNull();
      }
    },
  );

  it("carries the grading tier from the pack, not the project", () => {
    for (const p of allProjects()) {
      expect(p.evalTier, p.slug).toBe(
        findPack(p.topicSlug)!.evalTier,
      );
    }
  });
});

describe("/projects/[slug] — §4.2 law 2", () => {
  const p = params({ slug: "slow-query-rescue" });

  it("publishes the full rubric before the work is done", async () => {
    render(await project.default({ params: p }));

    // Every criterion, and every band of every criterion, is on the page.
    expect(screen.getByText("The cause is correctly identified")).toBeDefined();
    expect(
      screen.getByText("Guesses at a cause with no evidence."),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Names the cause, cites the plan, and rules out a competing explanation.",
      ),
    ).toBeDefined();
  });

  it("shows each criterion's weight so the grade is predictable", async () => {
    render(await project.default({ params: p }));
    const criteria = findProject("slow-query-rescue")!.rubricDetail.criteria;

    // The weight is its own element beside " of the grade" rather than one
    // sentence, so the figure can carry the emphasis. Both halves are asserted:
    // a percentage with no label is a number nobody can act on.
    expect(screen.getAllByText(/of the grade/).length).toBe(criteria.length);
    for (const criterion of criteria) {
      expect(
        screen.getAllByText(`${Math.round(criterion.weight * 100)}%`).length,
        criterion.id,
      ).toBeGreaterThan(0);
    }
  });

  it("orders the rubric heaviest-criterion-first", async () => {
    // The criterion that decides the grade should be the one the reader meets
    // first, not whichever the pack author happened to type first.
    render(await project.default({ params: p }));
    const shown = screen
      .getAllByText(/of the grade/)
      .map((el) => Number(el.textContent!.match(/(\d+)%/)![1]));
    expect(shown).toEqual([...shown].sort((a, b) => b - a));
  });

  it("lists the acceptance criteria as 'done means'", async () => {
    render(await project.default({ params: p }));
    expect(screen.getByText(/01 · What counts as done/)).toBeDefined();
    expect(
      screen.getByText("The plan is included, before and after."),
    ).toBeDefined();
  });

  it("says which skills the work would prove", async () => {
    render(await project.default({ params: p }));
    expect(screen.getByText(/03 · What this proves/)).toBeDefined();
  });

  /**
   * There is one rendering of a grading standard on the site. This page used to
   * hand-roll its own, which meant "Absent" was drawn in `--problem` — the
   * rose-red failure colour — for a band that just means "not there yet".
   */
  it("renders its rubric with the same ladder the landing page uses", async () => {
    render(await project.default({ params: p }));
    expect(screen.getAllByText(/this is the pass mark/).length).toBe(
      findProject("slow-query-rescue")!.rubricDetail.criteria.length,
    );
  });

  it("pre-renders every project", () => {
    expect(project.generateStaticParams().map((x) => x.slug).sort()).toEqual(
      allProjects().map((p) => p.slug).sort(),
    );
  });

  it("404s and returns empty metadata for an unknown slug", async () => {
    await expect(
      project.default({ params: params({ slug: "nope" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(
      await project.generateMetadata({ params: params({ slug: "nope" }) }),
    ).toEqual({});
  });

  it("describes itself for search without overclaiming", async () => {
    const meta = await project.generateMetadata({ params: p });
    expect(meta.description).toContain("published criteria");
    expect(meta.robots).toEqual({ index: false, follow: true });
  });
});

describe("/check/[topic]/[skill]", () => {
  const p = params({ topic: "sql-data-analysis", skill: "join-grain" });

  it("states the bar the skill has to clear", async () => {
    render(await check.default({ params: p }));
    expect(screen.getByText("What counts as knowing this")).toBeDefined();
  });

  it("is honest that a single-skill check does not exist yet", async () => {
    // §4.2 law 5 — declared limits are a feature. A disabled button pretending
    // to be a product is the overclaiming the positioning rejects.
    //
    // The limit itself moved when E4 landed: the diagnostic engine this page
    // once said it was waiting for now exists and runs `/check/[topic]`. What
    // is still missing is a check for one skill on its own, so that is what the
    // page has to be honest about.
    render(await check.default({ params: p }));
    expect(screen.getByText(/cannot check this skill on its own yet/)).toBeDefined();
    expect(
      screen.getByText(/stays out of search results until you can check this skill/),
    ).toBeDefined();
  });

  it("cites the real item count behind the skill", async () => {
    render(await check.default({ params: p }));
    const skill = findSkill("sql-data-analysis", "join-grain")!.skill;
    expect(
      screen.getByText(
        new RegExp(`${skill.itemCount} questions? for this skill so far`),
      ),
    ).toBeDefined();
  });

  it("shows prerequisites, soft prerequisites and what it unlocks", async () => {
    render(await check.default({ params: p }));
    expect(screen.getByText(/need these first/)).toBeDefined();
    expect(screen.getByText("Helpful, but not required")).toBeDefined();
    expect(screen.getByText("What it unlocks")).toBeDefined();
  });

  it("says plainly when a skill is a starting point", async () => {
    render(
      await check.default({
        params: params({ topic: "sql-data-analysis", skill: "select-projection" }),
      }),
    );
    expect(screen.getByText(/No prerequisites/)).toBeDefined();
  });

  it("pre-renders a page per skill across every subject", () => {
    const expected = allTopics().reduce((n, t) => n + t.skillCount, 0);
    expect(check.generateStaticParams()).toHaveLength(expected);
  });

  it("is never indexable while the tool does not exist", async () => {
    const meta = await check.generateMetadata({ params: p });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it("404s and returns empty metadata for an unknown skill", async () => {
    await expect(
      check.default({
        params: params({ topic: "sql-data-analysis", skill: "nope" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(
      await check.generateMetadata({
        params: params({ topic: "nope", skill: "nope" }),
      }),
    ).toEqual({});
  });
});
