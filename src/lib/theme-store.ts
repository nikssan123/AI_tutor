import {
  applyThemeChoice,
  readThemeChoice,
  type ThemeChoice,
} from "./theme-script";

/**
 * A tiny external store for the theme choice.
 *
 * The theme genuinely lives outside React — in `localStorage`, in a cookie, and
 * on `document.documentElement` — so `useSyncExternalStore` is the right
 * primitive rather than mirroring it into component state inside an effect
 * (which triggers a cascading render and is what React's lint rule flags).
 *
 * A same-tab `localStorage.setItem` does not fire a `storage` event, so writes
 * go through `setThemeChoice` and notify subscribers directly.
 */

const listeners = new Set<() => void>();

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  // Other tabs still notify through `storage`, so a theme change follows the
  // learner across the windows they have open.
  globalThis.addEventListener?.("storage", listener);

  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", listener);
  };
}

export function getThemeSnapshot(): ThemeChoice {
  return readThemeChoice(globalThis.localStorage);
}

/**
 * The server has no idea what the visitor chose — that is precisely why the
 * anti-FOUC script exists — so it renders the default and the client corrects
 * on hydration without a flash.
 */
export function getThemeServerSnapshot(): ThemeChoice {
  return "system";
}

export function setThemeChoice(choice: ThemeChoice): void {
  applyThemeChoice(choice, document, globalThis.localStorage);
  for (const listener of listeners) listener();
}
