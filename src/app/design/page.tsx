import type { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  AccountIcon,
  ArrowIcon,
  CameraIcon,
  ChecklistIcon,
  DatabaseIcon,
  GridIcon,
  MasteryIcon,
  PenIcon,
  ProgressIcon,
  StepsIcon,
  TodayIcon,
} from "@/components/icons";
import {
  ArtifactMat,
  Button,
  ButtonLink,
  Card,
  Confidence,
  DisplayTitle,
  EmptyState,
  Figure,
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
  ToggleGroup,
} from "@/components/ui";
import { RubricLadder, SectionHead } from "@/components/marketing";
import { AppHeader, SectionHead as AppSectionHead } from "@/components/app-shell";
import { featuredProject } from "@/lib/content";

/**
 * §8.5.8 — "Ship a tokens.css and a /design reference route in week 1, before
 * any product screen."
 *
 * Rendering the full component set on one page is the cheapest possible guard
 * against drift, and it doubles as the visual-regression and contrast-check
 * target (§8.5.4 requires both themes to be checked in CI).
 */
export const metadata: Metadata = {
  title: "Design reference",
  robots: { index: false, follow: false },
};

function Section({
  title,
  note,
  children,
}: {
  title: string;
  /** Required: a component with no note on this page is a component nobody
   *  can review against the spec. */
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Title>{title}</Title>
        <Meta>{note}</Meta>
      </div>
      {children}
    </section>
  );
}

