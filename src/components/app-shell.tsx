import Link from "next/link";
import {
  cx,
  DisplayTitle,
  Lead,
  Skeleton,
  stagger,
  Title,
} from "@/components/ui";
import { Wordmark } from "@/components/logo";

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
 * **Which is why `wide` is the default, and a new screen should leave it
 * alone.** `narrow` is for a screen that is *one task* — a form you fill in,
 * a question you answer. It is not for a screen that happens to be short.
 * `/account` and `/account/billing` both shipped `narrow` and both had to be
 * fixed for the same fault: a handful of cards, each a title and one control,
 * stacked one per row in a 624px column, leaving ~350px of dead gutter either
 * side of a page three viewports tall. A page made of several cards goes
 * `wide` and pairs them into a grid; a page made of one form stays `narrow`.
 * If a `wide` page then looks empty, the answer is the card layout, not the
 * column width.
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
  /**
   * `full` is the operator console's, and only the screens holding a data grid
   * use it. A fourteen-column table boxed into `max-w-5xl` does not become
   * readable — it becomes a table where the three columns you identify a row by
   * are pushed off the visible area, which is exactly how `/admin/data/user`
   * shipped: `id`, `name` and `email` needed 949px of a 976px viewport that the
   * pinned actions column had already claimed 257px of.
   *
   * It does not reopen "pick a width per page". Prose is unaffected — `Lead`
   * carries its own `--measure` cap — so what widens is the grid and nothing
   * else, which is the one element on the page whose useful width is set by the
   * data rather than by a reading measure.
   */
  width?: "wide" | "narrow" | "full";
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
        { narrow: "max-w-2xl", wide: "max-w-5xl", full: "max-w-none" }[width],
        className,
      )}
    >
      {children}
    </main>
  );
}

/**
 * The signed-out screens: sign in, sign up, forgot password, reset password.
 *
 * They sit outside the nav — there is no session to navigate from — so they
 * centre on the viewport instead of hanging from the top of a column. Every
 * one of them had written this same line out by hand, which is how
 * `forgot-password` and `reset-password` ended up one `gap` apart.
 *
 * The wordmark is not decoration. These were the only screens in the product
 * with no route out of them: no nav, no logo, no link home. Someone who opened
 * `/sign-in` from a search result and decided they wanted to read about the
 * product first had the back button and nothing else — and someone who arrived
 * from an emailed reset link had not necessarily ever seen the brand at all.
 *
 * It is drawn only when there is no nav already drawing one, which is what
 * `brand` is for. `/sign-in` and `/sign-up` are `requireGuest` and can never
 * render inside the signed-in shell, so they take the default; but
 * `/forgot-password`, `/reset-password` and `/verify-email` are all reachable
 * *while signed in*, and there the rail is already showing the wordmark in the
 * corner — a second centred one is the same brand twice.
 *
 * A prop rather than a session read of its own, because this has to stay a
 * synchronous component: an async one cannot be nested inside a page under
 * test, where the tree is rendered into jsdom rather than streamed. The pages
 * are already async and `currentSession` is `cache`-memoised, so asking there
 * costs nothing the layout has not already paid.
 *
 * `footer` carries the one line that belongs *outside* the card — "no account?
 * create one" — because putting it inside makes it a fourth thing competing
 * with the form's own actions, and it is not part of the form.
 */
export function AuthFrame({
  children,
  footer,
  brand = true,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** `false` where the signed-in nav is already showing the wordmark. */
  brand?: boolean;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      {brand ? (
        <div className="rise flex justify-center">
          <Link
            href="/"
            className={cx(
              "inline-flex rounded-[var(--radius-control)] px-2 py-1",
              "outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-weak)]",
              "transition-opacity duration-[var(--dur-fast)] hover:opacity-80",
            )}
          >
            <Wordmark />
          </Link>
        </div>
      ) : null}

      {children}

      {footer ? (
        <div
          className="rise text-center text-[length:var(--text-label-size)] text-ink-muted"
          style={stagger(3)}
        >
          {footer}
        </div>
      ) : null}
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
 * The instant loading state for an authenticated screen — what `loading.tsx`
 * renders under `AppFrame` while the page itself is still being rendered.
 *
 * This exists for a navigation reason before a visual one. Everything under
 * `(app)` is dynamic, and Next skips prefetching a dynamic route *unless it has
 * a loading boundary* — "Dynamic Route: prefetching is skipped, or the route is
 * partially prefetched if `loading.tsx` is present"
 * (`next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`).
 * Without one, clicking a nav item did nothing at all until the server had
 * finished the whole page: the rail stayed lit on the screen you were leaving,
 * which reads as an app that did not hear the tap. With one, the click swaps to
 * this immediately and the page streams in behind it.
 *
 * §8.5.5's rule holds: a skeleton matching the final layout, never a spinner.
 * Which is why the title is *text* wherever the screen's heading is the same in
 * every branch — `/today` is always "Today" — and a bar only where it genuinely
 * varies with the data (`/progress` opens "Your week" or "The last seven days"
 * depending on whether a course is running, and a heading that changes under
 * you is worse than one that arrives late).
 *
 * No `rise`. The entry animation is for content arriving; running it on
 * something built to be replaced in ~150ms gives you two fades in a row, and
 * the first is a fade *onto* a placeholder.
 */
export function AppLoading({
  title,
  width = "wide",
  bands = 2,
}: {
  /** The screen's real heading, where it does not depend on the data. */
  title?: string;
  /** Matches the page's own `AppFrame`, so the swap does not shift the column. */
  width?: "wide" | "narrow" | "full";
  /** How many scroll bands the screen has below its header. */
  bands?: number;
}) {
  return (
    <AppFrame width={width}>
      {/* The header block `AppHeader` draws: heading, one lead line, and the
          ruled row of facts under it. */}
      <header className="flex flex-col gap-5">
        {title ? (
          <DisplayTitle>{title}</DisplayTitle>
        ) : (
          <Skeleton className="h-10 w-64 max-w-full" />
        )}
        <Skeleton className="h-5 w-full max-w-[var(--measure)]" />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-hairline pt-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
      </header>

      {Array.from({ length: bands }, (_, band) => (
        <Skeleton key={band} className="h-44" />
      ))}

      {/*
       * The skeletons are `aria-hidden`, so without this a screen reader is
       * handed a page with nothing on it and no reason why. `status` rather
       * than `alert`: it is polite, and it is the truth about the screen rather
       * than something that went wrong.
       */}
      <span role="status" className="sr-only">
        Loading
      </span>
    </AppFrame>
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
