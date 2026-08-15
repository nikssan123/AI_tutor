import * as React from "react";
import Link from "next/link";
import { maturityClaim, type Maturity } from "@/lib/claims";
import type { ReviewKind } from "@/lib/packs/types";

/**
 * §8.5.5 — the component vocabulary.
 *
 * Deliberately small: roughly 18 components carry the entire product, named for
 * what they do rather than after a platform. The banned list in §8.5.5 is as
 * load-bearing as the allowed one — no data tables, no percentage progress
 * bars, no badge soup, no monospace outside code artefacts, no second accent.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Typography ─────────────────────────────────────────────────────────── */

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement>;

/**
 * §8.5.3 — the marketing headline, and the only user of the `hero` size.
 *
 * Product screens use `DisplayTitle`; this exists because a landing page has to
 * carry the whole proposition in one glance and 40px does not, on a desktop
 * viewport, look like the largest thing on a page. Fluid, so the phone still
 * renders it at the scale's 2.5rem.
 */
export function HeroTitle({ className, ...props }: HeadingProps) {
  return (
    <h1
      className={cx(
        "text-[length:var(--text-hero-size)] leading-[var(--text-hero-line)]",
        "font-[650] tracking-[var(--text-hero-tracking)] text-ink text-balance",
        className,
      )}
      {...props}
    />
  );
}

