/**
 * §8.5.4 — "No flash of the wrong theme."
 *
 * This runs blocking in <head>, before any stylesheet or paint. It is critical
 * here specifically because §13.1 statically generates every marketing page, so
 * the server has no idea what theme the visitor wants.
 *
 * Constraints, all from §8.5.4: inline (not a module, not deferred), under
 * ~400 bytes, and it mirrors the preference to a cookie as well as
 * localStorage so dynamic app routes can server-render the right theme and skip
 * this work entirely.
 */
export const THEME_STORAGE_KEY = "online-uni-theme";
export const THEME_COOKIE = "theme";

export type ThemeChoice = "light" | "dark" | "system";

/**
 * Minified by hand rather than by a build step, because it has to stay legible
 * as *source* — this is the one script whose failure mode is a visible flash on
 * every cold page load.
 */
export const themeInitScript = `(function(){try{var k="${THEME_STORAGE_KEY}",t=localStorage.getItem(k);if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t}}catch(e){}})();`;

/** Reads the stored choice. Returns "system" when nothing has been chosen. */
export function readThemeChoice(
  storage: Pick<Storage, "getItem"> | undefined,
): ThemeChoice {
  if (!storage) return "system";
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : "system";
  } catch {
    // Private browsing modes throw on storage access; "system" is the right
    // fallback because it is also the default.
    return "system";
  }
}

/**
 * Applies a choice: writes `data-theme` for an explicit choice, removes it for
 * "system", and mirrors to both localStorage and a cookie.
 */
export function applyThemeChoice(
  choice: ThemeChoice,
  doc: Document,
  storage?: Pick<Storage, "setItem" | "removeItem">,
): void {
  const root = doc.documentElement;

  // §8.5.4 — apply instantly, with no transition flash.
  root.classList.add("theme-transitioning");

  if (choice === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = choice;
  }

  try {
    if (choice === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage being unavailable must not stop the theme from applying.
  }

  doc.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`;

  // One frame, then transitions come back.
  requestAnimationFrame(() => {
    root.classList.remove("theme-transitioning");
  });
}
