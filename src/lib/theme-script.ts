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

/**
 * The click handler behind `ThemeToggleStatic`, the framework-free toggle in the
 * marketing footer.
 *
 * ## Why it is here and not beside the buttons
 *
 * It was a `<script>` inside the component, which is wrong twice over. On a cold
 * load Next streams the page, and body content arriving in a later chunk is
 * *inserted* into the document rather than parsed into it — an inserted
 * `<script>` never runs. On a client-side navigation React renders the element
 * and skips it outright, which is what the console reports: "Scripts inside
 * React components are never executed when rendering on the client." Either way
 * the toggle was dead. `goalSearchScript` was moved to `<head>` for the first
 * half of this; this is the same move, and the warning is the second half.
 *
 * In `<head>` it is parsed and run before the body exists, which is safe because
 * it only delegates from `document` and touches nothing until the visitor
 * clicks. Delegation is also what makes it survive hydration: a listener bound
 * to a node found at parse time is lost when React hydrates over that node.
 *
 * It duplicates `applyThemeChoice` rather than importing it, because a module
 * import here is a bundle — that import is the 80KB budget in §13.3. The two
 * are kept in step by tests that assert the same outcomes for both.
 */
export const themeToggleScript = `(function(){var d=document;
if(d.themeToggleBound)return;d.themeToggleBound=1;
d.addEventListener("click",function(e){
var t=e.target;if(!t||!t.closest)return;
var b=t.closest("[data-theme-choice]");if(!b)return;
var r=d.documentElement,v=b.getAttribute("data-theme-choice");
r.classList.add("theme-transitioning");
if(v==="system"){delete r.dataset.theme}else{r.dataset.theme=v}
try{v==="system"?localStorage.removeItem("${THEME_STORAGE_KEY}"):localStorage.setItem("${THEME_STORAGE_KEY}",v)}catch(x){}
d.cookie="${THEME_COOKIE}="+v+"; path=/; max-age=31536000; samesite=lax";
d.querySelectorAll("[data-theme-choice]").forEach(function(o){o.setAttribute("aria-pressed",String(o===b))});
requestAnimationFrame(function(){r.classList.remove("theme-transitioning")})
})})();`;

/**
 * Normalises a raw value — from localStorage, from the cookie — to a choice.
 *
 * Anything that is not an explicit theme is "system", including the string
 * "system" itself, a value from an older release, and a hand-edited cookie.
 */
export function toThemeChoice(value: string | null | undefined): ThemeChoice {
  return value === "dark" || value === "light" ? value : "system";
}

/**
 * The choice on a Better Auth user object, for the code that sends mail.
 *
 * `unknown` for the same reason `localeOf` takes it: `theme` is an
 * `additionalFields` column, present at runtime on every user handed to an
 * email callback and absent from the type those callbacks declare. Reading it
 * defensively degrades to "system" — a message that asks the reader's client —
 * rather than throwing inside a password reset.
 */
export function themeOf(subject: unknown): ThemeChoice {
  if (typeof subject !== "object" || subject === null) return "system";
  const value = (subject as { theme?: unknown }).theme;
  return toThemeChoice(typeof value === "string" ? value : undefined);
}

/** Reads the stored choice. Returns "system" when nothing has been chosen. */
export function readThemeChoice(
  storage: Pick<Storage, "getItem"> | undefined,
): ThemeChoice {
  if (!storage) return "system";
  try {
    return toThemeChoice(storage.getItem(THEME_STORAGE_KEY));
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
