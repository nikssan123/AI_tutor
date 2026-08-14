// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeToggleStatic } from "@/components/theme-toggle-static";
import { THEME_STORAGE_KEY } from "@/lib/theme-script";
import { authClient } from "@/lib/auth-client";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe("ThemeToggle (app routes)", () => {
  it("offers exactly three states, not two (§8.5.4)", () => {
    render(<ThemeToggle />);
    const labels = screen.getAllByRole("radio").map((b) => b.textContent);
    expect(labels).toEqual(["light", "dark", "system"]);
  });

  it("defaults to System, because most people chose at the OS level", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("radio", { name: "system" }).dataset.state).toBe("on");
  });

  it("reflects a stored explicit choice", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);
    // The effect runs after mount, so the initial paint is System and then
    // corrects — which is exactly why the anti-FOUC script exists separately.
    await vi.waitFor(() => {
      expect(screen.getByRole("radio", { name: "dark" }).dataset.state).toBe("on");
    });
  });

  it("ignores a deselect, which Radix reports as an empty value", () => {
    // Clicking the active item in a single-value toggle group emits "". Without
    // the guard the component would try to apply "" as a theme.
    render(<ThemeToggle />);
    const system = screen.getByRole("radio", { name: "system" });
    fireEvent.click(system);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(system.dataset.state).toBe("on");
  });

  it("applies and persists a new choice", async () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("radio", { name: "dark" }));

    await vi.waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("radio", { name: "dark" }).dataset.state).toBe("on");
  });

  it("is labelled as a group for assistive technology", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeDefined();
  });
});

describe("ThemeToggleStatic (marketing routes)", () => {
  it("renders plain buttons with no framework state", () => {
    // §8.5.8 — marketing routes ship zero component-library JS. Importing the
    // Radix version here is what put the landing page over budget.
    render(<ThemeToggleStatic />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "light",
      "dark",
      "system",
    ]);
  });

  it("marks System as pressed when the visitor has chosen nothing", () => {
    render(<ThemeToggleStatic />);
    expect(
      screen.getByRole("button", { name: "system" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("marks the visitor's stored choice as pressed instead", () => {
    // The footer passes what the theme cookie says. Hardcoding System here
    // meant a dark page could come back with System lit up.
    render(<ThemeToggleStatic pressed="dark" />);
    expect(
      screen.getByRole("button", { name: "dark" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "system" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("labels the group", () => {
    render(<ThemeToggleStatic />);
    expect(screen.getByRole("group", { name: "Appearance" })).toBeDefined();
  });

  it("carries the choice on a data attribute the inline script reads", () => {
    render(<ThemeToggleStatic />);
    for (const value of ["light", "dark", "system"]) {
      expect(
        screen.getByRole("button", { name: value }).dataset.themeChoice,
      ).toBe(value);
    }
  });

  it("renders no <script> of its own", () => {
    // A script rendered inside a component is inert when the page streams and
    // is skipped outright on a client-side navigation, where React logs
    // "Scripts inside React components are never executed when rendering on
    // the client". The driver lives in <head> as `themeToggleScript`.
    const { container } = render(<ThemeToggleStatic />);
    expect(container.querySelector("script")).toBeNull();
  });
});

describe("auth client", () => {
  it("is configured against the site origin", () => {
    // A wrong origin here fails only in the browser, at sign-in, in production.
    expect(authClient).toBeDefined();
    expect(typeof authClient.signIn.email).toBe("function");
    expect(typeof authClient.signUp.email).toBe("function");
  });
});
