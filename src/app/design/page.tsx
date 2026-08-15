import type { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  AccountIcon,
  ArrowIcon,
  CameraIcon,
  ChecklistIcon,
  DatabaseIcon,
  GoogleIcon,
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
  HeroBand,
  HeroTitle,
  Lead,
  LinkCard,
  MaturityBadge,
  Meta,
  Row,
  RowList,
  Signal,
  Skeleton,
  stagger,
  Status,
  Title,
  ToggleGroup,
} from "@/components/ui";
import { CourseOutline, OutlineLegend } from "@/components/course-outline";
import type { Outline } from "@/lib/goals/outline";
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

/**
 * One of each state, which is the only fixture this page ever wants: the
 * outline's job is to make four states legible at a glance, and a sample
 * missing one of them cannot show whether it does.
 */
const OUTLINE: Outline = {
  counts: { open: 1, locked: 1, proved: 1, optional: 1 },
  sections: [
    {
      key: "module-0",
      title: "Getting the grain right",
      state: "open",
      hours: 4,
      current: true,
      handIn: "Ends with a project you hand in, and we mark it",
      skills: [
        {
          skillId: "grain",
          name: "GROUP BY and result grain",
          state: "open",
          hours: 4,
          note: "Open to you now — you'll be able to say what one row of a result means.",
        },
        {
          skillId: "fan-out",
          name: "Join grain and fan-out",
          state: "locked",
          hours: 3,
          note: "Unlocks once you've done GROUP BY and result grain.",
        },
      ],
    },
    {
      key: "module-1",
      title: "Reading a schema",
      state: "proved",
      hours: 0,
      current: false,
      handIn: null,
      skills: [
        {
          skillId: "schema",
          name: "Reading a schema you didn't write",
          state: "proved",
          hours: 0,
          note: "You already showed you can find the table a question is really about.",
        },
      ],
    },
    {
      key: "trailing-optional",
      title: "Not in your course",
      state: "optional",
      hours: 9,
      current: false,
      handIn: null,
      skills: [
        {
          skillId: "tuning",
          name: "Query tuning",
          state: "optional",
          hours: 9,
          note: "Not in your course at this depth — still yours to take on.",
        },
      ],
    },
  ],
};

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
        title="Hero band"
        note="The one thing a screen is about. A surface card with the claim inset on the accent field, whatever supports it underneath, and the actions on a ruled bar. One per screen — the accent field is what makes it the loudest thing, and two of them make it neither."
      >
        <div className="flex flex-col gap-6">
          {/* Both shapes it takes in the product: a claim with work under it
              and something to press, and a figure that is the whole band. */}
          <HeroBand
            field={<Title className="text-ink">Ratios, before the joins that need them</Title>}
            footer={
              /* `ButtonLink`, like the link-card example below: a reference
                 page must not render a live `<button>` that does nothing, and
                 §8.5.5's one-filled-button rule is guarded by a test that
                 counts them — the catalogue demonstrates the rule rather than
                 spending its allowance twice. */
              <>
                <ButtonLink href="/design">Start session</ButtonLink>
                <span className="font-[550] text-accent">I have less time</span>
              </>
            }
          >
            <RowList className="bg-raised">
              <Row>
                <span className="flex items-center gap-3">
                  <span className="inline-flex min-w-14 justify-center rounded-[var(--radius-pill)] bg-accent-weak px-2.5 py-1 text-[length:var(--text-meta-size)] font-[650] text-accent">
                    Read
                  </span>
                  Aperture and depth of field
                </span>
                <Meta>8 min</Meta>
              </Row>
              <Row>
                <span className="flex items-center gap-3">
                  <span className="inline-flex min-w-14 justify-center rounded-[var(--radius-pill)] bg-accent-weak px-2.5 py-1 text-[length:var(--text-meta-size)] font-[650] text-accent">
                    Do
                  </span>
                  Shoot the same frame at three stops
                </span>
                <Meta>20 min</Meta>
              </Row>
            </RowList>
          </HeroBand>

          <HeroBand
            field={
              <>
                <Figure
                  value={3}
                  unit="hours"
                  caption="logged of the 5 you set aside, across 2 sessions."
                />
                <Status tone="attention">Short of what you planned</Status>
              </>
            }
          />
        </div>
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
        note="A dot plus a word — never a badge, and never colour alone. `live` breathes the dot, and only for something changing while you look at it."
      >
        <Card className="flex flex-wrap gap-6">
          <Status tone="verified">Verified</Status>
          <Status tone="attention">Needs work</Status>
          <Status tone="problem">Failed</Status>
          <Status tone="neutral">Not started</Status>
          <Status tone="verified" live>
            Being written
          </Status>
        </Card>
      </Section>

      <Section
        title="Signal"
        note="Status, at card scale: one unfinished thing, marked with a 6px rule down its leading edge. One per scroll band. The state word is mandatory — the rule cannot be drawn without something saying what it means. No neutral tone, because a grey rule says look-here about nothing."
      >
        <div className="flex flex-col gap-4">
          <Signal
            tone="verified"
            live
            state="Being written"
            title="We’re writing your course now"
            /* `text`, though the product draws this one filled: the catalogue
               spends its single filled button on the hero band above, for the
               reason noted there. What this demonstrates is the slot. */
            action={
              <ButtonLink href="/design" variant="text">
                See how it’s going
              </ButtonLink>
            }
          >
            <Lead>
              Nobody had written Kilnwork for us, so we’re building it — the
              skills, what depends on what, and the questions that work out
              where you already are.
            </Lead>
          </Signal>

          <Signal
            tone="attention"
            state="Left unfinished"
            title="You were partway through"
          >
            <Lead>
              We were talking about Photography. 3 of 6 questions answered.
            </Lead>
          </Signal>

          <Signal
            tone="problem"
            state="Stopped"
            title="We couldn’t build this one"
          >
            <Lead>
              Nothing you answered is lost. Our team has been told and will look
              at this one.
            </Lead>
          </Signal>
        </div>
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
        note="§7.1 — depth is declared to the learner, not faked. Two inputs decide the claim: how deep the material is, and who checked it. The label is what was actually done, and only a human sign-off gets the verified tone — a model review can open the index gate but cannot borrow the badge a person earns."
      >
        <Card className="flex flex-col gap-4">
          {/* Five, not six: an unreviewed pack claims no check whatever its
              depth, so curated+null and standard+null are the same claim and a
              sixth badge would be a duplicate posing as a distinct state. */}
          <MaturityBadge maturity="curated" review="human" />
          <MaturityBadge maturity="standard" review="human" />
          <MaturityBadge maturity="curated" review="model" />
          <MaturityBadge maturity="standard" review={null} />
          <MaturityBadge maturity="generated" review={null} />
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
        title="Course outline"
        note="The row list nested one level: a card per section, skills inside it, opened by <details> rather than by state. Every state carries a word and a sentence — a locked row that cannot say what it is waiting for is an icon with no tooltip, which §8.5.5 bans outright."
      >
        <div className="flex flex-col gap-4">
          <OutlineLegend counts={OUTLINE.counts} />
          <CourseOutline outline={OUTLINE} />
        </div>
      </Section>

      <Section
        title="Actions"
        note="One filled button per screen. Everything else is a text button — except the one outlined variant, which only ever hands off to an identity provider."
      >
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Button>Start today&rsquo;s session</Button>
          <Button variant="text">Not today</Button>
          <Button disabled>Submitted</Button>
          {/* Same contract, rendered as a link — for a primary action that
              navigates rather than submits. */}
          <ButtonLink href="#today">Back to today</ButtonLink>
          {/* The federated sign-in exception. It carries no accent, so it stays
              subordinate to the filled button beside it. */}
          <Button variant="social">
            <GoogleIcon />
            Continue with Google
          </Button>
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