/** §8.5.5 — a static display title with generous space. Never collapse-on-scroll. */
export function DisplayTitle({ className, ...props }: HeadingProps) {
  return (
    <h1
      className={cx(
        "text-[length:var(--text-display-size)] leading-[var(--text-display-line)]",
        "font-[650] tracking-[var(--text-display-tracking)] text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function Title({ className, ...props }: HeadingProps) {
  return (
    <h2
      className={cx(
        "text-[length:var(--text-title-size)] leading-[var(--text-title-line)]",
        "font-semibold tracking-[var(--text-title-tracking)] text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function Lead({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cx(
        "text-[length:var(--text-lead-size)] leading-[var(--text-lead-line)]",
        "text-ink-muted max-w-[var(--measure)]",
        className,
      )}
      {...props}
    />
  );
}

export function Meta({
  className,
  tone = "faint",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  /**
   * `muted` exists for one measured reason: `--ink-faint` on `--accent-weak`
   * is 4.15:1 in light and 3.96:1 in dark, which clears the 3:1 large-text bar
   * but not the 4.5:1 bar that 13px meta text is held to (§8.5.4). Anything
   * sitting on the accent field steps up a level.
   *
   * A prop rather than a `className` override, because two competing
   * `text-ink-*` utilities resolve by stylesheet order, not by the order they
   * appear in the attribute — the override would work or not work depending on
   * which one Tailwind happened to emit last.
   */
  tone?: "faint" | "muted";
}) {
  return (
    <span
      className={cx(
        "text-[length:var(--text-meta-size)] leading-[var(--text-meta-line)]",
        "tracking-[var(--text-meta-tracking)]",
        tone === "faint" ? "text-ink-faint" : "text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

/**
 * One number, at display size, with the word that says what it is.
 *
 * A deliberate addition to §8.5.5's vocabulary, made for one reason: the
 * product screens had no size above `title` anywhere below the page heading,
 * so a week's worth of work and a form-field caption were set in the same
 * type. The figure is what lets a screen have a *loudest thing*.
 *
 * The ban it must not reopen is "dense metric grids" — so: **one per scroll
 * band, never a row of them**, and never a percentage (§4.2 law 3). It states
 * a count the learner earned, not a share of a total they did not choose.
 */
export function Figure({
  value,
  unit,
  caption,
}: {
  value: string | number;
  /** "hours", "skills" — set beside the number, not inside it. */
  unit?: string;
  caption: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={cx(
            "text-[length:var(--text-display-size)] leading-[var(--text-display-line)]",
            "font-[650] tracking-[var(--text-display-tracking)] text-ink tabular-nums",
          )}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[length:var(--text-lead-size)] text-ink-muted">
            {unit}
          </span>
        ) : null}
      </span>
      {/* `muted`, always. A figure's home is the accent field inside a
          `HeroBand`, and `--ink-faint` on `--accent-weak` measures 4.15:1 in
          light — over the 3:1 large-text bar, under the 4.5:1 one this 13px
          caption is held to (§8.5.4). One tone rather than a prop, because the
          caller cannot be relied on to know which field it landed on. */}
      <Meta tone="muted">{caption}</Meta>
    </div>
  );
}

/* ── Surfaces ───────────────────────────────────────────────────────────── */

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "bg-surface rounded-[var(--radius-card)] p-6",
        // §8.5.4 — in dark, elevation comes from a lighter surface, not shadow.
        "shadow-[var(--shadow-raised)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The one thing a screen is about, said once, at the top of it.
 *
 * `/today` worked this out first and nothing else copied it: a plain surface
 * card, the sentence that matters inset on the accent field, whatever supports
 * it underneath, and the actions on a bar ruled off at the bottom. The other
 * hero bands — `/progress`, `/calendar`, the marked-work verdict — tinted the
 * *whole* card `bg-accent-weak` instead, which reads as a different product:
 * a flat coloured slab against a card with a lit panel in it.
 *
 * One component, so "the hero band" is a thing the design has rather than a
 * shape each screen re-derives. The field is the accent panel; `children` is
 * the body under it; `footer` is the ruled bar, and only appears when there is
 * something to put on it.
 *
 * `justify-between` on the field is what lets the second half of a claim — the
 * status it carries, the confidence it is worth — sit against it rather than
 * under it. With one child it simply sits left.
 */
export function HeroBand({
  field,
  footer,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /** What goes on the accent panel. The loudest thing on the screen. */
  field: React.ReactNode;
  /** The ruled action bar. Omitted entirely when there is nothing to do. */
  footer?: React.ReactNode;
}) {
  return (
    <Card className={cx("p-0 overflow-hidden", className)} {...props}>
      <div className="flex flex-col gap-6 p-7">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-[var(--radius-card)] bg-accent-weak px-6 py-5">
          {field}
        </div>
        {children}
      </div>

      {footer ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline px-7 py-5">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * A `Card` you can click — the single most repeated pattern on the marketing
 * side, and the one that kept drifting.
 *
 * Every index page had hand-rolled its own version as `bg-surface p-5
 * hover:bg-accent-weak`, with no elevation at all. In light that is `#FFFFFF`
 * on `#FAFAFA`: a 2% value step, which is why those pages read as flat lists of
 * text rather than as cards. Existing as one component is what stops the next
 * page inventing a ninth variant.
 *
 * `h-full` so a card in a grid row matches its tallest sibling rather than
 * leaving a ragged bottom edge.
 */
export function LinkCard({
  href,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Link>) {
  return (
    <Link
      href={href}
      className={cx(
        "flex h-full flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-5",
        "shadow-[var(--shadow-raised)]",
        // §8.5.6 — state changes cross-fade and nothing travels far. 2px.
        "transition-[box-shadow,transform] duration-[var(--dur-base)] ease-[var(--ease-out)]",
        "hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)]",
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}

/**
 * §8.5.6 — "list items stagger 24ms on first render only." Pair with the
 * `rise` class; the delay is a custom property so the animation itself stays
 * in CSS and the route ships no motion JS (§8.5.8).
 *
 * Capped, because 24ms × 26 skills is a 600ms wait for the last row — a
 * stagger that outlives the reader's patience stops being polish.
 */
export function stagger(index: number): React.CSSProperties {
  return {
    "--rise-delay": `${Math.min(index, 8) * 24}ms`,
  } as React.CSSProperties;
}

/**
 * `stagger`'s counterpart for the `reveal` and `settle` classes, which are
 * driven by the scroll rather than by a clock.
 *
 * A scroll-driven animation has no delay to stagger — `animation-delay` is
 * measured in time, and there is no time in a view timeline. What it has
 * instead is a *range*, so an item that should arrive after its neighbour
 * starts its range further into the band's entrance. Six percent per step is
 * about 40ms at an ordinary scroll speed, which reads as a sequence rather than
 * as five things arriving late.
 *
 * Capped at 8 for the same reason `stagger` is: the ninth item in a row would
 * not begin until the band was half past.
 */
export function revealAt(index: number): React.CSSProperties {
  return {
    "--reveal-start": `${Math.min(index, 8) * 6}%`,
  } as React.CSSProperties;
}

/**
 * §8.5.5 — "Row list", not a data table. Rows are separated by space and a
 * subtle background shift; hairlines only where space genuinely fails.
 */
export function RowList({
  className,
  ...props
}: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      className={cx(
        "bg-surface rounded-[var(--radius-card)] overflow-hidden list-none m-0 p-0",
        className,
      )}
      {...props}
    />
  );
}

export function Row({
  className,
  children,
  ...props
}: React.LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li
      className={cx(
        "flex items-center justify-between gap-4 px-5 py-4",
        "min-h-[var(--touch-min)]",
        "border-b border-hairline last:border-b-0",
        className,
      )}
      {...props}
    >
      {children}
    </li>
  );
}

/* ── Actions ────────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "text" | "social";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** §8.5.5 — one filled button per screen. Everything else is a text button. */
  variant?: ButtonVariant;
};

/**
 * The shared look, so `Button` and `ButtonLink` cannot drift apart.
 *
 * `text-on-accent` rather than `text-white`: the filled button is the one
 * place the accent is a *fill*, and white on dark's `#35C79A` measures 2.17:1.
 * See the token's note in `theme.ts`.
 */
function buttonClass(variant: ButtonVariant, className?: string): string {
  const base = cx(
    "inline-flex items-center justify-center gap-2",
    "min-h-[var(--touch-min)] px-5",
    "text-[length:var(--text-label-size)] font-[550]",
    "rounded-[var(--radius-control)]",
    "transition-[background-color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
    "disabled:opacity-50 disabled:pointer-events-none",
    // Full-width on mobile, intrinsic on desktop (§8.5.5).
    "w-full sm:w-auto",
  );

  const variants = {
    primary: "bg-accent text-on-accent hover:opacity-90",
    // §8.5.5 — text button in the accent: no border, no fill, no outlined variant.
    text: "bg-transparent text-accent hover:bg-accent-weak w-auto px-3",
    /**
     * The one sanctioned outlined button, and only for handing off to an
     * identity provider.
     *
     * §8.5.5 bans an outlined variant because a second filled-looking button
     * competes with the single primary action. A federated sign-in button is
     * the exception the rule did not anticipate: it must read as a *button*
     * rather than a link — people look for a recognisable target on this screen
     * and skim past text — while staying visibly subordinate to "Sign in". A
     * hairline border on the page ground does both, and carries no accent, so
     * the accent stays unique to the primary action.
     *
     * `text-ink`, not the accent: the label sits beside a fixed four-colour
     * brand mark, and a teal "Continue with Google" next to Google's red-yellow
     * -green-blue G is the sort of thing their brand terms exist to prevent.
     */
    social: cx(
      "border border-hairline bg-transparent text-ink",
      "hover:bg-surface",
    ),
  } as const;

  return cx(base, variants[variant], className);
}

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonProps) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

/**
 * A navigation that looks like the primary action.
 *
 * Every screen that needed one had written `<Link><Button/></Link>`, which
 * nests a button inside an anchor and then lets `Button`'s `w-full` stretch
 * inside an inline parent — so the mobile full-width rule silently stopped
 * working — or hand-rolled the whole class list, which is how two of them
 * ended up carrying the dead `text-on-accent` before the token existed.
 */
export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

/* ── Form fields ────────────────────────────────────────────────────────── */

/**
 * The text input, in one place.
 *
 * This string used to be copy-pasted into four screens, and had already drifted
 * into three different versions of itself: `/sign-in` shipped with no focus
 * style at all, while `/sign-up` and `/forgot-password` had `focus:border-accent`
 * and `/reset-password` had its own local `const input`. A keyboard user could
 * tab into the sign-in form and lose the caret entirely.
 *
 * The ring is `--accent-weak` rather than a translucent accent: it is a real
 * token with a measured value in both themes (`#E6F4F0` / `#12302A`), so the
 * focus state does not need a second definition for dark, and it cannot wash
 * out over whatever the input happens to be sitting on.
 */
const FIELD_INPUT = cx(
  "min-h-[var(--touch-min)] w-full px-4",
  "rounded-[var(--radius-control)] border border-hairline bg-ground text-ink",
  "placeholder:text-ink-faint",
  // `outline-none` only ever paired with a focus style that replaces it.
  "outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-weak)]",
  "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
);

type FieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "id" | "name"
> & {
  label: string;
  /** Also the `id`, so the label's `htmlFor` cannot drift from the input. */
  name: string;
  /** Standing help — the password rule, say. Announced with the input. */
  hint?: string;
  /** A failure for *this* field. Announced immediately, and reddens the border. */
  error?: string;
  /** One control on the label row, right-aligned. "Forgot your password?". */
  action?: React.ReactNode;
};

/**
 * A labelled input, wired up.
 *
 * The id is derived from `name` rather than from `React.useId()`, and that is
 * the load-bearing decision: `useId` is a hook, and half the screens using this
 * — `/sign-up`, `/reset-password`, `/forgot-password` — are async Server
 * Components that cannot call one. Deriving it keeps a single `Field` usable on
 * both sides of the boundary. Field names are already unique within a form,
 * which is the only scope an id has to be unique in here.
 */
export function Field({
  label,
  name,
  hint,
  error,
  action,
  className,
  ...props
}: FieldProps) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = error ? `${name}-error` : undefined;
  const describedBy = cx(hintId, errorId) || undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={name}
          className="text-[length:var(--text-label-size)] font-[550]"
        >
          {label}
        </label>
        {action}
      </div>

      <input
        id={name}
        name={name}
        aria-describedby={describedBy}
        // Only when there is one: `aria-invalid="false"` on every untouched
        // field is noise in the a11y tree.
        aria-invalid={error ? true : undefined}
        className={cx(FIELD_INPUT, error && "border-problem", className)}
        {...props}
      />

      {hint ? (
        <Meta id={hintId} className="leading-snug">
          {hint}
        </Meta>
      ) : null}

      {error ? (
        <span
          id={errorId}
          role="alert"
          className="text-[length:var(--text-label-size)] text-problem"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

type SelectFieldProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "id" | "name"
> & {
  label: string;
  /** Also the `id`, for the same reason as `Field`. */
  name: string;
  hint?: string;
};

/**
 * `Field`, for a choice out of a fixed list.
 *
 * Native `<select>`, not a listbox built out of divs. That is not
 * minimalism — it is the only version that works here: these screens ship no
 * client JavaScript, so a scripted dropdown would be a control that renders and
 * then does nothing. What the platform gives back in exchange is the whole
 * behaviour set a custom one has to re-earn: keyboard type-ahead, a native
 * wheel picker on iOS, and a popup that is allowed to escape the card's
 * bounds — which a 400-row timezone list very much needs.
 *
 * `appearance-none` drops the OS arrow so the control matches `Field`'s border
 * and focus ring, and the chevron is drawn back in beside it. The SVG is inline
 * rather than `ChevronIcon` because `icons.tsx` imports `cx` from this file,
 * and importing it back would close the cycle.
 */
export function SelectField({
  label,
  name,
  hint,
  className,
  children,
  ...props
}: SelectFieldProps) {
  const hintId = hint ? `${name}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={name}
        className="text-[length:var(--text-label-size)] font-[550]"
      >
        {label}
      </label>

      <div className="relative">
        <select
          id={name}
          name={name}
          aria-describedby={hintId}
          className={cx(FIELD_INPUT, "appearance-none pr-11", className)}
          {...props}
        >
          {children}
        </select>

        {/* Decorative: the control is already announced as a combobox. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>

      {hint ? (
        <Meta id={hintId} className="leading-snug">
          {hint}
        </Meta>
      ) : null}
    </div>
  );
}

/**
 * A rule across a stack, optionally with a word sitting in it.
 *
 * The word matters on the auth screens: a bare rule between the Google button
 * and the password fields reads as "here is some more form", where "or" says
 * these are two ways to do the same thing and you only need one.
 */
export function Divider({ label }: { label?: string }) {
  if (!label) return <hr className="border-0 border-t border-hairline" />;

  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <hr className="h-0 flex-1 border-0 border-t border-hairline" />
      <span className="text-[length:var(--text-meta-size)] text-ink-faint">
        {label}
      </span>
      <hr className="h-0 flex-1 border-0 border-t border-hairline" />
    </div>
  );
}

/**
 * §8.5.5 — "Switching between 2–4 views: text labels in a pill track." Not
 * tabs, and not a dropdown.
 *
 * Links rather than buttons, because every view this switches between is a
 * real URL that survives a refresh and a shared link — which is also what
 * keeps the control working with no client JavaScript.
 */
export function ToggleGroup({
  label,
  options,
}: {
  /** Names the group for assistive technology; never drawn. */
  label: string;
  options: ReadonlyArray<{ href: string; label: string; current: boolean }>;
}) {
  return (
    <nav aria-label={label}>
      <ul className="m-0 inline-flex list-none gap-1 rounded-[var(--radius-pill)] bg-surface p-1 shadow-[var(--shadow-raised)]">
        {options.map((option) => (
          <li key={option.href}>
            <Link
              href={option.href}
              aria-current={option.current ? "page" : undefined}
              className={cx(
                "inline-flex min-h-9 items-center rounded-[var(--radius-pill)] px-4",
                "text-[length:var(--text-label-size)] font-[550]",
                "transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                option.current
                  ? "bg-accent text-on-accent"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {option.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ── Status and confidence ──────────────────────────────────────────────── */

export type StatusTone = "verified" | "attention" | "problem" | "neutral";

/**
 * §8.5.5 — "a dot plus a word". Not a badge, not a count pill. And per §8.5.5's
 * ban on colour as the sole carrier of meaning, the word is always present.
 */
export function Status({
  tone = "neutral",
  live = false,
  children,
}: {
  tone?: StatusTone;
  /**
   * The dot breathes, for a state that is changing *while you are looking at
   * it* — a course being written, work being marked.
   *
   * Deliberately not "this one is important". A dot that pulses on a screen
   * where nothing is actually moving is a dot people stop seeing, and then the
   * one that means something moves past unnoticed too. The wait screen already
   * applies this rule to its step marker: the only moving thing is the only
   * thing that is happening.
   */
  live?: boolean;
  children: React.ReactNode;
}) {
  const colour = {
    verified: "bg-accent",
    attention: "bg-attention",
    problem: "bg-problem",
    neutral: "bg-ink-faint",
  }[tone];

  return (
    <span className="inline-flex items-center gap-2 text-[length:var(--text-label-size)] text-ink">
      <span
        aria-hidden="true"
        className={cx(
          "inline-block size-2 rounded-full",
          colour,
          // Clamped to one cycle under reduced motion by the global rule in
          // tokens.css, which is the right failure: it stops moving, and the
          // word beside it still says everything the movement was saying.
          live && "animate-pulse",
        )}
      />
      {children}
    </span>
  );
}

/** The edge rule. `neutral` is absent on purpose — see `Signal`. */
const SIGNAL_RULE: Record<Exclude<StatusTone, "neutral">, string> = {
  verified: "bg-accent",
  attention: "bg-attention",
  problem: "bg-problem",
};

/**
 * One thing that is waiting on the learner, or happening for them right now.
 *
 * A deliberate addition to §8.5.5's vocabulary, and the card-level counterpart
 * of `Status`: that component says a *row* has a state, and there was nothing
 * that said a whole card does. The gap showed. A learner who walked away
 * mid-conversation, or who has a subject being authored for them at this
 * moment, was told so in a plain `Card` with a `Title` and a button — the same
 * shape, the same weight and the same white as the invitation shown to somebody
 * who has never started anything. Two very different sentences, drawn
 * identically, and the one that mattered was routinely scrolled past.
 *
 * **What makes it louder is a 6px rule down its leading edge, and nothing
 * else.** That is the whole of the mechanism, and the restraint is the reason
 * it works: it is the only element on a product screen that carries a colour on
 * its edge, so a marked card is unmistakably not one of the cards around it.
 *
 * The ban it must not reopen is badge soup, so it takes `Figure`'s governing
 * rule and for the same reason: **one per scroll band, never a stack of them.**
 * It goes to something *unfinished* — waiting on the learner, running for them,
 * or stopped — never to something merely interesting. Four marked edges on one
 * screen is four things shouting, which is silence.
 *
 * `state` is mandatory, and that is the ban on colour-as-meaning (§8.5.5) made
 * structural: the rule cannot be drawn without a word saying what it means.
 * `neutral` is not an available tone for the same reason a neutral signal is
 * not a signal — a grey rule says "look here" about nothing.
 *
 * The tones are the three things that can be true of unfinished work:
 * `verified` — it is ready, or it is being made for you; `attention` — it is
 * waiting on you, or it is at risk; `problem` — it stopped.
 */
export function Signal({
  tone = "attention",
  state,
  title,
  live = false,
  action,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  tone?: Exclude<StatusTone, "neutral">;
  /** The dot's word. Two or three words — "Left unfinished", never a sentence. */
  state: string;
  /** What is waiting, in one line. The loudest thing in the card. */
  title: string;
  /** Passed to `Status`: only for something changing as they watch. */
  live?: boolean;
  /** The one way to act on it. Filled where the screen has no other primary. */
  action?: React.ReactNode;
}) {
  return (
    <Card
      className={cx(
        // `pl-8` rather than `Card`'s own `p-6`: the rule takes 6px of the
        // padding and text set 18px off a coloured edge reads as crowded.
        "relative flex flex-col items-start gap-4 overflow-hidden pl-8",
        className,
      )}
      {...props}
    >
      {/* Decorative — `state` below is what carries the meaning. `inset-y-0`
          rather than a border so the rule keeps the card's own corner radius
          instead of squaring off its left edge. */}
      <span
        aria-hidden="true"
        className={cx(
          "absolute inset-y-0 left-0 w-1.5",
          SIGNAL_RULE[tone],
        )}
      />

      <Status tone={tone} live={live}>
        {state}
      </Status>

      <Title>{title}</Title>

      {children}

      {action}
    </Card>
  );
}

export type ConfidenceLevel = "low" | "medium" | "high";

/**
 * §8.5.5 — "a three-segment meter plus a word. Never a number."
 *
 * §4.2 law 3 is why this component exists at all: every verdict carries a
 * confidence band, and a percentage would imply a precision the evaluation
 * does not have.
 */
export function Confidence({ level }: { level: ConfidenceLevel }) {
  const filled = { low: 1, medium: 2, high: 3 }[level];
  const label = {
    low: "Some signal",
    medium: "Likely capable",
    high: "Demonstrated",
  }[level];

  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex gap-1" role="img" aria-label={label}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cx(
              "inline-block h-1.5 w-5 rounded-[var(--radius-pill)]",
              i < filled ? "bg-accent" : "bg-hairline",
            )}
          />
        ))}
      </span>
      <span className="text-[length:var(--text-label-size)] text-ink-muted">
        {label}
      </span>
    </span>
  );
}

/**
 * §7.2's confidence bands, mapped to the meter above.
 *
 * One mapping for the whole product: the evaluation screen and the mastery
 * ledger both turn a stored confidence into a claim, and two cut-offs for
 * "Demonstrated" would eventually disagree in front of the same learner.
 */
export function confidenceLevel(value: number): ConfidenceLevel {
  if (value >= 0.8) return "high";
  return value >= 0.5 ? "medium" : "low";
}

/**
 * §7.1 — the maturity badge shown to the learner. Honest scope is a feature, so
 * a Generated pack says "Experimental" rather than hiding behind silence.
 *
 * `review` is optional because omitting it can only ever show a *weaker* claim
 * — `maturityClaim` falls back to the depth alone — and a badge that understates
 * when an argument is forgotten is the only acceptable direction for this one to
 * fail in.
 */
export function MaturityBadge({
  maturity,
  review = null,
}: {
  maturity: Maturity;
  review?: ReviewKind | null;
}) {
  const copy = maturityClaim(maturity, review);
  return <Status tone={copy.tone}>{copy.label}</Status>;
}

/* ── Feedback ───────────────────────────────────────────────────────────── */

/** §8.5.5 — skeleton matching the final layout exactly. Never a spinner. */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        "bg-hairline rounded-[var(--radius-control)] animate-pulse",
        className,
      )}
      {...props}
    />
  );
}

/** §8.5.5 — one sentence and one button. No illustration, no paragraph. */
export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-4 py-12">
      <Lead>{message}</Lead>
      {action}
    </div>
  );
}

/**
 * §8.5.4 — learner artefacts always render at true colour, on a fixed neutral
 * mat identical in both themes. A dark-mode filter over a photograph being
 * graded would make the verdict wrong.
 */
export function ArtifactMat({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "artifact-mat rounded-[var(--radius-card)] p-6 flex items-center justify-center",
        className,
      )}
      {...props}
    />
  );
}
