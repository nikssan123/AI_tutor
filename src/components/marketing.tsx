import Link from "next/link";
import { ThemeToggleStatic } from "@/components/theme-toggle-static";
import { Card, cx, DisplayTitle, Lead, Meta, Status, Title } from "@/components/ui";
import { evalTierClaim } from "@/lib/claims";
import { CUSTOM_PATH_HREF, customPathHref } from "@/lib/goals/custom-path";
import { serialise, type JsonLd } from "@/lib/seo/jsonld";
import type { Crumb } from "@/lib/seo/jsonld";
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

export function SiteHeader() {
  return (
    <header className="border-b border-hairline">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-5">
        <Link
          href="/"
          className="text-[length:var(--text-label-size)] font-[650] tracking-[-0.02em] text-ink"
        >
          online_uni
        </Link>
        {/* §8.5.5 — three destinations, flat, no nesting. */}
        <nav aria-label="Main" className="flex items-center gap-6">
          <Link
            href="/learn"
            className="text-[length:var(--text-label-size)] text-ink-muted hover:text-accent"
          >
            Learn
          </Link>
          <Link
            href="/projects"
            className="text-[length:var(--text-label-size)] text-ink-muted hover:text-accent"
          >
            Projects
          </Link>
          <Link
            href="/sign-in"
            className="text-[length:var(--text-label-size)] font-[550] text-accent"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-hairline">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex max-w-md flex-col gap-3">
          {/* The headline already makes the "prove you learned it" point, so
              the footer carries the second half of the promise instead of
              restating the first. */}
          <Meta>
            Every checklist on this site is the one your work is really marked
            against, and you can read it before you start.
          </Meta>
          <Meta>Nothing counts as proof until your work has been marked.</Meta>
        </div>
        {/* §8.5.4 — a small control in the footer, never floating chrome. */}
        <ThemeToggleStatic />
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

      <Link
        href={customPathHref(topic)}
        className="min-h-[var(--touch-min)] inline-flex items-center rounded-[var(--radius-control)] bg-accent px-5 font-[550] text-on-accent transition-opacity duration-[var(--dur-fast)] hover:opacity-90"
      >
        Build my path
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
        onField ? "border-t border-accent/20" : "border-t border-hairline",
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

      <ol className="flex list-none flex-col gap-0 p-0 m-0">
        {rungs.map((rung, i) => {
          // Competent and Strong are the two that count as a pass.
          const passing = i >= 2;
          return (
            <li
              key={rung.key}
              className={cx(
                "flex flex-col gap-1 border-l-2 py-3 pl-4",
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
