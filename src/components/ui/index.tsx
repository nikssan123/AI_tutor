import * as React from "react";

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
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cx(
        "text-[length:var(--text-meta-size)] leading-[var(--text-meta-line)]",
        "tracking-[var(--text-meta-tracking)] text-ink-faint",
        className,
      )}
      {...props}
    />
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

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** §8.5.5 — one filled button per screen. Everything else is a text button. */
  variant?: "primary" | "text";
};

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonProps) {
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
    primary: "bg-accent text-white hover:opacity-90",
    // §8.5.5 — text button in the accent: no border, no fill, no outlined variant.
    text: "bg-transparent text-accent hover:bg-accent-weak w-auto px-3",
  } as const;

  return <button className={cx(base, variants[variant], className)} {...props} />;
}

/* ── Status and confidence ──────────────────────────────────────────────── */

export type StatusTone = "verified" | "attention" | "problem" | "neutral";

/**
 * §8.5.5 — "a dot plus a word". Not a badge, not a count pill. And per §8.5.5's
 * ban on colour as the sole carrier of meaning, the word is always present.
 */
export function Status({
  tone = "neutral",
  children,
}: {
  tone?: StatusTone;
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
        className={cx("inline-block size-2 rounded-full", colour)}
      />
      {children}
    </span>
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
 * §7.1 — the maturity badge shown to the learner. Honest scope is a feature, so
 * a Generated pack says "Experimental" rather than hiding behind silence.
 */
export function MaturityBadge({
  maturity,
}: {
  maturity: "curated" | "standard" | "generated";
}) {
  const copy = {
    curated: { tone: "verified" as const, label: "Written and checked by hand" },
    standard: { tone: "neutral" as const, label: "Solid coverage" },
    generated: {
      tone: "attention" as const,
      label: "Experimental — help us improve it",
    },
  }[maturity];

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
