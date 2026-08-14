"use client";

import * as React from "react";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import {
  getThemeServerSnapshot,
  getThemeSnapshot,
  setThemeChoice,
  subscribeToTheme,
} from "@/lib/theme-store";
import type { ThemeChoice } from "@/lib/theme-script";
import { cx } from "@/components/ui";

/**
 * §8.5.4 — a three-way toggle group: Light / Dark / System.
 *
 * System is the default because most people already made this choice at the OS
 * level. It lives in Settings → Appearance and in the marketing footer, never
 * as a floating widget in primary chrome: theme switching is a once-a-year
 * action and should not occupy permanent space.
 */
export function ThemeToggle({
  /**
   * Told about the new choice after it has been applied — `/account` passes a
   * Server Action that writes it to the row the email renderer reads.
   *
   * A prop rather than an import, because this component is also rendered in
   * places with no session to write to, and because a component that reaches
   * for a Server Action itself cannot be rendered in a test without one.
   */
  onChoose,
}: {
  onChoose?: (choice: ThemeChoice) => void | Promise<void>;
} = {}) {
  const choice = React.useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );

  function onChange(next: string) {
    // Radix reports a deselect as an empty string; a theme is never unset.
    if (next !== "light" && next !== "dark" && next !== "system") return;
    setThemeChoice(next);

    // Not awaited, and its failure is swallowed on purpose. The theme is
    // already applied by the line above; a network hiccup here costs one
    // email rendered in the wrong palette, and is not worth an error the
    // person cannot act on next to a control that visibly worked.
    void Promise.resolve(onChoose?.(next)).catch(() => {});
  }

  return (
    <ToggleGroup.Root
      type="single"
      value={choice}
      onValueChange={onChange}
      aria-label="Appearance"
      className="inline-flex gap-1 rounded-[var(--radius-pill)] bg-surface p-1"
    >
      {(["light", "dark", "system"] as const).map((value) => (
        <ToggleGroup.Item
          key={value}
          value={value}
          className={cx(
            "px-4 py-2 rounded-[var(--radius-pill)] capitalize",
            "text-[length:var(--text-label-size)] font-[550]",
            "data-[state=on]:bg-accent-weak data-[state=on]:text-accent",
            "text-ink-muted transition-colors duration-[var(--dur-fast)]",
          )}
        >
          {value}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
