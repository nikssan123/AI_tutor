// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  ArtifactMat,
  Button,
  Card,
  Confidence,
  confidenceLevel,
  cx,
  DisplayTitle,
  EmptyState,
  HeroTitle,
  Lead,
  LinkCard,
  MaturityBadge,
  Meta,
  Row,
  RowList,
  Skeleton,
  stagger,
  Status,
  Title,
} from "@/components/ui";

/**
 * §8.5.5 sets out both what the vocabulary contains and what it bans. These
 * tests cover the bans as much as the components, because the bans are the part
 * that erodes silently as a codebase grows.
 */

afterEach(cleanup);

describe("cx", () => {
  it("joins truthy class names and drops the rest", () => {
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
    expect(cx()).toBe("");
  });
});

describe("typography", () => {
  it("renders the display title as an h1", () => {
    render(<DisplayTitle>Prove it</DisplayTitle>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Prove it");
  });

  it("renders a section title as an h2", () => {
    render(<Title>Join grain</Title>);
    expect(screen.getByRole("heading", { level: 2 })).toBeDefined();
  });

  it("caps the lead at the reading measure", () => {
    const { container } = render(<Lead>Some copy</Lead>);
    expect(container.firstElementChild?.className).toContain(
      "max-w-[var(--measure)]",
    );
  });

  it("renders meta text", () => {
    render(<Meta>13 August 2026</Meta>);
    expect(screen.getByText("13 August 2026")).toBeDefined();
  });

  it("renders the marketing hero as an h1 at the fluid hero size", () => {
    render(<HeroTitle>Prove you learned it</HeroTitle>);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Prove you learned it");
    expect(h1.className).toContain("var(--text-hero-size)");
  });

  it("keeps the hero and the product display title on separate sizes", () => {
    // If these ever collapse into one class, the landing page has silently
    // gone back to a 40px headline.
    const { container: hero } = render(<HeroTitle>a</HeroTitle>);
    const { container: display } = render(<DisplayTitle>b</DisplayTitle>);
    expect(hero.firstElementChild!.className).not.toBe(
      display.firstElementChild!.className,
    );
  });

  it("steps meta text up to muted on request, swapping rather than stacking", () => {
    // Two competing text-ink-* utilities resolve by stylesheet order, so the
    // tone has to replace the class, not append to it.
    const { container: faint } = render(<Meta>x</Meta>);
    const { container: muted } = render(<Meta tone="muted">x</Meta>);

    expect(faint.firstElementChild!.className).toContain("text-ink-faint");
    expect(muted.firstElementChild!.className).toContain("text-ink-muted");
    expect(muted.firstElementChild!.className).not.toContain("text-ink-faint");
  });

  it("accepts extra classes without dropping its own", () => {
    const { container } = render(<Title className="mt-4">x</Title>);
    const cls = container.firstElementChild!.className;
    expect(cls).toContain("mt-4");
    expect(cls).toContain("text-ink");
  });
});

/**
 * §8.5.9 — the rule these two exist to enforce.
 *
 * Every index page had hand-rolled its own clickable card as `bg-surface p-5`
 * with no elevation, which in light is `#FFFFFF` on `#FAFAFA` — a 2% value
 * step, i.e. no visible card at all. The component is the fix; these tests are
 * what stop it being un-fixed one page at a time.
 */
describe("LinkCard", () => {
  it("always carries elevation, so a card is visible in light mode", () => {
    render(<LinkCard href="/learn">Subject</LinkCard>);
    expect(screen.getByRole("link").className).toContain("--shadow-raised");
  });

  it("lifts to the deeper shadow on hover rather than tinting", () => {
    // hover:bg-accent-weak was the old affordance and it fought the accent's
    // "verified" meaning — a card is not verified because you pointed at it.
    render(<LinkCard href="/learn">Subject</LinkCard>);
    const cls = screen.getByRole("link").className;
    expect(cls).toContain("hover:shadow-[var(--shadow-lifted)]");
    expect(cls).not.toContain("hover:bg-accent-weak");
  });

  it("fills its grid row, so a row of cards has a straight bottom edge", () => {
    render(<LinkCard href="/learn">Subject</LinkCard>);
    expect(screen.getByRole("link").className).toContain("h-full");
  });

  it("keeps its own classes when given more", () => {
    render(
      <LinkCard href="/learn" className="p-6">
        Subject
      </LinkCard>,
    );
    const cls = screen.getByRole("link").className;
    expect(cls).toContain("p-6");
    expect(cls).toContain("bg-surface");
  });
});

describe("stagger", () => {
  it("spaces items 24ms apart (§8.5.6)", () => {
    expect(stagger(0)).toEqual({ "--rise-delay": "0ms" });
    expect(stagger(3)).toEqual({ "--rise-delay": "72ms" });
  });

  it("caps the delay so a long list does not out-wait the reader", () => {
    // 24ms × 26 skills would leave the last row arriving 600ms late.
    expect(stagger(50)).toEqual(stagger(8));
  });
});

describe("Status — a dot plus a word (§8.5.5)", () => {
  it("always renders the word, never colour alone", () => {
    // §8.5.5 bans colour as the sole carrier of meaning.
    render(<Status tone="verified">Verified</Status>);
    expect(screen.getByText("Verified")).toBeDefined();
  });

  it("hides the dot from assistive technology", () => {
    const { container } = render(<Status tone="problem">Failed</Status>);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-problem");
  });

  it("defaults to the neutral tone", () => {
    const { container } = render(<Status>Not started</Status>);
    expect(container.querySelector('[aria-hidden="true"]')!.className).toContain(
      "bg-ink-faint",
    );
  });

  it.each([
    ["verified", "bg-accent"],
    ["attention", "bg-attention"],
    ["problem", "bg-problem"],
    ["neutral", "bg-ink-faint"],
  ] as const)("maps the %s tone to its token", (tone, expected) => {
    const { container } = render(<Status tone={tone}>x</Status>);
    expect(container.querySelector('[aria-hidden="true"]')!.className).toContain(
      expected,
    );
  });
});

describe("Confidence — a meter and a word, never a number (§8.5.5)", () => {
  it.each([
    ["low", 1, "Some signal"],
    ["medium", 2, "Likely capable"],
    ["high", 3, "Demonstrated"],
  ] as const)("renders %s as %i filled segments", (level, filled, label) => {
    const { container } = render(<Confidence level={level} />);
    expect(screen.getByText(label)).toBeDefined();
    expect(container.querySelectorAll(".bg-accent")).toHaveLength(filled);
    expect(container.querySelectorAll(".bg-hairline")).toHaveLength(3 - filled);
  });

  it("never renders a percentage", () => {
    // §4.2 law 3: a number would imply precision the verdict does not have.
    for (const level of ["low", "medium", "high"] as const) {
      const { container } = render(<Confidence level={level} />);
      expect(container.textContent).not.toMatch(/\d+\s*%/);
      expect(container.textContent).not.toMatch(/\d/);
    }
  });

  it("labels the meter for screen readers", () => {
    render(<Confidence level="high" />);
    expect(screen.getByRole("img", { name: "Demonstrated" })).toBeDefined();
  });

  it("maps §7.2's ranges onto what the UI may claim", () => {
    // One mapping for the whole product: the evaluation screen and the mastery
    // ledger both turn a stored confidence into a claim, and two cut-offs for
    // "Demonstrated" would disagree in front of the same learner.
    expect(confidenceLevel(0.9)).toBe("high");
    expect(confidenceLevel(0.8)).toBe("high");
    expect(confidenceLevel(0.65)).toBe("medium");
    expect(confidenceLevel(0.5)).toBe("medium");
    expect(confidenceLevel(0.2)).toBe("low");
  });
});

describe("MaturityBadge — §7.1's declared depth", () => {
  it.each([
    ["curated", "Written and checked by hand"],
    ["standard", "Covers the subject well"],
    ["generated", "Experimental — help us improve it"],
  ] as const)("labels a %s pack honestly", (maturity, label) => {
    render(<MaturityBadge maturity={maturity} />);
    expect(screen.getByText(label)).toBeDefined();
  });

  it("marks a generated pack with the attention tone, not a neutral one", () => {
    // Honest scope is a feature (§4.2 law 5) — an experimental pack should look
    // experimental.
    const { container } = render(<MaturityBadge maturity="generated" />);
    expect(container.querySelector('[aria-hidden="true"]')!.className).toContain(
      "bg-attention",
    );
  });
});

describe("Button", () => {
  it("is full-width on mobile and intrinsic on desktop (§8.5.5)", () => {
    render(<Button>Start</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("w-full");
    expect(cls).toContain("sm:w-auto");
  });

  it("meets the 44px touch minimum", () => {
    render(<Button>Start</Button>);
    expect(screen.getByRole("button").className).toContain(
      "min-h-[var(--touch-min)]",
    );
  });

  it("renders the secondary action as a text button with no border or fill", () => {
    // §8.5.5 explicitly bans an outlined variant.
    render(<Button variant="text">Not today</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("bg-transparent");
    expect(cls).toContain("text-accent");
    expect(cls).not.toContain("border");
  });

  it("supports the disabled state", () => {
    render(<Button disabled>Submitted</Button>);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("RowList — not a data table (§8.5.5)", () => {
  it("renders a list, not a table", () => {
    const { container } = render(
      <RowList>
        <Row>Join grain</Row>
      </RowList>,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(screen.getByRole("list")).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("gives each row the 44px touch minimum", () => {
    render(
      <RowList>
        <Row>x</Row>
      </RowList>,
    );
    expect(screen.getByRole("listitem").className).toContain(
      "min-h-[var(--touch-min)]",
    );
  });
});

describe("Skeleton — never a spinner (§8.5.5)", () => {
  it("is decorative and hidden from assistive technology", () => {
    const { container } = render(<Skeleton className="h-6 w-1/2" />);
    const el = container.firstElementChild!;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("animate-pulse");
  });
});

describe("EmptyState — one sentence and one button (§8.5.5)", () => {
  it("renders the message", () => {
    render(<EmptyState message="Nothing due today." />);
    expect(screen.getByText("Nothing due today.")).toBeDefined();
  });

  it("renders at most one action", () => {
    render(
      <EmptyState message="Nothing due." action={<Button>Change plan</Button>} />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("works with no action at all", () => {
    render(<EmptyState message="Nothing due." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Card", () => {
  it("uses the card radius and the single elevation token", () => {
    const { container } = render(<Card>content</Card>);
    const cls = container.firstElementChild!.className;
    expect(cls).toContain("rounded-[var(--radius-card)]");
    expect(cls).toContain("shadow-[var(--shadow-raised)]");
  });
});

describe("ArtifactMat — true colour in both themes (§8.5.4)", () => {
  it("carries the fixed-mat class rather than a theme token", () => {
    // A theme-dependent background here would tint work being graded, and the
    // grade depends on how it actually looks.
    const { container } = render(<ArtifactMat>image</ArtifactMat>);
    const cls = container.firstElementChild!.className;
    expect(cls).toContain("artifact-mat");
    expect(cls).not.toContain("bg-surface");
    expect(cls).not.toContain("bg-ground");
  });
});
