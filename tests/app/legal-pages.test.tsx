// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LEGAL_UPDATED } from "@/components/legal";
import { supportAddress } from "@/lib/site";

// The footer reads the theme cookie so its toggle can render already pressed,
// which is what makes it async. Nothing here has chosen a theme.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { SiteFooter } from "@/components/marketing";
import Privacy, { generateMetadata as privacyMeta } from "@/app/(marketing)/privacy/page";
import Terms, { generateMetadata as termsMeta } from "@/app/(marketing)/terms/page";

/**
 * The footer and the two legal pages.
 *
 * The assertions that matter are the ones about *not* claiming things. A
 * privacy page describing a data-export button that does not exist is the same
 * failure as a marketing page describing a feature that does not exist, except
 * that it is also a promise — so the tests pin the absence.
 */

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
});

afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.EMAIL_SUPPORT_FROM;
});

describe("the footer", () => {
  it("gives the guides hub the site-wide link it never had", async () => {
    render(await SiteFooter());
    // Before this, the only link to /guides anywhere was the breadcrumb on a
    // guide — so the index was reachable only from past it.
    expect(screen.getByRole("link", { name: "Guides" }).getAttribute("href")).toBe(
      "/guides",
    );
  });

  it("links both legal pages", async () => {
    render(await SiteFooter());
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe(
      "/terms",
    );
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe(
      "/privacy",
    );
  });

  it("carries the tool and the two hubs the header already has", async () => {
    render(await SiteFooter());
    for (const [name, href] of [
      ["Subjects", "/learn"],
      ["Graded projects", "/projects"],
      ["Roadmap tool", "/tools/learning-roadmap-generator"],
    ] as const) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
    }
  });

  /** §8.5.1 — the footer is chrome, not a directory. */
  it("stays a short list rather than becoming a sitemap", async () => {
    const { container } = render(await SiteFooter());
    // Six navigation links plus the support address. Change this number with a
    // reason, not to make a new link fit.
    expect(container.querySelectorAll("a")).toHaveLength(7);
  });

  /**
   * One band, nothing hanging off it. The wordmark and the support address used
   * to sit in a rule-separated strip below the link groups, which reads as a
   * footer with something appended *under* the footer — and the thing that kept
   * getting appended was whatever had no other home.
   */
  it("keeps the promise copy, the wordmark and one way to reach a person", async () => {
    const { container } = render(await SiteFooter());
    expect(screen.getByText(/Nothing counts as proof/)).toBeDefined();
    expect(screen.getByText("MeritKeep")).toBeDefined();
    expect(
      container.querySelector(`a[href="mailto:${supportAddress()}"]`),
    ).not.toBeNull();
  });

  it("draws one band, not two", async () => {
    // The footer's own top rule separates it from the page. A second rule
    // *inside* it is what made the last row read as a different section.
    const { container } = render(await SiteFooter());
    const inner = container.querySelectorAll("footer .border-t");
    expect(inner, "no rule inside the footer").toHaveLength(0);
  });

  /**
   * §8.5.4 asks for "a small control in the footer". It had been sitting on its
   * own rule beside the wordmark, *below* the link groups, which reads as chrome
   * appended under the footer rather than as one of the things the footer
   * offers. It is a labelled group beside Explore and Legal now.
   */
  it("puts the theme control inside the footer, not below it", async () => {
    const { container } = render(await SiteFooter());
    const nav = container.querySelector('nav[aria-label="Footer"]')!;
    const appearance = nav.querySelector('[aria-label="Appearance"]');
    expect(appearance, "the toggle belongs inside the footer nav").not.toBeNull();
    expect(nav.textContent).toContain("Appearance");
  });

  it("still offers all three choices without any framework JS", async () => {
    // §8.5.8 — the marketing surface ships no component-library JS, so this is
    // the static toggle rather than the Radix one `/account` uses.
    const { container } = render(await SiteFooter());
    expect(container.querySelectorAll("[data-theme-choice]")).toHaveLength(3);
  });
});

describe("the support address", () => {
  it("comes from the same place outgoing mail comes from", () => {
    process.env.EMAIL_SUPPORT_FROM = "Help <help@example.org>";
    expect(supportAddress()).toBe("help@example.org");
  });

  it("falls back to the default when nothing is configured", () => {
    expect(supportAddress()).toBe("support@meritkeep.com");
  });
});

describe("/privacy", () => {
  it("names every third party that actually receives something", () => {
    render(<Privacy />);
    for (const party of ["Anthropic", "Resend", "Google", "Inngest"]) {
      expect(screen.getByText(party)).toBeDefined();
    }
  });

  /**
   * `resolveSinks` builds three `NoopSink`s. Until one of them is a real SDK
   * this sentence is true, and it is the sort of sentence that silently stops
   * being true — hence the test.
   */
  it("says no analytics receives anything, because none does", () => {
    render(<Privacy />);
    expect(
      screen.getByText(/No third-party analytics currently receives anything/),
    ).toBeDefined();
  });

  /** §13's self-serve export and delete are not built. The page must not imply them. */
  it("promises a person, not a button, for export and deletion", () => {
    const { container } = render(<Privacy />);
    expect(container.textContent).toContain("There is no self-serve button");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lists the three cookies that exist and no more", () => {
    render(<Privacy />);
    expect(screen.getByText("Sign-in.")).toBeDefined();
    expect(screen.getByText("Theme.")).toBeDefined();
    expect(screen.getByText("Skill check progress.")).toBeDefined();
  });

  it("is indexable and canonical to itself", () => {
    const meta = privacyMeta();
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates!.canonical).toBe("https://example.com/privacy");
  });

  it("dates itself", () => {
    render(<Privacy />);
    expect(screen.getByText(new RegExp(LEGAL_UPDATED))).toBeDefined();
  });
});

describe("/terms", () => {
  /** §4.2 law 3, in the one document where overclaiming is most expensive. */
  it("refuses the words a certificate mill would use", () => {
    const { container } = render(<Terms />);
    expect(container.textContent).toContain(
      "It is not a qualification, a certification, or an accreditation",
    );
    expect(container.textContent).toContain("It can be wrong.");
  });

  it("says the work stays the learner's", () => {
    const { container } = render(<Terms />);
    expect(container.textContent).toContain("It stays yours.");
  });

  /** Billing is not built. Terms describing a subscription would be fiction. */
  it("says there is no money rather than describing a plan that does not exist", () => {
    const { container } = render(<Terms />);
    expect(container.textContent).toContain("There is none yet");
    expect(container.textContent).not.toMatch(/per month|subscription fee/i);
  });

  it("is indexable and canonical to itself", () => {
    const meta = termsMeta();
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates!.canonical).toBe("https://example.com/terms");
  });
});
