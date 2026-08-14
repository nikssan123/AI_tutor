import {
  cx,
  DisplayTitle,
  Lead,
  Title,
} from "@/components/ui";

/**
 * §8.5.9, applied to the authenticated screens.
 *
 * The composition rules were written after the *marketing* pages shipped flat,
 * and they only ever reached the marketing pages. The product screens kept the
 * shape that section diagnoses: every page hand-rolling its own `<main>` — six
 * different combinations of `max-w-2xl` / `max-w-3xl` / `max-w-5xl` with
 * `py-12` or `py-16` — and every section heading demoted to
 * `Title className="text-[length:var(--text-label-size)]"`, which is 14px. A
 * page whose headings are the same size as its body text has no shape, and
 * "calm" read as "flat" here for exactly the reason it did there.
 *
 * These are the product-side counterparts of `PageFrame`, `PageIntro` and
 * `SectionHead` in `marketing.tsx`. Kept as separate components rather than
 * shared ones because the two surfaces differ in ways that matter: a marketing
 * page opens with breadcrumbs and numbered steps, a product page opens with
 * the thing you came to do.
 */

/**
 * One width and one vertical rhythm for every authenticated route.
 *
 * `narrow` is §8.5.9's documented exception, and it is a real one — a goal
 * form or a sign-in read across 1024px would be worse, not better. The rule it
 * replaces is not "pick a width per page"; it is "pick one of two, for a
 * stated reason".
 *
 * `pb-28` clears the mobile bottom bar, which is `fixed` and would otherwise
 * sit on top of the last thing on every page.
 */
export function AppFrame({
  width = "wide",
  flush = false,
  className,
  children,
}: {
  width?: "wide" | "narrow";
  /**
   * Drops the bottom padding, for the one screen that pins a control to the
   * bottom of the viewport itself (`/start`'s composer). Anything rendered
   * after a pinned bar extends the page past it, so the reserved space that
   * clears the mobile nav everywhere else becomes a strip of dead page
   * underneath — and the bar stops feeling pinned exactly when you scroll far
   * enough to reach it.
   *
   * A prop rather than a `className` override: two competing `pb-*` utilities
   * resolve by the order Tailwind emitted them, not the order they are written.
   */
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={cx(
        "mx-auto flex w-full flex-col gap-14 px-6 pt-10",
        flush ? "pb-0" : "pb-28",
        width === "narrow" ? "max-w-2xl" : "max-w-5xl",
        className,
      )}
    >
      {children}
    </main>
  );
}

/**
 * The signed-out screens: sign in, forgot password, reset password.
 *
 * They sit outside the nav — there is no session to navigate from — so they
 * centre on the viewport instead of hanging from the top of a column. Every
 * one of them had written this same line out by hand, which is how
 * `forgot-password` and `reset-password` ended up one `gap` apart.
 */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      {children}
    </main>
  );
}

/**
 * The top of a product screen: what this is, one sentence about it, and the
 * row of facts that would otherwise be scattered through the page as loose
 * `Meta` lines.
 *
 * `facts` is the part that was missing. Every screen had the same handful of
 * true, useful numbers — how many skills are left, how long the session is,
 * which pack this is — and rendered them as another paragraph. On a row under
 * a rule they read as instruments, which is the identity §8.5.3 asks for.
 */
export function AppHeader({
  eyebrow,
  icon,
  title,
  lead,
  facts,
  action,
}: {
  /** The small accent line above the title. Names the surface, not the page. */
  eyebrow?: string;
  /** Decorative; the title beside it already says the same thing. */
  icon?: React.ReactNode;
  title: string;
  lead?: string;
  /** Status dots, counts, durations — the row under the lead. */
  facts?: React.ReactNode;
  /** At most one, and only when the screen has an obvious next step. */
  action?: React.ReactNode;
}) {
  return (
    <header className="rise flex flex-col gap-6">
      <div className="flex flex-col gap-5">
        {eyebrow ? (
          <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
            {eyebrow}
          </span>
        ) : null}

        <div className="flex items-center gap-4">
          {icon ? (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-accent">
              {icon}
            </span>
          ) : null}
          <DisplayTitle>{title}</DisplayTitle>
        </div>

        {lead ? <Lead>{lead}</Lead> : null}
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

/**
 * What opens a scroll band on a product screen.
 *
 * The eyebrow is a plain label rather than marketing's numbered step: a
 * learner reading their own record is not being walked through five stages, so
 * a number would be counting something that does not exist. The title is
 * display-size for the reason §8.5.9 gives — a section that opens at the same
 * weight as the prose under it is not a section, it is a paragraph.
 */
export function SectionHead({
  label,
  title,
  action,
}: {
  label: string;
  title: string;
  /** A single text link, right-aligned — "See all", "What's left". */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t border-hairline pt-8">
      <div className="flex flex-col gap-3">
        <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
          {label}
        </span>
        <Title className="text-[length:var(--text-display-size)] leading-[var(--text-display-line)] tracking-[var(--text-display-tracking)]">
          {title}
        </Title>
      </div>
      {action}
    </div>
  );
}
