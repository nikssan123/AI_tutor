// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getThemeServerSnapshot,
  getThemeSnapshot,
  setThemeChoice,
  subscribeToTheme,
} from "@/lib/theme-store";
import { THEME_STORAGE_KEY } from "@/lib/theme-script";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe("theme store", () => {
  it("reports System when nothing has been chosen", () => {
    expect(getThemeSnapshot()).toBe("system");
  });

  it("reads an explicit choice from storage", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(getThemeSnapshot()).toBe("dark");
  });

  it("renders the default on the server, since it cannot know the choice", () => {
    // This is precisely why the anti-FOUC script exists (§8.5.4).
    expect(getThemeServerSnapshot()).toBe("system");
  });

  it("notifies subscribers on a same-tab write", () => {
    // localStorage.setItem does not fire `storage` in the tab that wrote it,
    // so the store notifies directly or the UI would not update.
    const listener = vi.fn();
    const unsubscribe = subscribeToTheme(listener);

    setThemeChoice("dark");

    expect(listener).toHaveBeenCalled();
    expect(getThemeSnapshot()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    unsubscribe();
  });

  it("follows a change made in another tab", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToTheme(listener);

    window.dispatchEvent(new StorageEvent("storage"));

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    subscribeToTheme(listener)();

    setThemeChoice("light");
    window.dispatchEvent(new StorageEvent("storage"));

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports several subscribers at once", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeToTheme(a);
    const unsubB = subscribeToTheme(b);

    setThemeChoice("system");

    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    unsubA();
    unsubB();
  });
});