export default function DesignPage() {
  const featured = featuredProject();
  const heaviest = [...featured.rubricDetail.criteria].sort(
    (a, b) => b.weight - a.weight,
  )[0]!;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-16 px-6 py-16">
      <header className="flex flex-col gap-4">
        <DisplayTitle>Design reference</DisplayTitle>
        <Lead>
          Every component in the vocabulary, on one page, in whichever theme you
          are looking at. If something drifts, it drifts here first.
        </Lead>
        <ThemeToggle />
      </header>

      <Section
        title="Type"
        note="Six product sizes plus hero, which is the marketing headline and nothing else. Character comes from scale and tracking, not from mixing typefaces."
      >
        <Card className="flex flex-col gap-3">
          <HeroTitle>Prove you learned it.</HeroTitle>
          <DisplayTitle>Don&rsquo;t just learn it. Prove it.</DisplayTitle>
          <Title>Join grain and fan-out</Title>
          <Lead>
            You&rsquo;ve got the syntax down but two of your last three joins had
            the wrong grain.
          </Lead>
          <p>
            Body text sits at sixteen pixels on a 1.6 line height, capped at the
            reading measure so a long paragraph never runs past sixty-eight
            characters.
          </p>
          <Meta>Updated 12 August 2026</Meta>
        </Card>
      </Section>

      <Section
        title="Icons"
        note="Hand-drawn inline SVG, 24×24 at a 1.5 stroke, currentColor only — no icon package, because marketing routes ship zero component-library JS (§8.5.8)."
      >
        <Card className="flex flex-wrap items-center gap-8 text-ink">
          {[
            ["Steps", <StepsIcon key="s" />],
            ["Checklist", <ChecklistIcon key="c" />],
            ["Grid", <GridIcon key="g" />],
            ["Pen", <PenIcon key="p" />],
            ["Camera", <CameraIcon key="m" />],
            ["Database", <DatabaseIcon key="d" />],
            ["Today", <TodayIcon key="t" />],
            ["Mastery", <MasteryIcon key="y" />],
            ["Progress", <ProgressIcon key="r" />],
            ["Account", <AccountIcon key="a" />],
            ["Arrow", <ArrowIcon key="w" />],
          ].map(([label, icon]) => (
            <span key={String(label)} className="flex flex-col items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-accent">
                {icon}
              </span>
              <Meta>{label}</Meta>
            </span>
          ))}
        </Card>
      </Section>

      <Section
        title="Product page composition"
        note="§8.5.9's rules, as the product screens get them: one frame, a header that carries its facts on a rule, and a band opener with an accent eyebrow over a display-size title."
      >
        <Card className="flex flex-col gap-10">
          <AppHeader
            icon={<TodayIcon />}
            title="Today"
            lead="One thing at a time, chosen for you and explained."
            facts={
              <>
                <Meta>Photography</Meta>
                <Meta>35 min</Meta>
                <Status tone="verified">On track</Status>
              </>
            }
          />
          <AppSectionHead label="The rest of it" title="Your path" />
        </Card>
      </Section>

      <Section
        title="Figure"
        note="One number at display size with the word that says what it is. One per scroll band, never a row of them, and never a percentage — that is the metric grid §8.5.5 bans."
      >
        <Card className="flex flex-wrap gap-12">
          <Figure value={12} unit="things" caption="you can do so far. 8 to go." />
          <Figure value={3} unit="hours" caption="logged of the 5 you set aside." />
        </Card>
      </Section>

      <Section
        title="Toggle group"
        note="Switching between 2–4 views: text labels in a pill track. Links, not buttons, so each view is a real URL that survives a refresh."
      >
        <Card className="flex flex-wrap gap-6">
          <ToggleGroup
            label="Which list"
            options={[
              { href: "#can-do", label: "What I can do", current: true },
              { href: "#left", label: "What's left", current: false },
            ]}
          />
        </Card>
      </Section>

      <Section
        title="Status"
        note="A dot plus a word — never a badge, and never colour alone."
      >
        <Card className="flex flex-wrap gap-6">
          <Status tone="verified">Verified</Status>
          <Status tone="attention">Needs work</Status>
          <Status tone="problem">Failed</Status>
          <Status tone="neutral">Not started</Status>
        </Card>
      </Section>

      <Section
        title="Confidence"
        note="Three segments and a word. Never a percentage — the number would imply precision the verdict does not have."
      >
        <Card className="flex flex-col gap-4">
          <Confidence level="high" />
          <Confidence level="medium" />
          <Confidence level="low" />
        </Card>
      </Section>

      <Section
        title="Pack maturity"
        note="§7.1 — depth is declared to the learner, not faked."
      >
        <Card className="flex flex-col gap-4">
          <MaturityBadge maturity="curated" />
          <MaturityBadge maturity="standard" />
          <MaturityBadge maturity="generated" />
        </Card>
      </Section>

      <Section
        title="Link card"
        note="§8.5.9 — the one clickable card. Every index page used to hand-roll its own as bg-surface with no shadow, which in light is #FFFFFF on #FAFAFA: a 2% step, i.e. no visible card. Hover lifts; it never tints, because a card is not 'verified' because you pointed at it."
      >
        <ul className="grid list-none grid-cols-1 gap-4 p-0 m-0 sm:grid-cols-2">
          {[
            ["Join grain and fan-out", "Point at me"],
            ["GROUP BY and result grain", "Then at me"],
          ].map(([title, hint], i) => (
            <li key={title} className="rise" style={stagger(i)}>
              <LinkCard href="/design">
                <span className="text-[length:var(--text-label-size)] font-[650] text-ink">
                  {title}
                </span>
                <Meta>{hint}</Meta>
              </LinkCard>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Row list"
        note="A card containing full-width rows. Not a data table."
      >
        <RowList>
          <Row>
            <span>Join grain and fan-out</span>
            <Confidence level="medium" />
          </Row>
          <Row>
            <span>GROUP BY and result grain</span>
            <Confidence level="high" />
          </Row>
          <Row>
            <span>Window frames</span>
            <Status tone="neutral">Locked</Status>
          </Row>
        </RowList>
      </Section>

      <Section
        title="Actions"
        note="One filled button per screen. Everything else is a text button."
      >
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Button>Start today&rsquo;s session</Button>
          <Button variant="text">Not today</Button>
          <Button disabled>Submitted</Button>
          {/* Same contract, rendered as a link — for a primary action that
              navigates rather than submits. */}
          <ButtonLink href="#today">Back to today</ButtonLink>
        </Card>
      </Section>

      <Section
        title="Loading"
        note="A skeleton matching the final layout. Never a spinner."
      >
        <Card className="flex flex-col gap-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </Card>
      </Section>

      <Section title="Empty state" note="One sentence and one button.">
        <Card>
          <EmptyState
            message="Nothing is due today. Your next session unlocks tomorrow."
            action={<Button variant="text">Change plan</Button>}
          />
        </Card>
      </Section>

      <Section
        title="Section head"
        note="§8.5.9 — a numbered eyebrow over a display-size title. Sections used to be a bare Title over prose at the same weight, which is what made pages read as one long list. `onField` swaps the icon chip to a surface, because on the accent field an accent-weak chip is the same fill as its background."
      >
        <div className="flex flex-col gap-8">
          <SectionHead
            step="01"
            label="On ground"
            title="The default"
            icon={<StepsIcon />}
          />
          <div className="rounded-[var(--radius-card)] bg-accent-weak p-6">
            <SectionHead
              step="02"
              label="On the accent field"
              title="Chip becomes a surface"
              icon={<ChecklistIcon />}
              onField
            />
          </div>
        </div>
      </Section>

      <Section
        title="Elevation"
        note="Two shadows. --shadow-raised is the product default; --shadow-lifted exists only for marketing showcase surfaces, where a --surface card on the --accent-weak field measures 1.13:1 and would otherwise have no edge."
      >
        <div className="flex flex-col gap-6 rounded-[var(--radius-card)] bg-accent-weak p-6 sm:flex-row">
          <div className="flex-1 rounded-[var(--radius-card)] bg-surface p-5 shadow-[var(--shadow-raised)]">
            <Meta tone="muted">--shadow-raised</Meta>
          </div>
          <div className="flex-1 rounded-[var(--radius-card)] bg-surface p-5 shadow-[var(--shadow-lifted)]">
            <Meta tone="muted">--shadow-lifted</Meta>
          </div>
        </div>
      </Section>

      <Section
        title="Band ladder"
        note="§4.2 law 2 made legible — a real criterion from a real rubric, with what each grade band actually says. Competent is marked because a four-rung ladder with no marked line leaves the reader guessing which rung they have to reach."
      >
        <Card>
          <RubricLadder criterion={heaviest} />
        </Card>
      </Section>

      <Section
        title="Entrance motion"
        note="§8.5.6 — 24ms stagger, first render only, pure CSS so marketing routes still ship no motion JS. Under prefers-reduced-motion the translate is zeroed and it becomes a 100ms fade."
      >
        <Card className="flex flex-col gap-3">
          {["First", "Second", "Third"].map((label, i) => (
            <span
              key={label}
              className="rise"
              style={{ "--rise-delay": `${i * 24}ms` } as React.CSSProperties}
            >
              {label} — rises 12px and fades in
            </span>
          ))}
        </Card>
      </Section>

      <Section
        title="Artefact mat"
        note="§8.5.4 — learner work renders at true colour in both themes. A dark-mode filter over a photograph being graded would make the verdict wrong."
      >
        <ArtifactMat className="h-40">
          <Meta>Submitted artefact renders here, untinted</Meta>
        </ArtifactMat>
      </Section>
    </main>
  );
}
