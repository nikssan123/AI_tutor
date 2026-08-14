import type { ThemeChoice } from "@/lib/theme-script";

/**
 * §8.5.8 — "Marketing routes ship zero component-library JS."
 *
 * The Radix-based `ThemeToggle` is a client component: importing it into a
 * marketing route drags React's client runtime and Radix into the first-load
 * bundle and blows the 80KB budget in §13.3. Measured, that one import was the
 * difference between 127KB and 43KB gzipped on the landing page.
 *
 * So the marketing footer gets this instead: a server component that renders
 * three plain buttons and nothing else. §8.5.8 says every marketing-side
 * pattern is achievable in pure CSS and must be — this is that rule applied.
 *
 * The behaviour lives in `themeToggleScript`, which the root layout puts in
 * `<head>`. It was inline here first, which looks right and is wrong: a
 * `<script>` rendered inside a component does not run when the page streams,
 * and React skips it entirely on a client-side navigation. See the comment on
 * that export. All this markup owes the script is `data-theme-choice`.
 *
 * `pressed` comes from the cookie `applyThemeChoice` mirrors the choice to —
 * which is the whole reason that mirror exists (§8.5.4). Hardcoding "system"
 * here meant a visitor who had chosen dark got a dark page with System lit up,
 * and the toggle was the one control on the site that lied about the state it
 * controls. Nothing re-renders this markup, so after that first paint the
 * script owns the attribute.
 */
export function ThemeToggleStatic({
  pressed = "system",
}: {
  pressed?: ThemeChoice;
}) {
  return (
    <div
      className="inline-flex gap-1 rounded-[var(--radius-pill)] bg-surface p-1"
      role="group"
      aria-label="Appearance"
    >
      {(["light", "dark", "system"] as const).map((value) => (
        <button
          key={value}
          type="button"
          data-theme-choice={value}
          aria-pressed={value === pressed}
          className={[
            "px-4 py-2 rounded-[var(--radius-pill)] capitalize cursor-pointer",
            "text-[length:var(--text-label-size)] font-[550]",
            "text-ink-muted bg-transparent border-0",
            "aria-pressed:bg-accent-weak aria-pressed:text-accent",
            "transition-colors duration-[var(--dur-fast)]",
          ].join(" ")}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
