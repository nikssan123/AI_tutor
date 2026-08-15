// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const currentUserMock = vi.fn();

/** The `theme` cookie for the next render; undefined means never chosen. */
let themeCookie: string | undefined;

// SiteHeader reads the session and SiteFooter reads the theme cookie, which is
// what makes those two async. Everything else in this file is still a plain
// synchronous server component.
vi.mock("@/lib/account/session", () => ({
  currentUser: () => currentUserMock(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      themeCookie === undefined ? undefined : { name, value: themeCookie },
  }),
}));

import {
  Breadcrumbs,
  CheckStartOffer,
  EvalTierNote,
  CustomPathOffer,
  FaqList,
  GoalSearch,
  GuideStartOffer,
  JsonLdScript,
  PageFrame,
  PageIntro,
  ProjectStartOffer,
  RubricLadder,
  SectionHead,
  SiteFooter,
  SiteHeader,
  TopicStartOffer,
} from "@/components/marketing";
import { StepsIcon } from "@/components/icons";
import { goalSearchScript } from "@/lib/goal-search-script";
import { CUSTOM_PATH_HREF } from "@/lib/goals/custom-path";
import { projectStartHref, topicStartHref } from "@/lib/goals/project-start";
import type { RubricCriterion } from "@/lib/packs/types";

afterEach(() => {
  cleanup();
  themeCookie = undefined;
});

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
  it("offers three destinations, flat (§8.5.5)", async () => {
    currentUserMock.mockResolvedValue(null);
    render(await SiteHeader());
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      [...nav.querySelectorAll("a")].map((a) => a.textContent),
    ).toEqual(["Learn", "Projects", "Sign in"]);
  });

  it("does not offer to sign in someone who already is", async () => {
    // The whole reason this component reads the session. Three destinations
    // still, because the third becomes the way back into the app rather than
    // disappearing and leaving a hole where the person's route in used to be.
    currentUserMock.mockResolvedValue({ id: "u1", email: "a@b.co" });
    render(await SiteHeader());
    const nav = screen.getByRole("navigation", { name: "Main" });

    expect(
      [...nav.querySelectorAll("a")].map((a) => a.textContent),
    ).toEqual(["Learn", "Projects", "Keep learning"]);
    expect(nav.querySelector('a[href="/sign-in"]')).toBeNull();
    expect(nav.querySelector('a[href="/today"]')).not.toBeNull();
  });

  it("links the wordmark home", async () => {
    currentUserMock.mockResolvedValue(null);
    render(await SiteHeader());
    // By role rather than by text: the wordmark is a mark plus a name, so the
    // text node is inside the link rather than being it. The accessible name is
    // what a reader gets either way, and it is the thing worth pinning.
    expect(
      screen.getByRole("link", { name: "MeritKeep" }).getAttribute("href"),
    ).toBe("/");
  });
});

describe("SiteFooter", () => {
  const pressed = () =>
    screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-pressed") === "true")?.textContent;

  it("carries the promise about published marking checklists", async () => {
    render(await SiteFooter());
    expect(screen.getByText(/read it before you start/)).toBeDefined();
    expect(screen.getByText(/Nothing counts as proof/)).toBeDefined();
  });

  it("puts the theme control in the footer, not in primary chrome (§8.5.4)", async () => {
    render(await SiteFooter());
    expect(screen.getByRole("group", { name: "Appearance" })).toBeDefined();
  });

  it("lights the theme the visitor actually chose", async () => {
    // §8.5.4 mirrors the choice to a cookie precisely so the server can render
    // this right. Without it the page came back dark with System lit up, and
    // the toggle was the one control on the site lying about its own state.
    themeCookie = "dark";
    render(await SiteFooter());
    expect(pressed()).toBe("dark");
  });

  it("falls back to System when nobody has chosen", async () => {
    render(await SiteFooter());
    expect(pressed()).toBe("system");
  });

  it("falls back to System for a cookie value it does not recognise", async () => {
    themeCookie = "chartreuse";
    render(await SiteFooter());
    expect(pressed()).toBe("system");
  });
});

