import Link from "next/link";
import { cookies } from "next/headers";
import { ChevronIcon, SubjectIcon } from "@/components/icons";
import { Wordmark } from "@/components/logo";
import { ThemeToggleStatic } from "@/components/theme-toggle-static";
import {
  Card,
  cx,
  DisplayTitle,
  Lead,
  LinkCard,
  MaturityBadge,
  Meta,
  revealAt,
  Status,
  Title,
} from "@/components/ui";
import { currentUser } from "@/lib/account/session";
import { DEFAULT_DESTINATION } from "@/lib/account/next-url";
import { evalTierClaim } from "@/lib/claims";
import type { ProjectDetail, TopicSummary } from "@/lib/content";
import { CUSTOM_PATH_HREF, customPathHref } from "@/lib/goals/custom-path";
import { projectStartHref, topicStartHref } from "@/lib/goals/project-start";
import { serialise, type JsonLd } from "@/lib/seo/jsonld";
import type { Crumb } from "@/lib/seo/jsonld";
import { ROADMAP_TOOL_PATH } from "@/lib/roadmap/plan";
import { supportAddress } from "@/lib/site";
import { THEME_COOKIE, toThemeChoice } from "@/lib/theme-script";
import type { RubricCriterion } from "@/lib/packs/types";

/**
 * Marketing-only chrome.
 *
 * §8.5.8 — "Marketing routes ship zero component-library JS." Everything here
 * is a server component; the only script on the whole surface is the ~250-byte
 * inline theme handler. §8.5.1's density rule applies too: navigation recedes,
 * the content is the interface.
 */

