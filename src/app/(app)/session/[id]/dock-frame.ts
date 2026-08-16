/**
 * Where the tutor dock sits, and how wide a session is.
 *
 * **A plain module, and that is the entire point of it.** These four constants
 * lived in `tutor-dock.tsx`, which is `"use client"`, and `page.tsx` — a server
 * component — imported them from there. A non-component export from a client
 * module is not a value on the server; it is a client-reference proxy. `cx()`
 * stringifies it happily, so what reached the browser was:
 *
 *     class="mx-auto flex w-full flex-col gap-14 function() {
 *       throw new Error("Attempted to call SESSION_COLUMN() from the server
 *       but SESSION_COLUMN is on the client. …")
 *     }"
 *
 * The cap therefore never applied: the reading column ran at the frame's full
 * width while the dock — rendered on the client, where the constant is a real
 * string — ran at 52rem. The two were 144px apart, which is precisely what
 * sharing a constant was supposed to make impossible.
 *
 * It is the mirror of AGENTS.md's `"use server"` rule, and `actions:audit`
 * only checks that direction, so nothing in `pnpm verify` sees this one. Nor
 * did the suite: `session-page.test.tsx` mocks the client module with plain
 * strings, which is exactly the shape that hides it. **If you export anything
 * from a `"use client"` module that is not a component, check who imports it.**
 */

/**
 * The width of a session — the lesson, and the dock under it.
 *
 * `max-w-5xl` is `AppFrame`'s own wide column, so the dock is the foot of the
 * page rather than a bar of some other width near it. Named rather than
 * repeated: the dock is `fixed` and therefore cannot inherit the frame, so the
 * only thing keeping them equal is that both read this.
 */
export const SESSION_COLUMN = "max-w-5xl";

/**
 * `pointer-events-none` on the strip and back on for the panel itself: the
 * strip spans the viewport so the panel can centre on the same column the
 * lesson uses, and without this it would also swallow every click in the
 * margins either side of it.
 *
 * It clears the mobile bar rather than sitting under it. That bar is
 * `min-h-[var(--touch-min)]` plus `py-2`, so 60px, and it owns `z-30`; above
 * `lg` it is not rendered at all and the dock goes to the floor.
 */
export const DOCK_OUTER = [
  "pointer-events-none fixed left-0 right-0 z-20",
  // `lg:left-56` clears the desktop nav rail (`lg:w-56`, sticky rather than
  // fixed, so it is a flex sibling of the content and not something the
  // viewport knows about). Without it the dock centres on the *window* while
  // the lesson centres on the content area, and the two sit 112px apart.
  // Written as `left-0 … lg:left-56` rather than `inset-x-0 lg:left-56`,
  // because `inset-x` and `left` set the same property and would resolve by
  // emission order; a responsive variant of the same utility always wins.
  "lg:left-56",
  "bottom-[calc(60px+env(safe-area-inset-bottom))] lg:bottom-0",
].join(" ");

export const DOCK_INNER = `mx-auto w-full ${SESSION_COLUMN} px-6`;

/** The panel's own surface — shared with the loading state for the same reason. */
export const DOCK_PANEL = [
  "pointer-events-auto flex flex-col overflow-hidden",
  "rounded-t-[var(--radius-card)] border border-b-0 border-hairline",
  "bg-surface shadow-[var(--shadow-lifted)]",
].join(" ");
