import { ButtonLink, Card, Lead, Meta, stagger, Title } from "@/components/ui";
import { CourseList, type CourseSummary } from "@/components/course-list";
import { SectionHead } from "@/components/app-shell";
import type { LearnerStanding } from "@/lib/goals/standing";

/**
 * What every screen says to a learner with no course running.
 *
 * `/today` said one thing — you were partway through a conversation, or you
 * have a course put aside — and `/calendar`, `/mastery` and `/progress` said
 * another: "No course running. Pick a subject." Both about the same learner, at
 * the same moment. The second is not merely thinner; where a subject is being
 * built for them it is wrong, and it points at the catalogue as though the thing
 * they already started did not exist.
 *
 * One component, for the same reason `CourseList` is one component: this is a
 * claim about what the learner is in the middle of, and four screens wording it
 * separately is how they came to contradict each other.
 */

export function NothingRunning({
  standing,
  note,
  catalogue = true,
}: {
  standing: LearnerStanding;
  /**
   * What *this* screen will hold once a course is running. The offer is the
   * same everywhere; what the learner came here for is not.
   */
  note?: string;
  /**
   * Whether to point at `/subjects` from the card. `/today` sets this false —
   * it carries a sample of the catalogue below the card, and a second door to
   * the same place would be the denser screen §8.5.1 warns about.
   */
  catalogue?: boolean;
}) {
  const { building, resume } = standing;

  return (
    <Card className="rise flex flex-col items-start gap-4" style={stagger(1)}>
      {building ? (
        <>
          <Title>We&rsquo;re writing your course now</Title>
          <Lead>
            Nobody had written {building.subject} for us, so we&rsquo;re building
            it — the skills, what depends on what, and the questions that work
            out where you already are. It takes a few minutes.
          </Lead>
          {/* The wait screen, which is the only place that knows how far along
              it is. Offering "build it" here — which is what `/today` did —
              hands the learner a button that fails, because they already have
              a course being built. */}
          <ButtonLink
            href={`/start/building?subject=${encodeURIComponent(building.slug)}`}
          >
            See how it&rsquo;s going
          </ButtonLink>
        </>
      ) : resume ? (
        <>
          <Title>
            {resume.ready
              ? "Your course is ready to build"
              : "You were partway through"}
          </Title>
          <Lead>
            {resume.subject
              ? `We were talking about ${resume.subject}.`
              : "We were working out what you wanted."}{" "}
            {resume.ready
              ? "Nothing more to answer — it just needs building."
              : `${resume.turns} of ${resume.ofTurns} questions answered.`}
          </Lead>
          <ButtonLink href="/start">
            {resume.ready ? "Build it" : "Carry on"}
          </ButtonLink>
        </>
      ) : (
        <>
          <Title>Pick something to get good at</Title>
          <Lead>
            Tell us in your own words and we&rsquo;ll work out what to do first —
            and what to skip because you can already do it. If we don&rsquo;t
            cover it yet, we&rsquo;ll build it.
          </Lead>
          {/* One filled button (§8.5.5). The catalogue is the quieter door,
              for the learner who would rather see what exists than describe
              what they want. */}
          <div className="flex w-full flex-wrap items-center gap-3">
            <ButtonLink href="/start">Tell us what you want</ButtonLink>
            {catalogue ? (
              <ButtonLink href="/subjects" variant="text">
                Pick a subject
              </ButtonLink>
            ) : null}
          </div>
        </>
      )}

      {note ? <Meta>{note}</Meta> : null}
    </Card>
  );
}

/**
 * The courses band, wherever a learner is met with nothing running.
 *
 * A course put aside beats anything on the catalogue: they have already chosen
 * it, mastery from it is already theirs, and the retrieval queue kept running
 * while it was away. Its own band rather than the card above, so resuming and
 * starting are two offers rather than a choice between them.
 *
 * `/progress` does not use this: it lists every course, finished ones included,
 * because that screen is where a course is managed rather than re-entered.
 */
export function PickBackUp({ courses }: { courses: readonly CourseSummary[] }) {
  if (courses.length === 0) return null;

  return (
    <section className="rise flex flex-col gap-6" style={stagger(2)}>
      <SectionHead label="You have these already" title="Pick one back up" />
      <CourseList courses={courses} />
      <Meta>
        Everything you proved on these is still yours — picking one up puts it
        back on your Today.
      </Meta>
    </section>
  );
}