/** §13.3 — visible breadcrumbs, paired with the BreadcrumbList markup. */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 list-none p-0 m-0">
        {crumbs.map((crumb, i) => (
          <li key={crumb.path} className="flex items-center gap-2">
            {i > 0 ? (
              <span aria-hidden="true" className="text-ink-faint">
                /
              </span>
            ) : null}
            {i === crumbs.length - 1 ? (
              <Meta aria-current="page">{crumb.name}</Meta>
            ) : (
              <Link
                href={crumb.path}
                className="text-[length:var(--text-meta-size)] text-ink-muted hover:text-accent"
              >
                {crumb.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * §8.5.9 — the marketing page frame.
 *
 * One width and one vertical rhythm for every route, so moving between pages
 * does not move the content under the reader. The pages used to pick their own
 * (`max-w-2xl` here, `max-w-3xl` there), which is the sort of drift nobody
 * notices on any single page and everybody feels across four.
 *
 * `narrow` is the one exception, for a screen that is a task rather than a
 * document — the running skill check, where §8.5.1's "one idea per screen"
 * beats a consistent width.
 */
export function PageFrame({
  crumbs,
  narrow = false,
  className,
  children,
}: {
  crumbs: Crumb[];
  narrow?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={cx(
        "mx-auto flex flex-col gap-16 px-6 pt-10 pb-28",
        narrow ? "max-w-2xl" : "max-w-5xl",
        className,
      )}
    >
      <Breadcrumbs crumbs={crumbs} />
      {children}
    </main>
  );
}

/**
 * The top of a marketing page: title, one lead, and a row of facts.
 *
 * Exists so the four routes cannot drift into four different header shapes,
 * which is exactly what had happened — one had an icon beside the title, one
 * put its metadata above the lead, one had no metadata row at all.
 */
export function PageIntro({
  icon,
  title,
  lead,
  facts,
  action,
}: {
  /** Decorative; the title beside it already says the same thing. */
  icon?: React.ReactNode;
  title: string;
  lead: string;
  /** Status dots, durations, counts — the row under the lead. */
  facts?: React.ReactNode;
  /** At most one, and only when the page has an obvious next step. */
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-6">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          {icon ? (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-accent">
              {icon}
            </span>
          ) : null}
          <DisplayTitle>{title}</DisplayTitle>
        </div>
        <Lead>{lead}</Lead>
      </div>

      {facts ? (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-hairline pt-5">
          {facts}
        </div>
      ) : null}

      {action}
    </header>
  );
}

export function JsonLdScript({ blocks }: { blocks: JsonLd[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serialise(...blocks) }}
    />
  );
}

/**
 * The one component on the marketing surface that knows who is looking.
 *
 * It reads the session, which is why every route under `(marketing)/layout`
 * now renders per request instead of being prerendered daily. That is the cost
 * of the header telling the truth: whether there is a session lives in the
 * request's cookie, and a page built once and served to everyone cannot hold a
 * per-person answer. It is a deliberate trade, not an oversight — §13.3's
 * static guarantee now covers the OG image routes and `sitemap`/`robots`,
 * which have no header, rather than the pages.
 *
 * Signed in, the sign-in link is not rendered at all. What takes its place is
 * the thing the click actually meant — the way back into the app — because a
 * nav with a hole in it strands the person it was hiding the button from.
 */
export async function SiteHeader() {
  const user = await currentUser();

  return (
    <header className="border-b border-hairline">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5 sm:gap-6">
        <Link href="/">
          <Wordmark />
        </Link>
        {/*
         * §8.5.5 — three destinations, flat, no nesting.
         *
         * `whitespace-nowrap` and a tighter gap under `sm` because the widest
         * label is "Keep learning", and at 390px the wordmark plus three links
         * plus three 24px gaps overran the line: the last link broke across two
         * rows and took the header's height with it. A destination that wraps
         * mid-phrase reads as two destinations.
         */}
        <nav aria-label="Main" className="flex items-center gap-4 sm:gap-6">
          <Link
            href="/learn"
            className="whitespace-nowrap text-[length:var(--text-label-size)] text-ink-muted hover:text-accent"
          >
            Learn
          </Link>
          <Link
            href="/projects"
            className="whitespace-nowrap text-[length:var(--text-label-size)] text-ink-muted hover:text-accent"
          >
            Projects
          </Link>
          <Link
            href={user ? DEFAULT_DESTINATION : "/sign-in"}
            className="whitespace-nowrap text-[length:var(--text-label-size)] font-[550] text-accent"
          >
            {user ? "Keep learning" : "Sign in"}
          </Link>
        </nav>
      </div>
    </header>
  );
}

/**
 * §13.3's internal-link rule, applied to the site rather than to a page.
 *
 * The footer exists because two page types had no site-wide link at all: the
 * guides hub, which could only be reached from a breadcrumb *on a guide* — so
 * you could only find the index if you were already past it — and the legal
 * pages, which every visitor is entitled to find without hunting.
 *
 * It is deliberately short. §8.5.1 bans a link dump and §8 screen 1 gives the
 * landing page exactly one job, so the header still carries only the two
 * destinations a browsing visitor wants. Everything else lives down here, which
 * is where people look for it.
 */
const FOOTER_LINKS: Array<{ title: string; links: Array<[string, string]> }> = [
  {
    title: "Explore",
    links: [
      ["Subjects", "/learn"],
      ["Graded projects", "/projects"],
      ["Guides", "/guides"],
      ["Roadmap tool", ROADMAP_TOOL_PATH],
    ],
  },
  {
    title: "Legal",
    links: [
      ["Terms", "/terms"],
      ["Privacy", "/privacy"],
    ],
  },
];

export async function SiteFooter() {
  // The theme cookie, read here for the toggle below. It costs nothing: these
  // routes already render per request because `SiteHeader` reads the session.
  const jar = await cookies();
  const theme = toThemeChoice(jar.get(THEME_COOKIE)?.value);

  return (
    <footer className="mt-24 border-t border-hairline">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex max-w-md flex-col gap-4">
          <Wordmark />
          {/* The headline already makes the "prove you learned it" point, so
              the footer carries the second half of the promise instead of
              restating the first. */}
          <Meta>
            Every checklist on this site is the one your work is really marked
            against, and you can read it before you start.
          </Meta>
          <Meta>Nothing counts as proof until your work has been marked.</Meta>
          {/*
           * The one address a stranger can write to. It sits with the wordmark
           * rather than in a rule-separated strip underneath: a footer divided
           * into two bands reads as a footer with something appended below it,
           * and the thing that kept getting appended was whatever had no other
           * home. There is one band now, and nothing hangs off it.
           */}
          <a
            href={`mailto:${supportAddress()}`}
            className="text-[length:var(--text-label-size)] text-ink-muted hover:text-accent"
          >
            {supportAddress()}
          </a>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-16 gap-y-8">
          {FOOTER_LINKS.map((group) => (
            <div key={group.title} className="flex flex-col gap-3">
              <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
                {group.title}
              </span>
              <ul className="flex list-none flex-col gap-2 p-0 m-0">
                {group.links.map(([label, href]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="text-[length:var(--text-label-size)] text-ink-muted hover:text-accent"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/*
           * §8.5.4 puts a small theme control on the marketing pages, and it
           * belongs *in* the footer rather than hanging off the bottom of it.
           * It used to sit on its own rule beside the wordmark, which read as
           * chrome appended below the footer instead of one of the things the
           * footer offers — and it is the same kind of thing as the links
           * beside it: something you might want, once, and then never again.
           *
           * Its real home is Settings → Appearance, which §8.5.4 also
           * specifies and which now exists on `/account`. This one is for the
           * reader who has no account to go to.
           */}
          <div className="flex flex-col gap-3">
            <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
              Appearance
            </span>
            <ThemeToggleStatic pressed={theme} />
          </div>
        </nav>
      </div>
    </footer>
  );
}

/** One row of the goal search's dropdown: something we already teach. */
export interface GoalSuggestion {
  label: string;
  /** Where picking it goes — a subject page, or a project page. */
  href: string;
}

/**
 * §8 screen 1 — "one input: *What do you want to get good at?*"
 *
 * A GET form that still works with JavaScript off — it submits to `/learn`,
 * which answers the same question on the server, including the offer to build
 * a subject we do not have.
 *
 * The dropdown that sits over it is driven by `goalSearchScript`, which the
 * root layout puts in `<head>`. It is not rendered here on purpose: a script
 * inside streamed body content is inserted rather than parsed, so it does not
 * run until React re-creates it at hydration — and every press before that is
 * lost, which is the exact failure this control exists to fix.
 */
export function GoalSearch({
  suggestions,
  defaultValue = "",
  autoFocus = false,
  size = "default",
}: {
  suggestions: GoalSuggestion[];
  defaultValue?: string;
  autoFocus?: boolean;
  /**
   * `hero` is the landing page's one input, and it is the only control above
   * the fold — at the default row height it read as a filter box on a search
   * results page rather than as the thing the whole product starts with.
   */
  size?: "default" | "hero";
}) {
  const hero = size === "hero";

  return (
    <form
      action="/learn"
      method="get"
      role="search"
      data-goal-search
      className={cx(
        "flex flex-col gap-3 sm:flex-row",
        hero && "w-full max-w-xl",
      )}
    >
      <label htmlFor="goal-q" className="sr-only">
        What do you want to get good at?
      </label>

      {/* The anchor for the panel, which is positioned against the field
          rather than the row — the submit button sits beside it at ≥640px. */}
      <div className="relative flex-1">
        <input
          id="goal-q"
          name="q"
          type="search"
          role="combobox"
          aria-expanded="false"
          aria-controls="goal-listbox"
          aria-autocomplete="list"
          autoComplete="off"
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          placeholder="What do you want to get good at?"
          className={cx(
            "w-full min-h-[var(--touch-min)] px-5",
            "rounded-[var(--radius-control)] border border-hairline bg-surface text-ink",
            "text-[length:var(--text-lead-size)] placeholder:text-ink-faint",
            "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            "focus:border-accent",
            hero && "h-14 shadow-[var(--shadow-raised)]",
          )}
        />

        <ul
          id="goal-listbox"
          role="listbox"
          aria-label="Subjects"
          data-goal-list
          hidden
          className={cx(
            "absolute inset-x-0 top-[calc(100%+0.5rem)] z-20 m-0 max-h-80 overflow-y-auto p-1.5",
            "list-none rounded-[var(--radius-card)] border border-hairline",
            "bg-surface shadow-[var(--shadow-raised)]",
          )}
        >
          {suggestions.map((s, i) => (
            <li
              key={s.href}
              id={`goal-opt-${i}`}
              role="option"
              aria-selected="false"
              data-label={s.label.toLowerCase()}
              data-href={s.href}
              className={cx(
                "flex min-h-[var(--touch-min)] cursor-pointer items-center rounded-[var(--radius-control)] px-3.5",
                "text-[length:var(--text-label-size)] font-[550] text-ink",
                "hover:bg-accent-weak aria-selected:bg-accent-weak",
              )}
            >
              {s.label}
            </li>
          ))}

          {/*
           * The row the native control could not have. §7.1's Generated tier
           * is the product's actual answer to a subject we do not cover, and a
           * search box that only ever offers three things hides it.
           *
           * The rule above it separates it from the subjects we already have,
           * so it is only a rule when there are any: on a query that matches
           * nothing — the case this row exists for — it was drawing a hairline
           * across the top of the panel, a hand's width under the panel's own
           * border, dividing the list from nothing. `sift` clears it and the
           * margin with it whenever this is the only row left.
           */}
          <li
            id={`goal-opt-${suggestions.length}`}
            role="option"
            aria-selected="false"
            data-goal-custom
            data-href={CUSTOM_PATH_HREF}
            hidden
            className={cx(
              "mt-1.5 flex cursor-pointer flex-col gap-1 rounded-[var(--radius-control)] px-3.5 py-3",
              "border-t border-hairline",
              "hover:bg-accent-weak aria-selected:bg-accent-weak",
            )}
          >
            <span className="text-[length:var(--text-label-size)] font-[550] text-accent">
              Build a path for &ldquo;
              <span data-goal-custom-label />
              &rdquo;
            </span>
            <span className="text-[length:var(--text-meta-size)] text-ink-muted">
              We ask a few questions — what you want to be able to do, where
              you&rsquo;re starting from, and how many hours a week you have —
              then build it.
            </span>
          </li>
        </ul>
      </div>

      <button
        type="submit"
        className={cx(
          "min-h-[var(--touch-min)] px-6 rounded-[var(--radius-control)]",
          "bg-accent text-on-accent text-[length:var(--text-label-size)] font-[550]",
          "hover:opacity-90 transition-opacity duration-[var(--dur-fast)]",
          hero && "h-14 px-8",
        )}
      >
        Show me
      </button>
    </form>
  );
}

/**
 * What `/learn` says instead of a shrug when a search finds nothing.
 *
 * "Nothing matches X yet. Everything we cover so far is below" was accurate and
 * useless: the product's answer to a subject it does not have is to *build* it
 * (§7.1's Generated tier), and the one screen where a visitor has just proved
 * they want something we lack was the one screen that never said so.
 *
 * The questions are listed rather than promised vaguely, because the honest
 * version of "we'll build it" includes the three minutes it costs.
 */
export function CustomPathOffer({ topic }: { topic: string }) {
  const asks = [
    "What you want to be able to do — not the subject, the thing you want to do with it",
    "Where you're starting from, so the plan skips what you can already do",
    "How many hours a week you actually have, and any deadline you're working to",
  ];

  return (
    <Card className="flex flex-col items-start gap-5">
      <Title>
        Nothing covers &ldquo;{topic}&rdquo; yet. We&rsquo;ll build it.
      </Title>
      <Lead>
        Tell us a bit more and we write the skills, work out what depends on
        what, and put together the questions that find where you already are. It
        takes about three minutes.
      </Lead>

      <ul className="flex list-none flex-col gap-2 p-0 m-0">
        {asks.map((ask) => (
          <li key={ask} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-accent"
            />
            <Meta>{ask}</Meta>
          </li>
        ))}
      </ul>

      <Meta tone="muted">
        A subject we build for you is marked <strong>Experimental</strong> until
        a person has reviewed it, so you always know which you are looking at.
      </Meta>

      <Link href={customPathHref(topic)} className={CTA_LINK}>
        Build my path
      </Link>
    </Card>
  );
}

/**
 * The primary action on a marketing page, which there is now more than one of.
 *
 * Extracted rather than copied a third time. The three offers below and above
 * are the whole conversion surface, and a hover state or a touch target that
 * held on two of them would be the kind of difference nobody notices until the
 * one page it is missing from is the one being measured.
 */
const CTA_LINK =
  "min-h-[var(--touch-min)] inline-flex items-center rounded-[var(--radius-control)] bg-accent px-5 font-[550] text-on-accent transition-opacity duration-[var(--dur-fast)] hover:opacity-90";

/**
 * What a graded brief says once the reader has finished the rubric.
 *
 * The page's argument peaks at the checklist — every criterion, every band,
 * published before the work — and then used to stop, leaving breadcrumbs back
 * to the subject as the only way on. This is the sentence that follows it, and
 * it names the exchange in the reader's terms: they have just read the standard
 * they would be held to, so the offer is to be held to it.
 *
 * It says what setting up costs, for the same reason `CustomPathOffer` lists
 * its three questions rather than promising vaguely: the honest version of
 * "start this project" includes the intake standing between them and it.
 *
 * And it names the course, because "Start this project" was not the honest
 * version of what the button does either. A brief is not something you can take
 * on its own: it belongs to exactly one pack, is marked against that pack's
 * rubric, and proves that pack's skills. Pressing this enrols the reader in the
 * whole course — which was already true, was said once in a breadcrumb under
 * the fold, and above it read as a menu of standalone projects sitting beside a
 * separate menu of subjects.
 */
export function ProjectStartOffer({
  slug,
  topicName,
}: {
  /** The brief's own slug — `/start` resolves the wording from it. */
  slug: string;
  topicName: string;
}) {
  return (
    <Card className="flex flex-col items-start gap-5">
      <Title>This brief is part of the {topicName} course</Title>
      <Lead>
        Starting it starts the course: every skill above, in the order they
        depend on each other, with this brief at the end as the thing you hand
        in — marked against the checklist you have just read and nothing else.
      </Lead>
      <Meta tone="muted">
        About three minutes to set up: what you want to do with {topicName},
        where you are starting from, and how many hours a week you actually
        have. The subject we already have from this page.
      </Meta>
      <Link href={projectStartHref(slug)} className={CTA_LINK}>
        Start the {topicName} course
      </Link>
    </Card>
  );
}

/**
 * The same exit from a subject page.
 *
 * Distinct from `CustomPathOffer` because the two say opposite things: that one
 * answers "we do not have this yet, we will build it", and this one answers "we
 * have this, here is how you begin". A single component parameterised over both
 * would be one component that has to keep straight which of the two claims it
 * is making, on the surface where a wrong claim is the expensive kind.
 */
/**
 * The exit from a guide, where the reader's subject is genuinely not known.
 *
 * Every other offer on this surface names a subject because its page had one.
 * A guide has a *question* — "why am I stuck in tutorial hell" — and the two
 * subjects it happens to quote figures from are evidence it is specific, not
 * evidence of what the reader wants. Six of the eight guides cite both Python
 * and SQL, so picking the most-cited one would push Python at a reader who
 * arrived on "how long does it take to learn SQL" often enough to matter.
 *
 * So this one asks instead of assuming, and the gap case is the honest thing to
 * advertise here rather than a footnote: a reader who came for a question about
 * learning in general is the likeliest of anyone on this surface to want a
 * subject nobody has written yet.
 */
export function GuideStartOffer() {
  return (
    <Card className="flex flex-col items-start gap-5">
      <Title>Put this into practice</Title>
      <Lead>
        Reading about how to learn is the easy half. Tell us what you are
        actually trying to get good at, and we will build the path — the skills
        in the order they depend on each other, and marked work to prove you got
        there.
      </Lead>
      <Meta tone="muted">
        About three minutes. If we do not cover your subject yet, we will write
        it — and say it is Experimental until somebody has checked it.
      </Meta>
      <Link href={CUSTOM_PATH_HREF} className={CTA_LINK}>
        Build my path
      </Link>
    </Card>
  );
}

/**
 * The exit from a finished check, which is the highest-intent screen we have.
 *
 * Distinct from `TopicStartOffer` because that one promises to work out where
 * the reader is, and this reader has just spent ten minutes proving it. Saying
 * it again here would read as the product not having noticed.
 *
 * The promise it makes instead is one the plumbing already keeps: `finish` in
 * the intake replays the anonymous check into seeded mastery (§24 E11), and the
 * projection then excludes what came back proven, with a reason the learner can
 * read on `/today`. That was true before this card existed and no screen said
 * so — the ten minutes looked like they bought nothing.
 *
 * It says what carries rather than how, which is the rule for every sentence on
 * this surface: the mechanism is ours, the consequence is theirs.
 */
export function CheckStartOffer({ topicName }: { topicName: string }) {
  return (
    <Card className="flex flex-col items-start gap-5">
      <Title>Turn this into a plan</Title>
      <Lead>
        What you just answered comes with you. The path starts from where this
        check put you rather than from nothing, and skips the skills you already
        cleared — each one saying which answer of yours retired it.
      </Lead>
      <Meta tone="muted">
        About three minutes to set up: what you want to do with {topicName}, and
        how many hours a week you actually have.
      </Meta>
      <Link href={topicStartHref(topicName)} className={CTA_LINK}>
        Build my path
      </Link>
    </Card>
  );
}

export function TopicStartOffer({ topicName }: { topicName: string }) {
  return (
    <Card className="flex flex-col items-start gap-5">
      <Title>Start on {topicName}</Title>
      <Lead>
        Every skill above, ordered by what depends on what, with the projects
        above that as the evidence you actually did it. We work out where you
        already are first, so the path skips what you can do.
      </Lead>
      <Meta tone="muted">
        About three minutes to set up. Nothing is marked until you hand
        something in.
      </Meta>
      <Link href={topicStartHref(topicName)} className={CTA_LINK}>
        Start this path
      </Link>
    </Card>
  );
}

/**
 * §8.5.1 — "the content is the interface", which only works if a reader can
 * see where one thing ends and the next begins. Without a marker every section
 * is a Title over prose at the same weight, and the page reads as one long
 * list. The numbered eyebrow gives the eye somewhere to land and tells a
 * skimmer how much is left.
 */
export function SectionHead({
  step,
  label,
  title,
  icon,
  onField = false,
}: {
  step: string;
  label: string;
  title: string;
  /** Decorative — the eyebrow beside it already carries the meaning. */
  icon: React.ReactNode;
  /**
   * True when the head sits on the `--accent-weak` field rather than on
   * `--ground`. The accent-on-accent-weak pair measures 4.83:1 in light, which
   * passes, but the *chip* behind the icon disappears entirely — same fill as
   * the field. On the field it becomes a surface chip instead.
   */
  onField?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col gap-3 pt-8",
        /*
         * The rule is drawn on the way in (`.rule-draw` in globals.css) rather
         * than printed — except on the field, which is the pinned band, and a
         * pinned element's own `view()` timeline is frozen by definition. A
         * scroll-driven sweep in there would stick half-drawn, which is a
         * rendering fault rather than an effect, so that one keeps its border.
         */
        onField ? "border-t border-accent/20" : "rule-draw",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cx(
            "flex size-9 items-center justify-center rounded-[var(--radius-control)] text-accent",
            onField ? "bg-surface shadow-[var(--shadow-raised)]" : "bg-accent-weak",
          )}
        >
          {icon}
        </span>
        <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
          {step} · {label}
        </span>
      </div>
      <Title className="text-[length:var(--text-display-size)] leading-[var(--text-display-line)] tracking-[var(--text-display-tracking)]">
        {title}
      </Title>
    </div>
  );
}

/** One question and the answer to it. Both are plain text — see `FaqList`. */
export interface Faq {
  question: string;
  answer: string;
}

/**
 * A set of questions, folded away until one is wanted.
 *
 * Not cards, and that is a decision rather than a preference. A grid of
 * surfaces is for things you *compare* — three plans, four days, five steps. A
 * question is not one of a set: it is one thing you either wanted to know or
 * did not, and four of them drawn as four floating panels makes a page end on
 * yet another grid with the answers competing for attention nobody asked them
 * for. So the register changes — hairlines on the page ground, no elevation,
 * the answers closed until they are wanted. What a reader sees is the questions
 * at a glance, which is the actual job: they arrive already knowing which one
 * is theirs.
 *
 * `<details>` rather than anything scripted. §8.5.8 caps this surface at zero
 * component-library JavaScript, and the platform's own disclosure widget is
 * keyboard-operable, announces its own expanded state, and — the part that
 * matters — keeps every answer in the DOM. `faqPage` markup promises Google the
 * answers are on the page, and an accordion that mounted them on click would
 * quietly make that a lie.
 *
 * The answers are plain strings, not nodes, for the same reason: the same array
 * feeds the JSON-LD, and a link inside an answer would serialise as nothing.
 * Whatever a reader needs to click goes under the list, not inside it.
 *
 * The first is open, so the pattern is legible without a click.
 */
export function FaqList({ faqs }: { faqs: readonly Faq[] }) {
  return (
    <div className="flex flex-col border-t border-hairline">
      {faqs.map((faq, i) => (
        <details
          key={faq.question}
          open={i === 0}
          style={revealAt(i)}
          className="reveal group border-b border-hairline"
        >
          {/*
            The heading lives inside the summary, which the spec allows —
            `summary` takes "phrasing content, optionally intermixed with
            heading content". It keeps the page outline intact and keeps each
            question addressable as a heading, which is what the markup claims
            about it.

            `list-none` plus the webkit pseudo removes the default triangle in
            both engines; the chevron below replaces it, on the side a reader
            looks for it.
          */}
          <summary
            className={cx(
              "flex min-h-[var(--touch-min)] cursor-pointer list-none items-center justify-between gap-4 py-4 sm:gap-6 sm:py-5",
              "[&::-webkit-details-marker]:hidden",
              "transition-colors duration-[var(--dur-fast)] hover:text-accent",
            )}
          >
            <h2 className="m-0 text-[length:var(--text-lead-size)] font-semibold leading-[var(--text-lead-line)] tracking-[var(--text-lead-tracking)]">
              {faq.question}
            </h2>
            {/* `ChevronIcon` points right (`m9 6 6 6-6 6`), so a quarter turn
                puts it face down when the answer is open — the disclosure
                affordance. A half turn, which is what an already-downward
                chevron would take, pointed it back at the question instead. */}
            <ChevronIcon className="shrink-0 text-ink-faint transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] group-open:rotate-90" />
          </summary>

          <p className="m-0 max-w-[var(--measure)] pb-6 text-[length:var(--text-body-size)] leading-[var(--text-body-line)] text-ink-muted">
            {faq.answer}
          </p>
        </details>
      ))}
    </div>
  );
}

/**
 * The band ladder — the single most convincing thing the product can put on a
 * landing page, and until now the one it threw away.
 *
 * The page used to render a rubric as `name … 35%`, which tells a visitor
 * nothing beyond "there is a rubric". The bands are where the actual promise
 * lives: *"Absent: the reader must reach the third paragraph to learn what
 * happened. Competent: the first sentence states the news plainly."* That is
 * §4.2 law 2 made legible — the grading standard, published before the work is
 * done, in language a visitor can check us against.
 *
 * Competent is marked as the pass bar, because a ladder with four rungs and no
 * marked line leaves the reader guessing which one they have to reach.
 */
export function RubricLadder({ criterion }: { criterion: RubricCriterion }) {
  const rungs = [
    { key: "absent", label: "Absent", text: criterion.bands.absent },
    { key: "developing", label: "Developing", text: criterion.bands.developing },
    { key: "competent", label: "Competent", text: criterion.bands.competent },
    { key: "strong", label: "Strong", text: criterion.bands.strong },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
          {criterion.name}
        </span>
        <span className="text-[length:var(--text-meta-size)] text-ink-muted">
          <span className="font-[650] text-ink">
            {Math.round(criterion.weight * 100)}%
          </span>{" "}
          of the grade
        </span>
      </div>

      <p className="m-0 max-w-[var(--measure)] text-[length:var(--text-label-size)] text-ink-muted">
        {criterion.description}
      </p>

      {/*
       * The rungs arrive in order as the ladder crosses the fold, rather than
       * all at once. This is the one place on the site where scroll-linked
       * motion is doing something other than decoration: the ladder is an
       * argument that reads bottom-up — Absent, then Developing, then the pass
       * mark — and building it in that order is how a reader who is scanning
       * still receives it in the order it was written.
       */}
      <ol className="flex list-none flex-col gap-0 p-0 m-0">
        {rungs.map((rung, i) => {
          // Competent and Strong are the two that count as a pass.
          const passing = i >= 2;
          return (
            <li
              key={rung.key}
              style={revealAt(i)}
              className={cx(
                "reveal flex flex-col gap-1 border-l-2 py-3 pl-4",
                passing ? "border-accent" : "border-hairline",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cx(
                    "text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.1em]",
                    passing ? "text-accent" : "text-ink-faint",
                  )}
                >
                  {rung.label}
                </span>
                {rung.key === "competent" ? (
                  <span className="text-[length:var(--text-meta-size)] text-ink-muted">
                    — this is the pass mark
                  </span>
                ) : null}
              </span>
              <span className="text-[length:var(--text-label-size)] text-ink-muted">
                {rung.text}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ── The two cards the catalogue is made of ─────────────────────────────── */

/**
 * Title type without the heading.
 *
 * A card is a link, and its title is the link's own label rather than a
 * section heading — an `<h2>` inside an `<li>` inside a group already headed by
 * an `<h3>` puts the outline in the wrong order for anyone navigating by
 * headings. Same size, same tracking, no landmark.
 */
export const CARD_TITLE =
  "text-[length:var(--text-title-size)] font-semibold leading-[var(--text-title-line)] tracking-[var(--text-title-tracking)] text-ink";

/**
 * A brief's opening, cut at a word rather than mid-syllable.
 *
 * `/projects` used `brief.slice(0, 160)`, which sheared words in half —
 * "What is being marked…", "Two things separate a real projection from a s…".
 * The first regex trims back to the last whitespace; the second drops the
 * punctuation that trim can leave stranded, because a cut that lands just after
 * a full stop otherwise reads `you state before you start.…`. Neither has a
 * branch: a `replace` whose pattern does not match returns the string it was
 * given, which is the right answer and not a case anyone has to test for.
 */
export function excerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text
    .slice(0, max)
    .replace(/\s+\S*$/, "")
    .replace(/[.,;:—-]+$/, "")}…`;
}

/**
 * One subject in a collection.
 *
 * Lived twice, character for character, in `/` and `/learn` — which is how the
 * two pages ended up showing four facts each in a line that wrapped to three
 * rows at a third of the grid width. One component, one decision about what a
 * subject card is worth saying.
 *
 * **Both claims or neither.** §7.1's maturity says how the material got
 * written; §7.2's tier says what marking it can honour. A card carrying one and
 * not the other tells half the story, and it is always the flattering half that
 * survives — so they are drawn together here rather than assembled per page.
 */
export function SubjectCard({ topic }: { topic: TopicSummary }) {
  return (
    <LinkCard href={`/learn/${topic.slug}`} className="gap-4 p-6">
      <span className="flex size-10 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-accent">
        <SubjectIcon taxonomyParent={topic.taxonomyParent} />
      </span>
      <span className={CARD_TITLE}>{topic.name}</span>
      {/* Three facts, not four. "N areas" was on here because the loader knew
          it, which is not a reason — nobody choosing a subject is counting its
          internal areas, and it was the fact that pushed the line to a third
          row on a 280px card. */}
      <Meta>
        {topic.skillCount} skills · {topic.projectCount} graded projects · about{" "}
        {topic.totalHours} hours
      </Meta>
      <span className="mt-auto flex flex-col gap-2 border-t border-hairline pt-4">
        <MaturityBadge maturity={topic.maturity} />
        <EvalTierNote tier={topic.evalTier} />
      </span>
    </LinkCard>
  );
}

/**
 * One graded brief in a collection.
 *
 * No subject label on it, deliberately: every list that draws these is grouped
 * by subject and headed with the subject's name, so a label on all twenty-two
 * cards would repeat the heading three centimetres below itself. If a flat list
 * of briefs is ever wanted again, the label belongs back here — but the flat
 * list is what `/projects` was before this, and the reason it was unreadable.
 */
export function BriefCard({ project }: { project: ProjectDetail }) {
  return (
    <LinkCard href={`/projects/${project.slug}`} className="gap-3 p-6">
      <span className={CARD_TITLE}>{project.title}</span>
      <span className="text-[length:var(--text-label-size)] leading-[var(--text-body-line)] text-ink-muted">
        {excerpt(project.brief, 150)}
      </span>
      <span className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-hairline pt-4">
        <Meta>{project.rubricDetail.criteria.length} criteria</Meta>
        <Meta>{project.estimatedMinutes} min</Meta>
        <Meta>Hand in: {project.evidenceType}</Meta>
      </span>
    </LinkCard>
  );
}

/**
 * §7.2's evaluation tier, written for a visitor rather than for us.
 *
 * The tier is the single most important honest thing on the site — it is the
 * difference between "we checked" and "we had a look" — and it was previously
 * phrased in our own vocabulary ("Verified: your work is run and checked"),
 * which reads as marketing noise to someone meeting the product for the first
 * time. Same promise, said the way a person would say it.
 */
export function EvalTierNote({ tier }: { tier: number }) {
  const entry = evalTierClaim(tier);
  return <Status tone={entry.tone}>{entry.label}</Status>;
}
