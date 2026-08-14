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
} from "@/lib/content";
import { EVAL_TIER_CLAIM } from "@/lib/claims";
import { tierFor } from "@/lib/evaluation/tier";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

/*
 * `/check/{topic}/{skill}` runs a check off a cookie now, so it reads the jar
 * even to render its description. An empty one is the state a crawler arrives
 * in, which is also the state every assertion in this file is about.
 */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

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
   *
   * Four, where there were five. The old 04 drew a card per category linking to
   * `/learn` and the old 05 drew the hand-written subjects; between them they
   * said "we have subjects" twice, and because 05 was the only band that listed
   * anything, a reader counted three and concluded the site had three.
   */
  it("separates its sections with numbered headings", () => {
    render(<HomePage />);
    for (const label of [
      /01 · How it works/,
      /02 · What marking looks like/,
      /03 · Any subject/,
      /04 · What's here/,
    ]) {
      expect(screen.getByText(label), String(label)).toBeDefined();
    }
    expect(screen.queryByText(/05 · /)).toBeNull();
  });

  /**
   * The fold used to be a headline, an input, and half a screen of nothing —
   * so the first thing a visitor learned about the product was whatever they
   * inferred from six words. These three sentences are the answer to "what is
   * this", above the point most people stop scrolling.
   */
  it("states what the product is on the fold, under the input", () => {
    const { container } = render(<HomePage />);
    for (const promise of [
      "You read the checklist before you start",
      "You hand in real work, not a quiz",
      "Every score quotes the part it came from",
    ]) {
      expect(screen.getByText(promise), promise).toBeDefined();
    }
    // In the hero, not somewhere further down dressed as a summary.
    const hero = container.querySelector("section")!;
    expect(hero.textContent).toContain("You hand in real work, not a quiz");
  });

  /**
   * The page listed only the three hand-written subjects, so it implied a
   * three-subject site the moment the catalogue grew past them — the exact
   * failure the "any subject" band was introduced to fix, reappearing because
   * the only band that listed anything listed a subset.
   */
  it("says how many subjects exist, not how many were hand-written", () => {
    render(<HomePage />);
    const curated = allTopics().filter((t) => t.maturity === "curated");
    expect(curated.length).toBeLessThan(allTopics().length);

    expect(
      screen.getByRole("heading", { name: `${allTopics().length} subjects, grouped by kind` }),
    ).toBeDefined();
  });

  it("names every category the catalogue actually spans", async () => {
    const { groupByCategory } = await import("@/lib/content/categories");
    render(<HomePage />);

    for (const { category } of groupByCategory(allTopics())) {
      expect(screen.getByText(category.name), category.slug).toBeDefined();
    }
  });

  /**
   * The band that replaced two.
   *
   * The old pair could each be true and still mislead together: one named
   * categories and linked them all to the same page, the other named three
   * subjects out of seven under a claim only those three could carry. A reader
   * who counted came away with the wrong number both times. One row list names
   * every category *and* every subject, so counting it gives the right answer.
   */
  it("names and links every subject from the catalogue band", () => {
    const { container } = render(<HomePage />);
    const band = [...container.querySelectorAll("section")].find((s) =>
      s.querySelector("h2")?.textContent?.includes("grouped by kind"),
    )!;

    const linked = [...band.querySelectorAll("a[href^='/learn/']")].map((a) =>
      a.getAttribute("href")!.replace("/learn/", ""),
    );
    expect(linked.sort()).toEqual(allTopics().map((t) => t.slug).sort());
  });

  /**
   * §7.1 — depth is declared, not faked, and the landing page's obligation is
   * the negative one: it must not let a reader believe the hand-written depth
   * covers the catalogue. The per-subject badges moved to `/learn`, where
   * somebody is actually choosing; what stays here is the sentence that names
   * both kinds and says every subject is labelled.
   */
  it("says the catalogue holds two kinds of subject, not one", () => {
    render(<HomePage />);
    const line = screen.getByText(/Some of these were written and checked/);
    expect(line.textContent).toContain("the rest are written when someone asks");
    expect(line.textContent).toContain("Every subject says which it is");
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
    // Above the list of what exists, or the page reads as a fixed catalogue to
    // anyone who stops scrolling — which is the failure it has had twice.
    expect(
      heads.indexOf("If nobody has written yours, we write it"),
    ).toBeLessThan(
      heads.indexOf(`${allTopics().length} subjects, grouped by kind`),
    );
  });

  /**
   * The example before the caveats.
   *
   * The marking band used to be fourth, behind a process diagram and three
   * paragraphs of small print about generation quality floors — so the most
   * convincing artefact the product owns was the last thing a visitor met.
   */
  it("shows what marking is before it explains what gets written", () => {
    const { container } = render(<HomePage />);
    const heads = [...container.querySelectorAll("h2")].map((h) => h.textContent);

    expect(
      heads.indexOf("A real task, and the standard it is held to"),
    ).toBeLessThan(heads.indexOf("If nobody has written yours, we write it"));
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
    for (const label of ["Have one built", "ask for a subject"]) {
      expect(screen.getByText(label).getAttribute("href"), label).toBe("/start");
    }
  });

  /** The catalogue band's other exit — the full list, with the labels on it. */
  it("sends anyone who wants the labelled list to the hub that has them", () => {
    render(<HomePage />);
    expect(
      screen.getByText(`See all ${allTopics().length}`).getAttribute("href"),
    ).toBe("/learn");
  });

  /**
   * The landing page used to list every brief as a bare title. That told a
   * newcomer nothing, so it now shows one real task with its complete grading
   * checklist — the single most convincing artefact the product has.
   *
   * `getAllByText` on the title, because the hero shows the same brief in its
   * compressed form: the specimen is the argument the band below makes in full,
   * and the two naming the same piece of work is the point rather than a
   * duplicate.
   */
  it("shows one real task, every criterion, and every weight", () => {
    render(<HomePage />);
    const featured = featuredProject();
    expect(screen.getAllByText(featured.title).length).toBeGreaterThan(0);
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
      expect(screen.getAllByText(c.name).length, c.id).toBeGreaterThan(0);
      expect(
        screen.getAllByText(`${Math.round(c.weight * 100)}%`).length,
        c.id,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * The fold has to show the product, not just describe it.
   *
   * The hero was a headline, a paragraph, an input and three grey bullets down
   * the left of a 1440px viewport, with nothing anywhere on it that showed what
   * the product actually does — a page about marked work whose first impression
   * was a search box. The right column is band 02's argument in compressed
   * form: the real criteria of a real brief, with their real weights.
   *
   * §12 still holds, and this is the line it draws: the specimen is a *rubric*,
   * which the product genuinely publishes, and not a mocked-up dashboard or an
   * invented screenshot of somebody's graded submission.
   */
  it("puts a real artefact on the fold, not just a search box", () => {
    const { container } = render(<HomePage />);
    const hero = container.querySelector("section")!;
    const featured = featuredProject();

    expect(hero.textContent).toContain(featured.title);
    for (const c of featured.rubricDetail.criteria) {
      expect(hero.textContent, c.id).toContain(c.name);
      expect(hero.textContent, c.id).toContain(
        `${Math.round(c.weight * 100)}%`,
      );
    }
    // Named as a standard, not as a score — §4.2 law 3.
    expect(hero.textContent).toContain("Competent on each is a pass");
  });

  /**
   * The one place the page stops.
   *
   * A pinned element's own `view()` timeline is frozen by definition — it is
   * not moving relative to the viewport — so the rungs inside the stuck card
   * have to be driven by the *section's* named timeline instead. That is the
   * whole trick, and it is invisible in the markup: what is assertable is that
   * the scene and the stage are both present and that the rungs that build
   * during the pin are inside it.
   */
  it("pins the marking band and builds the ladder inside it", () => {
    const { container } = render(<HomePage />);
    const scene = container.querySelector(".pin-scene")!;

    expect(scene.querySelector(".pin-stage")).not.toBeNull();
    // The four rungs of the featured criterion, staggered across the pin.
    const rungs = [...scene.querySelectorAll(".reveal")];
    expect(rungs).toHaveLength(4);
    expect(rungs.map((r) => r.getAttribute("style"))).toEqual([
      "--reveal-start: 0%;",
      "--reveal-start: 6%;",
      "--reveal-start: 12%;",
      "--reveal-start: 18%;",
    ]);
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
   *
   * Two mechanisms now, and the split is what the page needed: `rise` runs off
   * a clock, so everything below the fold used to finish animating before
   * anybody saw it. Only the hero keeps it. Everything further down is `reveal`
   * or `settle`, which run off `animation-timeline: view()` — the scroll drives
   * them, and because a view timeline has no clock, the stagger is a *range*
   * offset rather than a delay. Still zero JavaScript, which is the whole
   * reason neither one is a library.
   */
  it("staggers its entrance in CSS rather than JavaScript", () => {
    const { container } = render(<HomePage />);
    expect(container.querySelector("script[src]")).toBeNull();

    const styles = (selector: string) =>
      [...container.querySelectorAll(selector)]
        .map((el) => el.getAttribute("style"))
        .filter((s): s is string => s !== null);

    // The fold, on a clock.
    const risen = styles(".rise");
    expect(risen.some((s) => s.includes("--rise-delay: 24ms"))).toBe(true);

    // Everything past it, on the scroll.
    const revealed = styles(".reveal, .settle");
    expect(revealed.length).toBeGreaterThan(5);
    expect(revealed.some((s) => s.includes("--reveal-start: 6%"))).toBe(true);

    // A view timeline cannot be delayed, so an element carrying both would
    // fight itself — whichever rule the stylesheet emitted last would win.
    expect(container.querySelector(".rise.reveal, .rise.settle")).toBeNull();
  });

  /**
   * §4.2 law 3, on the page that has the most to gain from breaking it.
   *
   * The per-subject tier claims moved to `/learn`, which is where somebody is
   * choosing between subjects and the difference between "we mark it against a
   * checklist" and "whether it's any good is your call" changes what they
   * click. What must not happen is the landing page keeping the flattering half
   * — a blanket claim over a catalogue whose subjects do not all support it.
   */
  it("makes no blanket evaluation claim over the whole catalogue (§7.2)", () => {
    const { container } = render(<HomePage />);
    const band = [...container.querySelectorAll("section")].find((s) =>
      s.querySelector("h2")?.textContent?.includes("grouped by kind"),
    )!;

    for (const [tier, claim] of Object.entries(CLAIM)) {
      expect(band.textContent, `tier ${tier}`).not.toContain(claim);
    }
  });

  it("states no tier-1 claim anywhere on it, whatever a pack declares", () => {
    render(<HomePage />);
    expect(screen.queryByText(CLAIM[1]!)).toBeNull();
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
  it("lists every subject, grouped, and links each one", async () => {
    const { container } = render(await learn.default({ searchParams: params({}) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "What you can learn",
    );
    expect(screen.getByText(/01 · Subjects/)).toBeDefined();

    // Every subject is reachable from the hub — it is the top of the internal
    // link graph (§13.3), so a missing card is a dead branch.
    const linked = new Set(
      [...container.querySelectorAll("a[href^='/learn/']")].map((a) =>
        a.getAttribute("href")!.replace("/learn/", ""),
      ),
    );
    for (const topic of allTopics()) {
      expect(screen.getAllByText(topic.name).length, topic.slug).toBeGreaterThan(0);
      expect(linked.has(topic.slug), topic.slug).toBe(true);
    }
  });

  /**
   * The hub used to end in every graded brief in the product: twenty-two cards,
   * a bare title and `4 criteria · 75 min` each, no subject attached, in an
   * order derived from a difficulty number the reader cannot see. It was
   * `/projects` reproduced without the grouping and the briefs that make
   * `/projects` legible, on a page whose job is subjects.
   *
   * Scoped to the rendered page rather than to `container.textContent`, because
   * the goal-search dropdown legitimately offers briefs by name — that is an
   * autocomplete, not a listing, and it is hidden until the field is used.
   */
  it("points at the briefs instead of reproducing them", async () => {
    const { container } = render(await learn.default({ searchParams: params({}) }));

    // Not one link to an individual brief, and exactly one to the page that
    // has all of them.
    expect(container.querySelectorAll("a[href^='/projects/']")).toHaveLength(0);
    expect(container.querySelectorAll("a[href='/projects']")).toHaveLength(1);

    expect(screen.getByText(/02 · Graded projects/)).toBeDefined();
    expect(screen.getByText(`${allProjects().length} briefs`)).toBeDefined();
    expect(screen.getByText("Read the briefs").getAttribute("href")).toBe(
      "/projects",
    );
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
  it("lists every brief, grouped under the subject it belongs to", () => {
    const { container } = render(projects.default());

    // A Set, not a count: the page also cites one brief by name in the band
    // that explains what a checklist is, so the same href legitimately appears
    // twice. What matters is that no brief is missing.
    const linked = new Set(
      [...container.querySelectorAll("a[href^='/projects/']")].map((a) =>
        a.getAttribute("href")!.replace("/projects/", ""),
      ),
    );
    expect([...linked].sort()).toEqual(
      allProjects().map((p) => p.slug).sort(),
    );

    // Grouped, which is the axis a reader actually has. The flat list this
    // replaced was ordered by `difficulty` — a number nobody can see, which put
    // a cooking brief between two SQL ones for no legible reason.
    for (const slug of new Set(allProjects().map((p) => p.topicSlug))) {
      const topic = allTopics().find((t) => t.slug === slug)!;
      expect(screen.getAllByText(topic.name).length, slug).toBeGreaterThan(0);
    }
  });

  /**
   * "Graded" is the word this page is selling, and the wall of cards never
   * defined it — a criteria count proves a rubric exists and nothing more.
   * §4.2 law 2 publishes the standard; a page that does not show one is
   * throwing away the only thing that makes the count mean anything.
   */
  it("shows a real band of a real rubric before listing anything", () => {
    render(projects.default());
    const heaviest = [...featuredProject().rubricDetail.criteria].sort(
      (a, b) => b.weight - a.weight,
    )[0]!;

    for (const band of Object.values(heaviest.bands)) {
      expect(screen.getByText(band), band).toBeDefined();
    }
    expect(screen.getByText(/this is the pass mark/)).toBeDefined();
  });

  /** A brief cut mid-word reads as a bug, not as an excerpt. */
  it("cuts a long brief at a word, never inside one", () => {
    const { container } = render(projects.default());
    const long = allProjects().find((p) => p.brief.length > 150)!;

    const cut = [...container.querySelectorAll("a[href^='/projects/']")]
      .find((a) => a.getAttribute("href") === `/projects/${long.slug}`)!
      .textContent!;
    const shown = cut.slice(cut.indexOf(long.title) + long.title.length);
    expect(shown).toContain("…");
    // Whatever survived the cut is a prefix of the brief, ending at a word.
    const excerpted = shown.slice(0, shown.indexOf("…"));
    expect(long.brief.startsWith(excerpted)).toBe(true);
    expect(long.brief[excerpted.length]).toMatch(/[\s.,;:—-]/);
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

/**
 * The two routes search delivers strangers to can be signed up from.
 *
 * Both were dead ends. `/projects` and `/learn` are the highest-priority
 * entries in the sitemap after the home page, and every link on the pages
 * beneath them went sideways — `/check/*`, `/projects/*`, `/guides/*` — while
 * the only `/start` links on the whole marketing surface were two on the home
 * page and one on `/learn`'s *empty results* card. A reader could arrive from
 * Google, read the full rubric, agree with all of it, and have nowhere to go.
 *
 * Asserted by route rather than by component because the components had tests
 * and the pages were still dead ends: what was missing was the call site.
 */
describe("the reading routes have a way in (§10 B)", () => {
  const startLinks = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('a[href^="/start"]')].map(
      (a) => a.getAttribute("href") ?? "",
    );

  it("offers a graded brief's reader the project itself", async () => {
    const brief = allProjects()[0]!;
    const { container } = render(
      await project.default({ params: params({ slug: brief.slug }) }),
    );

    const seeds = startLinks(container);
    expect(seeds.length).toBeGreaterThan(0);
    // Named by slug, and deliberately *not* through `?topic=`. That parameter
    // means "a subject somebody typed into a search box", and routing a brief
    // through it is what made /start treat this click like a vague query and
    // bury the brief under an unfinished conversation.
    expect(seeds).toContain(`/start?project=${brief.slug}`);
    expect(seeds.every((s) => !s.includes("topic="))).toBe(true);
  });

  it("offers a subject page's reader that subject", async () => {
    const pack = findPack("sql-data-analysis")!;
    const { container } = render(
      await topic.default({ params: params({ topic: pack.slug }) }),
    );

    const seeds = startLinks(container).map((href) => decodeURIComponent(href));
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.some((s) => s.includes(pack.name))).toBe(true);
  });

  it("offers a skill check's reader the subject it belongs to", async () => {
    // The state a crawler sees: no cookie, so the check has not been run. Every
    // link on it went to another check, another project, or the subject page.
    const pack = findPack("sql-data-analysis")!;
    const { container } = render(
      await check.default({
        params: params({ topic: pack.slug, skill: pack.skills[0]!.slug }),
      }),
    );

    const seeds = startLinks(container).map((href) => decodeURIComponent(href));
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.some((s) => s.includes(pack.name))).toBe(true);
  });

  it("offers it on an unreviewed subject too, saying so alongside", async () => {
    // A first-draft pack is still one somebody can start; the honest handling
    // is to offer it *and* keep the warning, not to quietly drop the exit.
    const unreviewed = allTopics().find((t) => !t.indexable)!;
    const { container } = render(
      await topic.default({ params: params({ topic: unreviewed.slug }) }),
    );

    expect(startLinks(container).length).toBeGreaterThan(0);
    expect(screen.getByText(/Nobody has reviewed this subject/)).toBeDefined();
  });
});

/**
 * §8.5.6's marketing amendment, asserted across every route it covers.
 *
 * `rise` runs off a clock that starts when the document does, so anything below
 * the fold carrying it has finished animating before the reader has scrolled to
 * it — the whole motion budget spent on the one screenful that did not need it.
 * The landing page keeps it, for the fold alone, and that split is asserted in
 * its own suite above.
 *
 * The four routes a visitor *reads* have no fold to spend it on: they open with
 * a breadcrumb trail and a page title. Every one of them had `rise` on the whole
 * page, which is why the pages were reported as having no motion at all — the
 * motion was real, and over before it could be seen.
 *
 * Asserted here rather than per route because it is the sort of thing that comes
 * back one page at a time: the next person to add a grid copies the nearest one,
 * and the nearest one is as likely to be an app screen (where `rise` is still
 * right — those are screens you operate, not documents you scroll) as a
 * marketing page.
 */
describe("the reading routes move with the scroll (§8.5.6)", () => {
  const reading = [
    ["/learn", () => learn.default({ searchParams: params({}) })],
    [
      "/learn/[topic]",
      () => topic.default({ params: params({ topic: "sql-data-analysis" }) }),
    ],
    ["/projects", () => projects.default()],
    [
      "/projects/[slug]",
      () => project.default({ params: params({ slug: "slow-query-rescue" }) }),
    ],
  ] as const;

  it.each(reading)("%s is driven by the scroll, not by a clock", async (_, page) => {
    const { container } = render(await page());

    expect(container.querySelector(".rise")).toBeNull();

    const moved = [...container.querySelectorAll(".reveal, .settle")];
    expect(moved.length).toBeGreaterThan(3);

    // The stagger is a range offset rather than a delay, because a view
    // timeline has no clock to be late against. It is also what lets a row
    // build left-to-right on a timeline that only measures vertical travel.
    expect(moved.map((el) => el.getAttribute("style"))).toContain(
      "--reveal-start: 6%;",
    );

    // An element carrying both would fight itself: two animations on one
    // element, and whichever rule the stylesheet emitted last wins.
    expect(container.querySelector(".rise.reveal, .rise.settle")).toBeNull();
  });
});

describe("/check/[topic]/[skill]", () => {
  const p = params({ topic: "sql-data-analysis", skill: "join-grain" });

  it("states the bar the skill has to clear", async () => {
    render(await check.default({ params: p }));
    expect(screen.getByText("What counts as knowing this")).toBeDefined();
  });

  /**
   * This card said "Not ready yet — you cannot check this skill on its own" for
   * two epics, and it was the honest thing to say (§4.2 law 5) right up until
   * the tool existed. It is the offer now, and it still declares what the check
   * can and cannot settle before anybody starts one.
   */
  it("offers the check, and says what it will and will not settle", async () => {
    render(await check.default({ params: p }));

    expect(screen.getByRole("button", { name: "Start" })).toBeDefined();
    expect(screen.getByText(/on this skill\s+alone/)).toBeDefined();
    expect(screen.getByText(/your answers are not kept/)).toBeDefined();
    expect(screen.queryByText(/cannot check this skill on its own/)).toBeNull();
  });

  /**
   * The page used to cite how many questions had been *written* for the skill,
   * which is a fact about our authoring rather than about the visitor's next
   * ten minutes. It states the budget now — how many it will ask at most — and
   * that number comes from the same `budgetFor` the check runs on, so the offer
   * cannot promise a question the check will not ask.
   */
  it("promises exactly the number of questions the check would ask", async () => {
    const { budgetFor, narrow } = await import("@/lib/check/run");
    const ref = { topic: "sql-data-analysis", skill: "join-grain" };
    const budget = budgetFor(ref, narrow(findPack(ref.topic)!, ref).items);

    render(await check.default({ params: p }));
    expect(
      screen.getByText(new RegExp(`Up to ${budget} questions?`)),
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

  /**
   * It used to prerender one page per skill and sit permanently `noindex`,
   * because it described a check nobody had built. It runs one now, off a
   * cookie, so it renders per request for the same reason `/check/{topic}` does
   * — and it is submitted for indexing on the same gate as everything else
   * about its pack.
   */
  it("renders per request, because a cached first question would be someone else's", async () => {
    const mod = check as unknown as Record<string, unknown>;
    expect(mod.dynamic).toBe("force-dynamic");
    expect(mod.generateStaticParams).toBeUndefined();
  });

  it("is indexable on exactly its pack's gate", async () => {
    const { findPack, isTopicIndexable } = await import("@/lib/content");
    const meta = await check.generateMetadata({ params: p });

    if (isTopicIndexable(findPack("sql-data-analysis")!)) {
      expect(meta.robots).toBeUndefined();
    } else {
      expect(meta.robots).toEqual({ index: false, follow: true });
    }
    // §13.3 — title ≤60 characters, description 140–160.
    expect(String(meta.title).length).toBeLessThanOrEqual(60);
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
