// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SiteFooter, SiteHeader } from "@/components/marketing";
import {
  allProjects,
  allTopics,
  featuredProject,
  findPack,
  findProject,
  findSkill,
} from "@/lib/content";
import { EVAL_TIER_CLAIM } from "@/lib/claims";
import { tierFor } from "@/lib/evaluation/tier";

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
 * The claims, from the table the pages themselves read. Typed out here
 * originally, which meant this file could assert a page said tier 1's sentence
 * while believing that was fine — it listed the sentence as an expected value.
 */
const CLAIM: Record<number, string> = Object.fromEntries(
  Object.entries(EVAL_TIER_CLAIM).map(([tier, claim]) => [tier, claim.label]),
);

describe("marketing layout", () => {
  it("wraps content in the site header and footer", () => {
    /*
     * Asserted structurally rather than by rendering. `SiteHeader` reads the
     * session, so it is an async component — a client-side render pass cannot
     * resolve one, and what it draws is covered in its own suite
     * (tests/components/marketing.test.tsx) where it can be awaited. What the
     * layout is responsible for is the composition, and that is what this
     * checks: header, then children, then footer.
     */
    const tree = MarketingLayout({
      children: <p>content</p>,
    }) as React.ReactElement<{ children: React.ReactNode }>;
    const [header, main, footer] = React.Children.toArray(
      tree.props.children,
    ) as React.ReactElement<{ children: React.ReactNode }>[];

    expect(header!.type).toBe(SiteHeader);
    expect(footer!.type).toBe(SiteFooter);

    render(<>{main!.props.children}</>);
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
    const options = [
      ...container.querySelectorAll<HTMLElement>("#goal-listbox [role=option]"),
    ];
    // Every row but the last is a real pack, and its link is the subject's own
    // page — the autocomplete cannot offer something we do not teach.
    const subjects = options.filter((o) => !("goalCustom" in o.dataset));

    expect(subjects.map((o) => o.textContent)).toContain("SQL & Data Analysis");
    expect(subjects.length).toBeGreaterThan(1);
    for (const option of subjects) {
      expect(option.dataset.href).toMatch(/^\/learn\//);
    }
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
    for (const label of [
      /01 · How it works/,
      /02 · Any subject/,
      /03 · What marking looks like/,
      /04 · Written by hand/,
    ]) {
      expect(screen.getByText(label), String(label)).toBeDefined();
    }
  });

  /**
   * The headline promises "anything", and until §7.1's Generated tier shipped
   * the page under it argued the opposite — three subject cards billed as
   * "what you can learn today", and the offer to build a fourth as a card
   * below the fold. The band that answers the headline is now structural, and
   * these assertions are what stop it drifting back into a footnote.
   */
  it("answers 'anything' with a band of its own, above the catalogue", () => {
    const { container } = render(<HomePage />);
    const heads = [...container.querySelectorAll("h2")].map((h) => h.textContent);

    expect(heads).toContain("If nobody has written yours, we write it");
    // Above the three hand-written subjects, or the page still reads as a
    // three-subject site to anyone who stops scrolling.
    expect(
      heads.indexOf("If nobody has written yours, we write it"),
    ).toBeLessThan(heads.indexOf("The ones we wrote and checked ourselves"));
  });

  /**
   * §12 — "a page cannot promise something the product does not actually do."
   * The band quotes the generator's own floor, so the numbers are read from the
   * contract here too: a floor that moves without the copy moving is exactly
   * the drift this guards.
   */
  it("quotes the real quality floor, not a rounder number", async () => {
    const {
      MAX_GENERATED_SKILLS,
      MIN_GENERATED_ITEMS,
      MIN_GENERATED_SKILLS,
      MIN_ITEMS_PER_SKILL,
    } = await import("@/lib/contracts/pack");
    render(<HomePage />);

    expect(
      screen.getByText(
        new RegExp(`${MIN_GENERATED_SKILLS} to ${MAX_GENERATED_SKILLS}`),
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        new RegExp(
          `At least ${MIN_ITEMS_PER_SKILL} per skill and ${MIN_GENERATED_ITEMS} in all`,
        ),
      ),
    ).toBeDefined();
  });

  /**
   * §7.1 — "depth is declared, not faked". The offer to build a subject is
   * only honest while the two things a built one may never claim are on the
   * same screen as the offer.
   */
  it("says what a built subject is called and what it cannot claim", () => {
    render(<HomePage />);
    expect(screen.getByText("Experimental — help us improve it")).toBeDefined();
    expect(screen.getByText(/we stop and tell you/)).toBeDefined();
    expect(screen.getByText(/can’t claim the strongest kind of marking/)).toBeDefined();
  });

  it("sends someone who wants one built to the conversation that builds it", () => {
    render(<HomePage />);
    for (const label of ["Have one built", "Ask for a subject"]) {
      expect(screen.getByText(label).getAttribute("href"), label).toBe("/start");
    }
  });

  /**
   * Two kinds of subject now appear on one page, so the hand-written three
   * have to say which they are — a badge on one and silence on the other
   * leaves the reader to assume they are the same thing.
   */
  it("badges the hand-written subjects as hand-written", () => {
    render(<HomePage />);
    const curated = allTopics().filter((t) => t.maturity === "curated");
    expect(
      screen.getAllByText("Written and checked by hand").length,
    ).toBe(curated.length);
  });

  it("links only hand-written subjects from the band that claims they are", () => {
    // The band iterated `allTopics()` while every pack on disk happened to be
    // Curated, so it would have passed a Standard pack off as hand-written the
    // moment one existed — on the page whose whole argument is that the
    // difference is declared rather than hidden.
    //
    // Scoped to the band's own links, not the whole page: the autocomplete
    // above offers every subject we teach, which is correct and is a different
    // claim entirely.
    const { container } = render(<HomePage />);
    const band = [...container.querySelectorAll("section")].find((s) =>
      s.querySelector("h2")?.textContent?.includes("wrote and checked ourselves"),
    );

    const linked = [...band!.querySelectorAll("a[href^='/learn/']")].map((a) =>
      a.getAttribute("href")!.replace("/learn/", ""),
    );
    expect(linked.sort()).toEqual(
      allTopics()
        .filter((t) => t.maturity === "curated")
        .map((t) => t.slug)
        .sort(),
    );
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

    // Each subject says its own honest ceiling...
    for (const t of allTopics()) {
      expect(screen.getAllByText(CLAIM[t.evalTier]!).length, t.slug).toBeGreaterThan(0);
    }

    // ...and they are not all the same sentence, which is the property the
    // differentiator actually rests on. Asserted as "more than one distinct
    // claim" rather than as a list of every tier that exists: the old form
    // required tier 1's sentence to be on the page, and no page may say it.
    const shown = new Set(allTopics().map((t) => CLAIM[t.evalTier]!));
    expect(shown.size).toBeGreaterThan(1);
  });

  it("shows a non-technical subject first, so it cannot read as a dev tool", () => {
    render(<HomePage />);
    const names = allTopics().map((t) => t.name);
    expect(names[0]).toBe("Business Writing & Communication");
    // getAll, because a subject is both a card and a row in the search
    // dropdown — the dropdown is hidden until the field is used.
    for (const name of names) {
      expect(screen.getAllByText(name).length, name).toBeGreaterThan(0);
    }
  });

  it("sets an explicit canonical and an OG image-less social card", async () => {
    const { metadata } = await import("@/app/(marketing)/page");
    expect(metadata.alternates?.canonical).toBeTruthy();
    // The social card carries the same promise as the headline. It used to
    // pitch "learn something properly", which sold the marking and hid the
    // half of the product a search result has to convey in one line.
    expect(metadata.openGraph?.title).toContain("Learn anything");
    expect(metadata.openGraph?.description).toContain("nobody has written");
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
      expect(screen.getAllByText(topic.name).length, topic.slug).toBeGreaterThan(0);
    }
    for (const project of allProjects()) {
      expect(
        screen.getAllByText(project.title).length,
        project.slug,
      ).toBeGreaterThan(0);
    }
  });

  it("states what each subject can verify, not just how deep it goes", async () => {
    // Derived from the subjects on the page rather than from a list of every
    // tier that exists: the hub shows the claims its packs actually make, and
    // asserting the full table meant asserting tier 1's sentence appeared
    // somewhere — which was the overclaim, written down as a requirement.
    render(await learn.default({ searchParams: params({}) }));
    for (const topic of allTopics()) {
      expect(
        screen.getAllByText(CLAIM[topic.evalTier]!).length,
        topic.slug,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * The offer to build a subject used to appear only after a search came back
   * empty, which is a moment most visitors never reach — someone who browses
   * the hub sees three cards and concludes three is the offer.
   */
  it("says the list is not the limit, before anyone searches", async () => {
    render(await learn.default({ searchParams: params({}) }));
    expect(screen.getByText(/Not here\?/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Ask for it" }).getAttribute("href"),
    ).toBe("/start");
  });

  it("returns real results for a query", async () => {
    render(await learn.default({ searchParams: params({ q: "join" }) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "join",
    );
    expect(screen.getByText(/matches$/)).toBeDefined();
  });

  it("offers to build the subject when nothing matches", async () => {
    // A search that finds nothing is the one moment a visitor has proved they
    // want something we do not have. It used to answer with a shrug and a list
    // of what we do have; §7.1's Generated tier is the real answer.
    render(
      await learn.default({ searchParams: params({ q: "basket weaving" }) }),
    );
    expect(screen.getByText(/Nothing covers/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: /build my path/i }).getAttribute("href"),
    ).toBe("/start?topic=basket%20weaving");
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

  /**
   * Both of these used the SQL pack, which is now signed off, so they were
   * asserting the unreviewed path against reviewed content. They pick a pack
   * that is genuinely still unreviewed instead — and fail loudly rather than
   * silently passing if that ever stops being true of any pack.
   */
  const unreviewed = allTopics().find((t) => !t.indexable)!;

  it("is noindex until the pack is reviewed (§12.1)", async () => {
    const meta = await topic.generateMetadata({
      params: params({ topic: unreviewed.slug }),
    });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.title).toBeTruthy();
    // §13.3 — title ≤60 characters.
    expect(String(meta.title).length).toBeLessThanOrEqual(60);
  });

  it("tells the reader why it is not indexed rather than hiding it", async () => {
    render(await topic.default({ params: params({ topic: unreviewed.slug }) }));
    expect(screen.getByText(/Nobody has reviewed this subject/)).toBeDefined();
  });

  it("drops the noindex once a pack is signed off", async () => {
    const signed = allTopics().find((t) => t.indexable)!;
    const meta = await topic.generateMetadata({
      params: params({ topic: signed.slug }),
    });
    expect(meta.robots).toBeUndefined();
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

  it("carries the grading tier from the pack, capped by what the pipeline does", () => {
    // This assertion used to require the pack's *declared* tier, which is how
    // the SQL briefs kept promising "we run your work" for four passes: the
    // block caught a project overclaiming against its pack, and missed the pack
    // overclaiming against the evaluator. Both directions now.
    for (const p of allProjects()) {
      expect(p.evalTier, p.slug).toBe(tierFor(findPack(p.topicSlug)!.evalTier));
    }
  });

  it("states no tier-1 claim anywhere on the public site", () => {
    // The end the reader actually sees. Tier 1 licenses "we run your work and
    // check the answer is right", and nothing in this build runs anything.
    for (const p of allProjects()) expect(p.evalTier).not.toBe(1);
    for (const t of allTopics()) expect(t.evalTier).not.toBe(1);
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
  });

  it("is noindex while its pack is unreviewed, and indexed once it is not", async () => {
    // Was asserted against the SQL brief as a permanently-noindex example,
    // which stopped being true the moment SQL was signed off. Both directions,
    // from whichever briefs are actually on each side of the gate today.
    const shut = allProjects().find((x) => !x.indexable);
    const open = allProjects().find((x) => x.indexable);

    if (shut) {
      const meta = await project.generateMetadata({
        params: params({ slug: shut.slug }),
      });
      expect(meta.robots, shut.slug).toEqual({ index: false, follow: true });
    }
    if (open) {
      const meta = await project.generateMetadata({
        params: params({ slug: open.slug }),
      });
      expect(meta.robots, open.slug).toBeUndefined();
    }
    expect(shut ?? open, "the catalogue has at least one brief").toBeDefined();
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