describe("GoalSearch", () => {
  const subjects = [
    { label: "SQL & Data Analysis", href: "/learn/sql-data-analysis" },
    { label: "Join grain", href: "/projects/join-grain" },
  ];

  const field = () => screen.getByLabelText(/what do you want to get good at/i);

  it("is a labelled search that GETs to /learn", () => {
    render(<GoalSearch suggestions={subjects} />);
    const form = screen.getByRole("search");
    expect(form.getAttribute("action")).toBe("/learn");
    expect(form.getAttribute("method")).toBe("get");
  });

  it("names the field `q` so the results page can read it", () => {
    render(<GoalSearch suggestions={[]} />);
    expect(field().getAttribute("name")).toBe("q");
  });

  it("keeps the previous query in the box on a results page", () => {
    render(<GoalSearch suggestions={[]} defaultValue="join grain" />);
    expect((field() as HTMLInputElement).value).toBe("join grain");
  });

  it("can take focus on the landing page", () => {
    render(<GoalSearch suggestions={[]} autoFocus />);
    expect(document.activeElement).toBe(field());
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

  /*
   * The dropdown is the part that was broken: the markup was right and the
   * control still did nothing a person could use. These hold the shape the
   * inline script drives — if an attribute below moves, the script goes quiet
   * and the field silently becomes a plain text box again.
   */
  it("is a combobox over a listbox that starts closed", () => {
    const { container } = render(<GoalSearch suggestions={subjects} />);
    const input = field();

    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toBe("goal-listbox");
    // Otherwise the browser's own saved-values popup covers ours.
    expect(input.getAttribute("autocomplete")).toBe("off");

    // By id, because the datalist fallback is a listbox in the tree too.
    const list = container.querySelector<HTMLElement>("#goal-listbox")!;
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.getAttribute("aria-label")).toBe("Subjects");
    expect(list.hidden).toBe(true);
  });

  it("gives every suggestion the destination picking it goes to", () => {
    const { container } = render(<GoalSearch suggestions={subjects} />);
    const options = [
      ...container.querySelectorAll<HTMLElement>("#goal-listbox [role=option]"),
    ];

    // Two subjects plus the build-it row, which is the last one.
    expect(options).toHaveLength(3);
    expect(options.slice(0, 2).map((o) => o.dataset.href)).toEqual([
      "/learn/sql-data-analysis",
      "/projects/join-grain",
    ]);
    // The script filters on this rather than lowercasing on every keystroke.
    expect(options[0]!.dataset.label).toBe("sql & data analysis");
    // aria-activedescendant needs a real id on each row.
    expect(options.map((o) => o.id)).toEqual([
      "goal-opt-0",
      "goal-opt-1",
      "goal-opt-2",
    ]);
  });

  it("carries a build-it row that starts hidden and explains the questions", () => {
    const { container } = render(<GoalSearch suggestions={subjects} />);
    const custom = container.querySelector<HTMLElement>("[data-goal-custom]")!;

    // Hidden until something is typed — with an empty box there is nothing to
    // build yet, and the row would be offering to build "".
    expect(custom.hidden).toBe(true);
    expect(custom.dataset.href).toBe("/start");
    expect(custom.textContent).toContain("what you want to be able to do");
    expect(custom.textContent).toContain("how many hours a week you have");
    // The script writes the typed text in here.
    expect(container.querySelector("[data-goal-custom-label]")).not.toBeNull();
  });

  it("carries no datalist, so nothing is mutated before hydration", () => {
    const { container } = render(<GoalSearch suggestions={subjects} />);

    // A datalist meant the script had to strip the input's `list` before the
    // native popup could open — a write to a React-rendered attribute *before*
    // hydration, which React reports as a mismatch and refuses to patch. The
    // fallback it bought was a typeahead over three names; the real fallback
    // for a visitor with no JavaScript is submitting the form to /learn.
    expect(container.querySelector("datalist")).toBeNull();
    expect(field().getAttribute("list")).toBeNull();
  });

  it("still submits to /learn with no JavaScript at all", () => {
    render(<GoalSearch suggestions={subjects} />);
    // The dropdown is an enhancement. The control underneath it is a GET form,
    // and /learn answers the same question on the server — including the offer
    // to build a subject we do not have.
    const form = screen.getByRole("search");
    expect(form.getAttribute("action")).toBe("/learn");
    expect(screen.getByRole("button", { name: /show me/i }).getAttribute("type")).toBe(
      "submit",
    );
  });

  it("renders no script of its own — the driver lives in <head>", () => {
    const { container } = render(<GoalSearch suggestions={subjects} />);
    // Next streams the page, so body content arriving in a later chunk is
    // inserted rather than parsed — and an inserted <script> does not run.
    // React re-creates it at hydration, so a script here leaves the control
    // dead until then and drops every press in between.
    expect(container.querySelector("script")).toBeNull();
  });
});

describe("goalSearchScript", () => {
  it("is inline vanilla, not a client component (§8.5.8)", () => {
    // §8.5.8's rule is about component-library JS. This is the same bargain
    // ThemeToggleStatic makes: a few KB inline, no framework. The ceiling is a
    // tripwire against this quietly growing into one, not a §13.3 budget —
    // the whole marketing first-load allowance is 80KB.
    expect(goalSearchScript.length).toBeLessThan(4000);
    expect(goalSearchScript).toContain("data-goal-search");
  });

  it("delegates from document rather than binding to the field", () => {
    // A listener bound to a node found at parse time is lost the moment React
    // hydrates over that node. The first version bound to the input directly
    // and the field was dead on the page while passing every test.
    expect(goalSearchScript).not.toMatch(/input\.addEventListener/);
    expect(goalSearchScript).toContain("D.addEventListener");
  });

  it("opens on the press, not on the click", () => {
    // React can replace the subtree mid-press, and a press that starts on the
    // old node and ends on the new one fires no click at all.
    expect(goalSearchScript).toContain('D.addEventListener("pointerdown"');
  });

  it("guards against binding twice when React re-inserts it", () => {
    expect(goalSearchScript).toContain("goalSearchBound");
  });

  it("builds the build-it row's link from the one shared helper", () => {
    // Not a second hand-written "/start?topic=" that can drift from the one
    // /learn and /start agree on.
    expect(goalSearchScript).toContain(JSON.stringify(CUSTOM_PATH_HREF));
  });
});

/*
 * The same script, actually running.
 *
 * Everything above reads its source, which catches a renamed selector and very
 * little else — the panel opening off the bottom of the screen passed every one
 * of those assertions. These bind it to the document, render the control under
 * it, and use the field the way a person does.
 *
 * The geometry is stubbed because jsdom measures everything as zero. The
 * numbers are a 779px-tall laptop window, which is where the landing page's
 * input sits ~75px above the fold.
 */
describe("goalSearchScript, running", () => {
  const subjects = [
    { label: "SQL & Data Analysis", href: "/learn/sql-data-analysis" },
    { label: "Photography", href: "/learn/photography" },
  ];

  beforeAll(() => {
    new Function(goalSearchScript)();
  });

  /** The control, with the field pinned where `top`/`bottom` say it is. */
  function mount(
    box: { top: number; bottom: number },
    { content = 400, viewport = 779 } = {},
  ) {
    const { container } = render(<GoalSearch suggestions={subjects} />);
    const input = container.querySelector<HTMLInputElement>("input[name=q]")!;
    const list = container.querySelector<HTMLElement>("[data-goal-list]")!;

    Object.defineProperty(window, "innerHeight", {
      value: viewport,
      configurable: true,
    });
    input.getBoundingClientRect = () => ({ ...box }) as DOMRect;
    Object.defineProperty(list, "scrollHeight", {
      value: content,
      configurable: true,
    });

    return {
      input,
      list,
      custom: container.querySelector<HTMLElement>("[data-goal-custom]")!,
    };
  }

  const press = (el: Element) =>
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("drops the panel under the field when there is room under it", () => {
    // 779 − 256 − 16 = 507px below. Nothing to correct, so the stylesheet's
    // own `top` stands and no inline placement is written at all.
    const { input, list } = mount({ top: 200, bottom: 256 });
    press(input);

    expect(list.hidden).toBe(false);
    expect(list.style.top).toBe("");
    expect(list.style.bottom).toBe("");
  });

  it("flips it above the field when the fold is right underneath", () => {
    // The landing page: 58px below the input, 633 above it. Dropping down
    // spent all but one row of the list off-screen.
    const { input, list } = mount({ top: 649, bottom: 705 });
    press(input);

    expect(list.style.top).toBe("auto");
    expect(list.style.bottom).toBe("calc(100% + 0.5rem)");
  });

  it("would rather scroll than flip on a near miss", () => {
    // 208px below — short of the 400px list, but four rows is still a list
    // worth reading, and there are only 24px above. Flipping on an exact fit
    // makes the panel change sides between one keystroke and the next.
    const { input, list } = mount({ top: 40, bottom: 96 }, { viewport: 320 });
    press(input);

    expect(list.style.bottom).toBe("");
    // And it stops at the window's edge rather than running past it.
    expect(list.style.maxHeight).toBe("208px");
  });

  it("clears the build-it row's rule when it is the only row left", () => {
    const { input, custom } = mount({ top: 200, bottom: 256 });

    type(input, "sql");
    // A rule between the subjects we have and the offer to write one we don't.
    expect(custom.style.borderTopWidth).toBe("");

    type(input, "zzz");
    // Nothing above it to divide it from: the rule was drawing a hairline
    // across the top of the panel, just under the panel's own border.
    expect(custom.style.borderTopWidth).toBe("0px");
    expect(custom.style.marginTop).toBe("0px");
  });

  it("closes on Escape without emptying the field", () => {
    const { input, list } = mount({ top: 200, bottom: 256 });
    press(input);
    type(input, "zzz");

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(escape);

    expect(list.hidden).toBe(true);
    // Escape's native behaviour on a `type=search` field is to empty it, which
    // fires `input`, which re-opens the panel we just shut — so the press wiped
    // the query and left the list standing, both halves backwards.
    expect(escape.defaultPrevented).toBe(true);
    expect(input.value).toBe("zzz");
  });
});

describe("CustomPathOffer", () => {
  it("offers to build the subject, and says what it will ask", () => {
    render(<CustomPathOffer topic="basket weaving" />);

    expect(screen.getByRole("heading").textContent).toContain("basket weaving");
    // The three things §8 screen 3 actually asks. A vague "we'll ask a few
    // questions" is the version that makes people bounce.
    expect(screen.getByText(/what you want to be able to do/i)).toBeDefined();
    expect(screen.getByText(/where you're starting from/i)).toBeDefined();
    expect(screen.getByText(/how many hours a week/i)).toBeDefined();
  });

  it("links to the intake with the subject already in hand", () => {
    render(<CustomPathOffer topic="basket weaving" />);
    expect(
      screen.getByRole("link", { name: /build my path/i }).getAttribute("href"),
    ).toBe("/start?topic=basket%20weaving");
  });

  it("says a built subject is Experimental before it is offered (§7.1)", () => {
    // The offer is the one place overclaiming would be easiest and worst.
    render(<CustomPathOffer topic="basket weaving" />);
    expect(screen.getByText("Experimental")).toBeDefined();
  });
});

describe("ProjectStartOffer", () => {
  it("names the brief by slug, so /start resolves the wording itself", () => {
    render(<ProjectStartOffer slug="sales-dashboard" topicName="SQL" />);

    const href = screen
      .getByRole("link", { name: /start the SQL course/i })
      .getAttribute("href");

    expect(href).toBe(projectStartHref("sales-dashboard"));
    // Not `?topic=`. That parameter means "a subject somebody typed", and
    // sending a brief through it is what made `/start` treat a deliberate
    // click like a vague search.
    expect(href).not.toContain("topic=");
  });

  it("says what setting up costs rather than promising a click", () => {
    // The brief promises marking against a published rubric; an offer that hid
    // the intake behind "start now" would be the page's one dishonest sentence.
    render(<ProjectStartOffer slug="sales-dashboard" topicName="SQL" />);
    expect(screen.getByText(/three minutes/i)).toBeDefined();
    expect(screen.getByText(/how many hours a week/i)).toBeDefined();
  });

  it("promises marking against the checklist already on the page", () => {
    render(<ProjectStartOffer slug="sales-dashboard" topicName="SQL" />);
    expect(screen.getByText(/checklist you have just read/i)).toBeDefined();
  });
});

describe("CheckStartOffer", () => {
  it("links to the intake holding the subject just checked", () => {
    render(<CheckStartOffer topicName="SQL" />);
    expect(
      screen.getByRole("link", { name: /build my path/i }).getAttribute("href"),
    ).toBe(topicStartHref("SQL"));
  });

  it("promises the answers carry, which is what the intake actually does", () => {
    // `finish` replays the anonymous check into seeded mastery, and the
    // projection then excludes what came back proven. The claim is only worth
    // making because that plumbing predates the card.
    render(<CheckStartOffer topicName="SQL" />);
    expect(screen.getByText(/what you just answered comes with you/i))
      .toBeDefined();
  });

  it("does not offer to work out where they are — they just proved it", () => {
    // TopicStartOffer's promise, which would read here as the product not
    // having noticed the ten minutes it just asked for.
    render(<CheckStartOffer topicName="SQL" />);
    expect(screen.queryByText(/work out where you already are/i)).toBeNull();
  });
});

describe("GuideStartOffer", () => {
  it("asks for a subject rather than assuming one", () => {
    // Six of the eight guides quote both Python and SQL, so a guessed subject
    // is wrong often enough to matter — the link is the bare intake.
    render(<GuideStartOffer />);
    expect(
      screen.getByRole("link", { name: /build my path/i }).getAttribute("href"),
    ).toBe(CUSTOM_PATH_HREF);
  });

  it("says an unwritten subject gets written, and stays Experimental", () => {
    // The one offer whose reader is most likely to want a subject we lack, so
    // §7.1's tier is the pitch here rather than a disclaimer.
    render(<GuideStartOffer />);
    expect(screen.getByText(/Experimental/)).toBeDefined();
  });
});

describe("TopicStartOffer", () => {
  it("names the subject and links to the intake holding it", () => {
    render(<TopicStartOffer topicName="SQL" />);

    expect(screen.getByRole("heading").textContent).toContain("SQL");
    expect(
      screen.getByRole("link", { name: /start this path/i }).getAttribute("href"),
    ).toBe(topicStartHref("SQL"));
  });

  it("does not claim the subject is missing, the way CustomPathOffer does", () => {
    // The two offers say opposite things and sit one route apart. This subject
    // exists — telling its own page's reader we would build it is the mistake
    // keeping them as separate components exists to prevent.
    render(<TopicStartOffer topicName="SQL" />);
    expect(screen.queryByText(/we.ll build it/i)).toBeNull();
    expect(screen.queryByText("Experimental")).toBeNull();
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

  /**
   * The rule a band opens with is drawn on the way in rather than printed —
   * `.rule-draw` in globals.css sweeps a pseudo-element from the left as the
   * band arrives, which is the cheapest way to make ten marketing routes answer
   * to the scroll for zero JavaScript.
   *
   * The field is the exception, and it is not a stylistic one: `onField` is
   * only ever used inside the pinned band, and a pinned element's own `view()`
   * timeline is frozen by definition. A sweep in there would stick half-drawn,
   * which reads as a rendering fault rather than as an effect — so that one
   * keeps the static border it always had.
   */
  it("draws its rule on the scroll, except where the scroll has stopped", () => {
    const { container: onGround } = render(
      <SectionHead {...props} icon={<StepsIcon />} />,
    );
    const { container: onField } = render(
      <SectionHead {...props} icon={<StepsIcon />} onField />,
    );

    expect(onGround.firstElementChild!.className).toContain("rule-draw");
    expect(onGround.firstElementChild!.className).not.toContain("border-t");

    expect(onField.firstElementChild!.className).toContain("border-t");
    expect(onField.firstElementChild!.className).not.toContain("rule-draw");
  });
});

/**
 * The FAQ's whole reason for being `<details>` rather than a scripted accordion
 * is that the answers are in the DOM whether or not they are open — the
 * `FAQPage` markup beside it promises Google exactly that, and a widget that
 * mounted an answer on click would quietly make the promise a lie. Every
 * assertion here is about that promise or about the disclosure being operable
 * without JavaScript.
 */
describe("FaqList", () => {
  const faqs = [
    { question: "Can I trust the marking?", answer: "You can check it." },
    { question: "What do I hand in?", answer: "Something you made." },
    { question: "What does it cost?", answer: "Nothing, to start." },
  ];

  it("puts every answer in the DOM, open or not", () => {
    render(<FaqList faqs={faqs} />);
    for (const faq of faqs) {
      expect(screen.getByText(faq.answer), faq.answer).toBeDefined();
    }
  });

  /** Without one open, the pattern is a list of headings nobody knows to press. */
  it("opens the first and leaves the rest shut", () => {
    const { container } = render(<FaqList faqs={faqs} />);
    const open = [...container.querySelectorAll("details")].map((d) => d.open);
    expect(open).toEqual([true, false, false]);
  });

  /**
   * The question is a heading inside the summary, which the spec allows —
   * `summary` takes "phrasing content, optionally intermixed with heading
   * content". It keeps the page outline intact and keeps each question
   * addressable by a reader navigating by headings, which is what the markup
   * claims about it.
   */
  it("makes each question a heading and the whole row the control", () => {
    const { container } = render(<FaqList faqs={faqs} />);
    const summaries = [...container.querySelectorAll("summary")];

    expect(summaries).toHaveLength(faqs.length);
    for (const [i, summary] of summaries.entries()) {
      expect(summary.querySelector("h2")!.textContent).toBe(faqs[i]!.question);
      // §8.5.5's touch minimum: a 13px question is not a 44px target on its own.
      expect(summary.className).toContain("min-h-[var(--touch-min)]");
    }
  });

  /**
   * A scroll-driven stagger rather than a delay, because a view timeline has no
   * clock to be late against — the same mechanism every other band on the
   * marketing surface uses.
   */
  it("staggers on the scroll rather than on a clock", () => {
    const { container } = render(<FaqList faqs={faqs} />);
    expect(container.querySelector(".rise")).toBeNull();
    expect(
      [...container.querySelectorAll(".reveal")].map((el) =>
        el.getAttribute("style"),
      ),
    ).toEqual([
      "--reveal-start: 0%;",
      "--reveal-start: 6%;",
      "--reveal-start: 12%;",
    ]);
  });

  it("draws nothing but the rule when there is nothing to ask", () => {
    const { container } = render(<FaqList faqs={[]} />);
    expect(container.querySelectorAll("details")).toHaveLength(0);
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
