// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyThemeChoice,
  readThemeChoice,
  THEME_COOKIE,
  THEME_STORAGE_KEY,
  themeInitScript,
} from "@/lib/theme-script";

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.documentElement.className = "";
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
