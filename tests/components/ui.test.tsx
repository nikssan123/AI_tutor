// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  ArtifactMat,
  Button,
  ButtonLink,
  Card,
  Confidence,
  confidenceLevel,
  cx,
  Divider,
  DisplayTitle,
  EmptyState,
  Field,
  Figure,
  HeroTitle,
  Lead,
  LinkCard,
  MaturityBadge,
  Meta,
  revealAt,
  Row,
  RowList,
  SelectField,
  Signal,
  Skeleton,
  stagger,
  Status,
  Title,
  ToggleGroup,
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

/**
 * `stagger`'s counterpart for the scroll-driven classes (§8.5.6's marketing
 * amendment). A view timeline has no clock, so there is no delay to stagger —
 * what an item gets instead is a later *start* to its range, which is also the
 * only way a row of things side by side can build left-to-right on a timeline
 * that measures vertical travel.
 */
describe("revealAt", () => {
  it("offsets the range rather than delaying a clock", () => {
    expect(revealAt(0)).toEqual({ "--reveal-start": "0%" });
    expect(revealAt(3)).toEqual({ "--reveal-start": "18%" });
  });

  it("caps the offset so a long row still starts before the band is past", () => {
    // The ninth card in a grid would otherwise not begin until the section had
    // travelled half the viewport — which is the same failure the amendment is
    // about, arriving from the other direction.
    expect(revealAt(50)).toEqual(revealAt(8));
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

  it("holds still unless something is actually happening", () => {
    // A dot that pulses where nothing is moving is a dot people stop seeing,
    // and then the one that means something goes past unnoticed too.
    const { container } = render(<Status tone="verified">Ready</Status>);
    expect(container.querySelector('[aria-hidden="true"]')!.className).not.toContain(
      "animate-pulse",
    );
  });

  it("breathes the dot for a state that is changing as you look at it", () => {
    const { container } = render(
      <Status tone="verified" live>
        Being written
      </Status>,
    );
    expect(container.querySelector('[aria-hidden="true"]')!.className).toContain(
      "animate-pulse",
    );
  });
});

/**
 * §8.5.5 — a deliberate addition to the vocabulary, so it is held to the same
 * bans as everything already on the list. The two that bite here are colour as
 * the sole carrier of meaning, and badge soup.
 */
describe("Signal — Status at card scale", () => {
  it("cannot draw its rule without a word saying what the rule means", () => {
    const { container } = render(
      <Signal tone="attention" state="Left unfinished" title="You were partway through" />,
    );

    // The rule is decorative; `state` is the meaning, and it is a required
    // prop rather than an optional one for exactly this reason.
    expect(screen.getByText("Left unfinished")).toBeDefined();
    expect(screen.getByText("You were partway through")).toBeDefined();
    expect(
      container.querySelector('[aria-hidden="true"].bg-attention'),
    ).not.toBeNull();
  });

  it("defaults to the attention tone", () => {
    // The common case by a distance: something is waiting on the learner.
    const { container } = render(<Signal state="Waiting" title="Something" />);
    expect(
      container.querySelector('[aria-hidden="true"].bg-attention'),
    ).not.toBeNull();
  });

  it.each([
    ["verified", "bg-accent"],
    ["attention", "bg-attention"],
    ["problem", "bg-problem"],
  ] as const)("marks the %s tone with its own token", (tone, expected) => {
    const { container } = render(<Signal tone={tone} state="s" title="t" />);
    // Two elements carry the tone — the edge rule and the Status dot — and
    // both are decorative. Neither may be the only thing saying so.
    expect(container.querySelectorAll(`[aria-hidden="true"].${expected}`).length).toBe(2);
  });

  it("titles at title size, so it outranks the cards around it", () => {
    render(<Signal state="Being written" title="We’re writing your course" />);
    expect(
      screen.getByRole("heading", { level: 2 }).textContent,
    ).toBe("We’re writing your course");
  });

  it("carries its supporting copy and its one way to act", () => {
    render(
      <Signal
        state="Being written"
        title="We’re writing your course"
        action={<ButtonLink href="/start/building">See how it’s going</ButtonLink>}
      >
        <Lead>It takes a few minutes.</Lead>
      </Signal>,
    );

    expect(screen.getByText("It takes a few minutes.")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "See how it’s going" }).getAttribute("href"),
    ).toBe("/start/building");
  });

  it("passes `live` through to the dot", () => {
    const { container } = render(
      <Signal tone="verified" live state="Being written" title="Yours is being written" />,
    );
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
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

describe("MaturityBadge — §7.1's declared depth and who checked it", () => {
  it.each([
    ["curated", "human", "Written and checked by hand"],
    ["standard", "human", "Checked by hand"],
    ["curated", "model", "Checked against published curricula"],
    ["standard", "model", "Checked against published curricula"],
    ["standard", null, "Covers the subject well"],
    // The regression this pair exists for: keyed on maturity alone, an
    // unreviewed Curated pack printed "Written and checked by hand".
    ["curated", null, "Covers the subject well"],
    ["generated", null, "Experimental — help us improve it"],
  ] as const)("labels a %s pack reviewed by %s honestly", (maturity, review, label) => {
    render(<MaturityBadge maturity={maturity} review={review} />);
    expect(screen.getByText(label)).toBeDefined();
  });

  it("never says 'by hand' without a human reviewer", () => {
    for (const maturity of ["curated", "standard", "generated"] as const) {
      for (const review of ["model", null] as const) {
        const { container, unmount } = render(
          <MaturityBadge maturity={maturity} review={review} />,
        );
        expect(container.textContent, `${maturity}/${review}`).not.toMatch(
          /by hand/i,
        );
        unmount();
      }
    }
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

  /**
   * The outlined variant exists for exactly one job. These assertions are what
   * stop it from becoming the general-purpose secondary button §8.5.5 bans —
   * the moment it carries the accent, it competes with the primary action.
   */
  it("gives the federated sign-in button a border but never the accent", () => {
    render(<Button variant="social">Continue with Google</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("border");
    expect(cls).toContain("text-ink");
    expect(cls).not.toContain("bg-accent");
    expect(cls).not.toContain("text-accent");
  });

  it("keeps the social button on the same touch target as every other", () => {
    render(<Button variant="social">Continue with Google</Button>);
    expect(screen.getByRole("button").className).toContain(
      "min-h-[var(--touch-min)]",
    );
  });
});

/**
 * `Field` exists because this markup was copy-pasted into four screens and had
 * already drifted into three versions — one of which, `/sign-in`, shipped with
 * no focus style at all. These assertions are the drift detector.
 */
describe("Field — the one input", () => {
  it("ties the label to the input so clicking the label focuses it", () => {
    render(<Field label="Email" name="email" type="email" />);
    const input = screen.getByLabelText("Email") as HTMLInputElement;
    expect(input.id).toBe("email");
    expect(input.getAttribute("name")).toBe("email");
  });

  it("has a visible focus style, which /sign-in used to lack entirely", () => {
    render(<Field label="Email" name="email" />);
    const cls = screen.getByLabelText("Email").className;
    // `outline-none` on its own is the a11y bug; it is only acceptable paired
    // with something that replaces it.
    expect(cls).toContain("outline-none");
    expect(cls).toContain("focus:border-accent");
    expect(cls).toContain("focus:shadow-");
  });

  it("announces a hint with the input rather than as loose prose", () => {
    render(
      <Field label="Password" name="password" hint="At least 8 characters." />,
    );
    const input = screen.getByLabelText("Password");
    const describedBy = input.getAttribute("aria-describedby")!;
    expect(describedBy).toBe("password-hint");
    expect(document.getElementById(describedBy)!.textContent).toBe(
      "At least 8 characters.",
    );
  });

  it("marks a failed field invalid and speaks the reason", () => {
    render(<Field label="Email" name="email" error="That address is taken." />);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toContain("border-problem");
    expect(input.getAttribute("aria-describedby")).toBe("email-error");
    expect(screen.getByRole("alert").textContent).toBe("That address is taken.");
  });

  it("describes the input by both when it has a hint and an error", () => {
    render(
      <Field label="Password" name="password" hint="Eight." error="Too short." />,
    );
    expect(
      screen.getByLabelText("Password").getAttribute("aria-describedby"),
    ).toBe("password-hint password-error");
  });

  it("stays quiet in the a11y tree when it is neither hinted nor failing", () => {
    render(<Field label="Email" name="email" />);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-describedby")).toBe(null);
    // Not `aria-invalid="false"` on every untouched field.
    expect(input.getAttribute("aria-invalid")).toBe(null);
  });

  it("renders one control on the label row when given one", () => {
    render(
      <Field
        label="Password"
        name="password"
        action={<a href="/forgot-password">Forgot?</a>}
      />,
    );
    expect(screen.getByRole("link", { name: "Forgot?" })).toBeTruthy();
  });

  it("passes input attributes through and keeps its own classes", () => {
    render(
      <Field
        label="Password"
        name="password"
        type="password"
        required
        minLength={8}
        className="extra"
      />,
    );
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.required).toBe(true);
    expect(input.minLength).toBe(8);
    expect(input.className).toContain("extra");
    expect(input.className).toContain("bg-ground");
  });
});

describe("SelectField — the one choice out of a list", () => {
  const zones = (
    <>
      <optgroup label="Europe">
        <option value="Europe/Sofia">Sofia (GMT+03:00)</option>
        <option value="Europe/London">London (GMT+01:00)</option>
      </optgroup>
    </>
  );

  it("ties the label to the select so clicking the label focuses it", () => {
    render(
      <SelectField label="Timezone" name="timezone">
        {zones}
      </SelectField>,
    );
    const select = screen.getByLabelText("Timezone") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.id).toBe("timezone");
    expect(select.getAttribute("name")).toBe("timezone");
  });

  it("is a native select, so it works with no client JavaScript", () => {
    // A scripted dropdown on these screens would be a control that renders and
    // then does nothing. The platform's own gives back keyboard type-ahead and
    // a popup allowed to escape the card — which 400 timezones need.
    render(
      <SelectField label="Timezone" name="timezone" defaultValue="Europe/London">
        {zones}
      </SelectField>,
    );
    const select = screen.getByLabelText("Timezone") as HTMLSelectElement;
    expect(select.value).toBe("Europe/London");
    expect(select.querySelectorAll("optgroup")).toHaveLength(1);
    expect(select.querySelectorAll("option")).toHaveLength(2);
  });

  it("wears the same border and focus ring as the text input", () => {
    render(
      <SelectField label="Timezone" name="timezone">
        {zones}
      </SelectField>,
    );
    const cls = screen.getByLabelText("Timezone").className;
    expect(cls).toContain("outline-none");
    expect(cls).toContain("focus:border-accent");
    expect(cls).toContain("focus:shadow-");
    // The OS arrow is dropped so the control matches `Field`; the chevron is
    // drawn back in, and must not eat the click that opens the select.
    expect(cls).toContain("appearance-none");
  });

  it("draws its own chevron, out of the a11y tree and out of the way", () => {
    const { container } = render(
      <SelectField label="Timezone" name="timezone">
        {zones}
      </SelectField>,
    );
    const chevron = container.querySelector("svg")!;
    expect(chevron.getAttribute("aria-hidden")).toBe("true");
    expect(chevron.getAttribute("class")).toContain("pointer-events-none");
  });

  it("announces a hint with the select rather than as loose prose", () => {
    render(
      <SelectField
        label="Timezone"
        name="timezone"
        hint="Decides which day your work counts towards."
      >
        {zones}
      </SelectField>,
    );
    const describedBy = screen
      .getByLabelText("Timezone")
      .getAttribute("aria-describedby")!;
    expect(describedBy).toBe("timezone-hint");
    expect(document.getElementById(describedBy)!.textContent).toBe(
      "Decides which day your work counts towards.",
    );
  });

  it("stays quiet in the a11y tree when it has no hint", () => {
    render(
      <SelectField label="Timezone" name="timezone">
        {zones}
      </SelectField>,
    );
    expect(
      screen.getByLabelText("Timezone").getAttribute("aria-describedby"),
    ).toBe(null);
  });

  it("passes select attributes through and keeps its own classes", () => {
    render(
      <SelectField label="Timezone" name="timezone" required className="extra">
        {zones}
      </SelectField>,
    );
    const select = screen.getByLabelText("Timezone") as HTMLSelectElement;
    expect(select.required).toBe(true);
    expect(select.className).toContain("extra");
    expect(select.className).toContain("bg-ground");
  });
});

describe("Divider", () => {
  it("is a plain rule with no label", () => {
    const { container } = render(<Divider />);
    expect(container.querySelectorAll("hr").length).toBe(1);
    expect(container.textContent).toBe("");
  });

  /**
   * The word is the point: a bare rule between the Google button and the
   * password fields reads as "more form", where "or" says these are two routes
   * to the same place and one is enough.
   */
  it("sets a label into the rule, and hides the decoration from readers", () => {
    const { container } = render(<Divider label="or" />);
    expect(container.textContent).toBe("or");
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
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
    expect(cls).toContain("p-6");
  });

  /**
   * The padding has to come off through a prop, because it cannot come off
   * through a class. Tailwind emits `.p-0` *before* `.p-6`, so
   * `className="p-0"` — which four call sites were using — loses every time,
   * and their edge-to-edge strips were quietly inset by 24px on both sides.
   */
  it("drops its padding on `flush`, which a className cannot do", () => {
    const { container } = render(<Card flush>content</Card>);
    const cls = container.firstElementChild!.className;
    expect(cls).toContain("p-0");
    expect(cls).not.toContain("p-6");
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

describe("ButtonLink — the primary action that navigates", () => {
  it("looks exactly like the filled button it stands in for", () => {
    const { container } = render(<ButtonLink href="/today">Go</ButtonLink>);
    const cls = container.querySelector("a")!.className;
    expect(cls).toContain("bg-accent");
    expect(cls).toContain("min-h-[var(--touch-min)]");
    expect(cls).toContain("rounded-[var(--radius-control)]");
  });

  /**
   * The bug it exists to end: every screen needing one had written
   * `<Link><Button/></Link>`, which nests a button inside an anchor.
   */
  it("is one element, not a button wrapped in a link", () => {
    const { container } = render(<ButtonLink href="/today">Go</ButtonLink>);
    expect(container.querySelector("a button")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("offers the same text variant as the button", () => {
    const { container } = render(
      <ButtonLink href="/today" variant="text">
        Not today
      </ButtonLink>,
    );
    const cls = container.querySelector("a")!.className;
    expect(cls).toContain("text-accent");
    expect(cls).not.toContain("bg-accent ");
  });
});

describe("filled controls carry the on-accent token, not white", () => {
  /**
   * White on dark's `#35C79A` measures 2.17:1 — the product's one filled
   * button was its least readable control in half of its themes.
   */
  it.each([
    ["Button", () => render(<Button>Go</Button>).container],
    ["ButtonLink", () => render(<ButtonLink href="/x">Go</ButtonLink>).container],
  ])("%s", (_name, mount) => {
    const cls = mount().firstElementChild!.className;
    expect(cls).toContain("text-on-accent");
    expect(cls).not.toContain("text-white");
  });
});

describe("Figure — one number, never a metric grid (§8.5.5)", () => {
  it("sets the number at display size and the caption at meta", () => {
    render(<Figure value={12} unit="things" caption="you can do so far." />);
    expect(screen.getByText("12").className).toContain(
      "var(--text-display-size)",
    );
    expect(screen.getByText("you can do so far.").className).toContain(
      "var(--text-meta-size)",
    );
  });

  it("keeps the unit beside the number rather than inside it", () => {
    render(<Figure value={3} unit="hours" caption="logged." />);
    // Two nodes: a figure that read "3 hours" as one string could not be set
    // at two sizes.
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("hours")).toBeDefined();
  });

  it("omits the unit when there is not one", () => {
    const { container } = render(<Figure value={7} caption="marked." />);
    expect(container.textContent).toBe("7marked.");
  });

  it("aligns digits so two figures do not jitter", () => {
    render(<Figure value={11} caption="things." />);
    expect(screen.getByText("11").className).toContain("tabular-nums");
  });
});

describe("ToggleGroup — a pill track, not tabs (§8.5.5)", () => {
  const options = [
    { href: "/mastery", label: "What I can do", current: true },
    { href: "/mastery?show=left", label: "What's left", current: false },
  ];

  it("marks the current view for assistive technology, not by colour alone", () => {
    render(<ToggleGroup label="Which list" options={options} />);
    expect(
      screen.getByRole("link", { name: "What I can do" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "What's left" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("fills the current pill and leaves the rest quiet", () => {
    render(<ToggleGroup label="Which list" options={options} />);
    expect(
      screen.getByRole("link", { name: "What I can do" }).className,
    ).toContain("bg-accent");
    expect(screen.getByRole("link", { name: "What's left" }).className).toContain(
      "text-ink-muted",
    );
  });

  /**
   * Links rather than buttons: every view it switches between is a real URL
   * that survives a refresh, which is also what keeps it working with no
   * client JavaScript.
   */
  it("navigates rather than scripting", () => {
    render(<ToggleGroup label="Which list" options={options} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Which list" })).toBeDefined();
  });
});
