// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OgCardImage } from "@/lib/seo/og-card";
import { brandCard, subjectCard } from "@/lib/seo/og";
import { light } from "@/lib/theme";
import { findPack, topicSummary } from "@/lib/content";
import type { OgCard } from "@/lib/seo/og";

/**
 * Satori is not a browser, so this cannot assert what the PNG looks like — the
 * PNG is checked by rendering it and looking at it. What it can assert is that
 * the card's *words* reach the tree, and that the two things a card is most
 * likely to quietly drop are drawn: the badge's word (not just its dot), and
 * the honest tone behind it.
 */

afterEach(cleanup);

const summary = topicSummary(findPack("sql-data-analysis")!);

describe("OgCardImage", () => {
  it("draws every word of the card", () => {
    const card = subjectCard(summary);
    render(<OgCardImage card={card} />);

    expect(screen.getByText(card.title)).toBeTruthy();
    expect(screen.getByText(card.lead)).toBeTruthy();
    expect(screen.getByText(card.badge!.label)).toBeTruthy();
    for (const fact of card.facts) expect(screen.getByText(fact)).toBeTruthy();
  });

  it("separates the facts rather than running them together", () => {
    const { container } = render(<OgCardImage card={subjectCard(summary)} />);
    // Two separators for three facts — and none before the first, which is the
    // off-by-one that shows up as a card opening with a stray middot.
    expect(container.textContent!.match(/·/g)).toHaveLength(2);
  });

  it("renders a card with no facts and no badge without inventing either", () => {
    const { container } = render(<OgCardImage card={brandCard()} />);
    expect(container.textContent).not.toContain("·");
    expect(container.textContent).toContain("MeritKeep");
  });

  it("signs itself exactly once", () => {
    // Found by rendering it: the brand card opened with "MERITKEEP" as its
    // eyebrow and closed with the wordmark, which reads as a bug rather than as
    // branding. Nothing in the tree distinguished the two, so nothing caught it.
    const { container } = render(<OgCardImage card={brandCard()} />);
    expect(container.textContent!.match(/MeritKeep/gi)).toHaveLength(1);
  });

  it("keeps the eyebrow when it names something other than the product", () => {
    const { container } = render(<OgCardImage card={subjectCard(summary)} />);
    expect(screen.getByText("Subject")).toBeTruthy();
    expect(container.textContent!.match(/MeritKeep/gi)).toHaveLength(1);
  });

  it("gives the badge a word, not only a colour (§8.5.5)", () => {
    // The one place this rule bites hardest: an image can be read by someone
    // who cannot see the dot at all, and there is no alt text per element.
    const card: OgCard = {
      ...subjectCard(summary),
      badge: { tone: "attention", label: "Experimental — help us improve it" },
    };
    render(<OgCardImage card={card} />);
    expect(screen.getByText("Experimental — help us improve it")).toBeTruthy();
  });

  it("colours the dot from the token source, not from a literal", () => {
    const card: OgCard = {
      ...brandCard(),
      badge: { tone: "problem", label: "Something went wrong" },
    };
    const { container } = render(<OgCardImage card={card} />);
    const dot = [...container.querySelectorAll("div")].find(
      (el) => el.style.borderRadius === "999px",
    );
    expect(dot!.style.backgroundColor).toBe(hexToRgb(light.problem));
  });

  it("is always the light palette — a card has no viewer to ask", () => {
    const { container } = render(<OgCardImage card={brandCard()} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.backgroundColor).toBe(hexToRgb(light.ground));
  });
});

/** jsdom normalises inline colours to `rgb()`. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
