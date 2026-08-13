import Link from "next/link";
import { ThemeToggleStatic } from "@/components/theme-toggle-static";
import { cx, Meta, Status, Title } from "@/components/ui";
import { serialise, type JsonLd } from "@/lib/seo/jsonld";
import type { Crumb } from "@/lib/seo/jsonld";

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
          {/* The headline already makes the "nobody checks" point, so the
              footer carries the second half of the promise instead of
              restating the first. */}
          <Meta>
            Every marking checklist on this site is the one your work is
            actually graded against, and you can read it before you start.
          </Meta>
          <Meta>
            Nothing counts as proof unless something you made was looked at.
          </Meta>
        </div>
        {/* §8.5.4 — a small control in the footer, never floating chrome. */}
        <ThemeToggleStatic />
      </div>
    </footer>
  );
}

/**
 * §8 screen 1 — "one input: *What do you want to get good at?*"
 *
 * A plain GET form with a datalist: real autocomplete against real content,
 * and not a single byte of JavaScript. The AI clarification step it will
 * eventually open into is E3; until then it searches what the product can
 * actually teach today, which is the honest version of the same affordance.
 */
export function GoalSearch({
  suggestions,
  defaultValue = "",
  autoFocus = false,
}: {
  suggestions: string[];
  defaultValue?: string;
  autoFocus?: boolean;
}) {
  return (
    <form action="/learn" method="get" role="search" className="flex flex-col gap-3 sm:flex-row">
      <label htmlFor="goal-q" className="sr-only">
        What do you want to get good at?
      </label>
      <input
        id="goal-q"
        name="q"
        type="search"
        list="goal-suggestions"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        placeholder="What do you want to get good at?"
        className={cx(
          "flex-1 min-h-[var(--touch-min)] px-5",
          "rounded-[var(--radius-control)] border border-hairline bg-surface text-ink",
          "text-[length:var(--text-lead-size)] placeholder:text-ink-faint",
        )}
      />
      <datalist id="goal-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button
        type="submit"
        className={cx(
          "min-h-[var(--touch-min)] px-6 rounded-[var(--radius-control)]",
          "bg-accent text-white text-[length:var(--text-label-size)] font-[550]",
          "hover:opacity-90 transition-opacity duration-[var(--dur-fast)]",
        )}
      >
        Show me
      </button>
    </form>
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
}: {
  step: string;
  label: string;
  title: string;
  /** Decorative — the eyebrow beside it already carries the meaning. */
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-hairline pt-8">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-accent">
          {icon}
        </span>
        <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
          {step} · {label}
        </span>
      </div>
      <Title>{title}</Title>
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
  const copy: Record<number, { tone: Parameters<typeof Status>[0]["tone"]; text: string }> = {
    1: { tone: "verified", text: "We run your work and check the answer is right" },
    2: { tone: "verified", text: "We grade it against a checklist you can read first" },
    3: { tone: "attention", text: "We check the technical side — whether it's any good is your call" },
    4: { tone: "attention", text: "We score the parts that can be measured" },
    5: { tone: "neutral", text: "You log this one yourself; it doesn't count as proof" },
  };
  const entry = copy[tier] ?? copy[5]!;
  return <Status tone={entry.tone}>{entry.text}</Status>;
}
