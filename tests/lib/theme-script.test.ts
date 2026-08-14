// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyThemeChoice,
  readThemeChoice,
  THEME_COOKIE,
  THEME_STORAGE_KEY,
  type ThemeChoice,
  themeInitScript,
  themeToggleScript,
  themeOf,
  toThemeChoice,
} from "@/lib/theme-script";

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.documentElement.className = "";
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the anti-FOUC script", () => {
  it("stays under the 400-byte budget §8.5.4 sets", () => {
    // It blocks first paint on every cold load, so its size is a real cost.
    expect(themeInitScript.length).toBeLessThan(400);
  });

  it("is a self-contained IIFE with no module syntax", () => {
    // §8.5.4 — inline, not a module, not deferred. `import` here would defer it
    // past first paint and reintroduce the flash it exists to prevent.
    expect(themeInitScript.startsWith("(function()")).toBe(true);
    expect(themeInitScript).not.toContain("import ");
    expect(themeInitScript).not.toContain("export ");
  });

  it("swallows storage errors, which throw in some private modes", () => {
    expect(themeInitScript).toContain("try{");
    expect(themeInitScript).toContain("catch(e){}");
  });

  it("applies a stored explicit choice before paint", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("leaves data-theme unset for System, so the media query decides", () => {
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("ignores a corrupted stored value", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "chartreuse");
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("the marketing toggle's script", () => {
  /** The three buttons `ThemeToggleStatic` renders, without React. */
  function mountButtons(): Record<ThemeChoice, HTMLButtonElement> {
    const choices: ThemeChoice[] = ["light", "dark", "system"];
    document.body.innerHTML = choices
      .map(
        (v) =>
          `<button data-theme-choice="${v}" aria-pressed="${v === "system"}">${v}</button>`,
      )
      .join("");
    const find = (v: ThemeChoice) =>
      document.querySelector<HTMLButtonElement>(`[data-theme-choice="${v}"]`)!;
    return { light: find("light"), dark: find("dark"), system: find("system") };
  }

  // Installed once, exactly as <head> installs it: the handler delegates from
  // `document`, so it outlives every fixture mounted under it.
  beforeAll(() => {
    new Function(themeToggleScript)();
  });

  it("stays small enough to inline on every route", () => {
    // It ships in <head> on app routes too, where it is inert. That is only
    // acceptable while it costs bytes and nothing else.
    expect(themeToggleScript.length).toBeLessThan(800);
  });

  it("is a self-contained IIFE with no module syntax", () => {
    // An `import` here is a bundle, and the bundle is the 80KB budget §13.3
    // sets — the whole reason this is a string and not a component.
    expect(themeToggleScript.startsWith("(function()")).toBe(true);
    expect(themeToggleScript).not.toContain("import ");
    expect(themeToggleScript).not.toContain("export ");
  });

  it("delegates from document rather than binding to the buttons", () => {
    // A listener bound to a node found at parse time is lost when React
    // hydrates over that node. `closest` at event time survives it.
    expect(themeToggleScript).toContain('d.addEventListener("click"');
    expect(themeToggleScript).toContain('closest("[data-theme-choice]")');
  });

  it("binds once, however many times the document evaluates it", () => {
    const spy = vi.spyOn(document, "addEventListener");
    new Function(themeToggleScript)();
    expect(spy).not.toHaveBeenCalled();
  });

  it("applies and persists an explicit choice", () => {
    const { dark } = mountButtons();
    dark.click();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
  });

  it("clears the choice for System, so the media query decides again", () => {
    const { dark, system } = mountButtons();
    dark.click();
    system.click();

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.cookie).toContain(`${THEME_COOKIE}=system`);
  });

  it("moves aria-pressed to the button that was clicked", () => {
    // Nothing re-renders this markup, so the script owns the pressed state.
    const { light, dark, system } = mountButtons();
    dark.click();

    expect(dark.getAttribute("aria-pressed")).toBe("true");
    expect(light.getAttribute("aria-pressed")).toBe("false");
    expect(system.getAttribute("aria-pressed")).toBe("false");
  });

  it("responds to a click on content inside the button", () => {
    // Real presses land on the label, not the button box.
    const { dark } = mountButtons();
    dark.innerHTML = "<span>dark</span>";
    dark.querySelector("span")!.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores clicks on anything else on the page", () => {
    mountButtons();
    document.body.insertAdjacentHTML("beforeend", "<a href='/'>Pricing</a>");
    document.querySelector("a")!.click();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("ignores an event whose target cannot be walked up from", () => {
    // `document` itself has no `closest`; a synthetic dispatch can target it.
    mountButtons();
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("still applies the theme when storage throws", () => {
    // Private modes throw on write. Losing the preference across visits is
    // acceptable; refusing to change the theme in front of someone is not.
    const { dark } = mountButtons();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    dark.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("suppresses transitions for exactly one frame", async () => {
    const { light } = mountButtons();
    light.click();
    expect(
      document.documentElement.classList.contains("theme-transitioning"),
    ).toBe(true);

    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(
      document.documentElement.classList.contains("theme-transitioning"),
    ).toBe(false);
  });
});

describe("toThemeChoice", () => {
  it("keeps the two explicit themes", () => {
    expect(toThemeChoice("dark")).toBe("dark");
    expect(toThemeChoice("light")).toBe("light");
  });

  it("treats anything else as System", () => {
    // A hand-edited cookie is the realistic case: it is not HttpOnly, because
    // the toggle's inline script has to write it.
    expect(toThemeChoice("system")).toBe("system");
    expect(toThemeChoice("chartreuse")).toBe("system");
    expect(toThemeChoice("")).toBe("system");
    expect(toThemeChoice(null)).toBe("system");
    expect(toThemeChoice(undefined)).toBe("system");
  });
});

describe("themeOf", () => {
  it("reads the column Better Auth does not put on its type", () => {
    expect(themeOf({ email: "a@b.co", theme: "dark" })).toBe("dark");
    expect(themeOf({ theme: "light" })).toBe("light");
  });

  it("degrades to System rather than throwing inside a send", () => {
    // Every caller is an email callback. A thrown error here would turn a
    // missing column into a failed password reset.
    expect(themeOf({ email: "a@b.co" })).toBe("system");
    expect(themeOf({ theme: 7 })).toBe("system");
    expect(themeOf(null)).toBe("system");
    expect(themeOf(undefined)).toBe("system");
    expect(themeOf("dark")).toBe("system");
  });
});

describe("readThemeChoice", () => {
  it("reads an explicit choice", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readThemeChoice(localStorage)).toBe("light");
  });

  it("defaults to system when nothing is stored", () => {
    expect(readThemeChoice(localStorage)).toBe("system");
  });

  it("defaults to system for an unrecognised value", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "neon");
    expect(readThemeChoice(localStorage)).toBe("system");
  });

  it("defaults to system when there is no storage at all", () => {
    expect(readThemeChoice(undefined)).toBe("system");
  });

  it("defaults to system when storage throws", () => {
    expect(
      readThemeChoice({
        getItem() {
          throw new Error("SecurityError");
        },
      }),
    ).toBe("system");
  });
});

describe("applyThemeChoice", () => {
  it("sets data-theme for an explicit choice and persists it", () => {
    applyThemeChoice("dark", document, localStorage);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
  });

  it("removes data-theme for System and clears storage", () => {
    applyThemeChoice("dark", document, localStorage);
    applyThemeChoice("system", document, localStorage);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.cookie).toContain(`${THEME_COOKIE}=system`);
  });

  it("suppresses transitions for exactly one frame", async () => {
    // §8.5.4 — the change applies instantly, without cross-fading every colour.
    applyThemeChoice("light", document, localStorage);
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(
      true,
    );

    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(
      false,
    );
  });

  it("still applies the theme when storage throws", () => {
    applyThemeChoice("dark", document, {
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem() {
        throw new Error("QuotaExceededError");
      },
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("works with no storage supplied", () => {
    applyThemeChoice("light", document);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("mirrors to a cookie so app routes can server-render the right theme", () => {
    // §8.5.4 — this is what lets dynamic routes skip the script's work entirely.
    applyThemeChoice("dark", document, localStorage);
    expect(document.cookie).toMatch(new RegExp(`${THEME_COOKIE}=dark`));
  });
});
