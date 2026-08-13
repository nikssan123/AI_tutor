// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  ArtifactMat,
  Button,
  Card,
  Confidence,
  cx,
  DisplayTitle,
  EmptyState,
  Lead,
  MaturityBadge,
  Meta,
  Row,
  RowList,
  Skeleton,
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

  it("accepts extra classes without dropping its own", () => {
    const { container } = render(<Title className="mt-4">x</Title>);
    const cls = container.firstElementChild!.className;
    expect(cls).toContain("mt-4");
    expect(cls).toContain("text-ink");
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
});

describe("MaturityBadge — §7.1's declared depth", () => {
  it.each([
    ["curated", "Written and checked by hand"],
    ["standard", "Solid coverage"],
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
