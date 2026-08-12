import type { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  ArtifactMat,
  Button,
  Card,
  Confidence,
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
        note="Six sizes. Character comes from scale and tracking, not from mixing typefaces."
      >
        <Card className="flex flex-col gap-3">
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
