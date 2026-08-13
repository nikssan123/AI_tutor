import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { allTopics } from "@/lib/content";
import { answeredTopics } from "@/lib/check/session";
import { coursesFor, pickUpAgain } from "@/lib/goals/courses";
import { SubjectList } from "@/components/subject-list";
import { CourseList } from "@/components/course-list";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import { ButtonLink, Card, Lead, Meta, stagger, Title } from "@/components/ui";

/**
 * The catalogue — what the product can teach, and how well.
 *
 * It exists because there was exactly one door into a course: `/start`, a
 * six-turn conversation. That is the right door for someone who knows what they
 * want. For someone who has just signed up and is looking around, being asked a
 * question before being shown anything is a commitment interview, and the four
 * screens behind it all said "you don't have a goal yet".
 *
 * This is not a browse surface in §8.5.1's sense and it is deliberately not in
 * the nav. Nothing links here once there is a course running.
 *
 * §7.1's honesty is the point of the page rather than a footnote on it: every
 * subject carries the badge that says whether a person wrote it, and the note
 * below says what "we cannot verify this" means before anyone picks.
 */
export const metadata: Metadata = {
  title: "Subjects",
  robots: { index: false, follow: false },
};

export default async function SubjectsPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const topics = allTopics();
  const [courses, jar] = await Promise.all([
    coursesFor(getDb(), session.user.id),
    cookies(),
  ]);

  const again = pickUpAgain(courses);
  const checked = answeredTopics(
    topics.map((t) => t.slug),
    (name) => jar.get(name)?.value,
  );

  return (
    <AppFrame>
      <AppHeader
        eyebrow="Pick something"
        title="What you can learn here"
        lead="Every subject says how it was built and what it can check. Take a ten-minute check first if you want to know where you stand, or start straight away."
        facts={<Meta>{topics.length} subjects</Meta>}
      />

      {/* Above the catalogue, because starting a fourth course while three sit
          paused is the outcome this screen would otherwise quietly encourage. */}
      {again.length > 0 ? (
        <section className="rise flex flex-col gap-6" style={stagger(1)}>
          <SectionHead label="Already yours" title="Courses you put aside" />
          <CourseList courses={again} />
        </section>
      ) : null}

      <SubjectList topics={topics} checked={checked} />

      {/*
       * §7.1's third tier, said plainly rather than left as an absence. A
       * catalogue that only lists what exists reads as "these are your options",
       * and the honest answer is that the list is not the limit.
       */}
      <section className="rise flex flex-col gap-6" style={stagger(2)}>
        <SectionHead label="Not on the list" title="Ask for anything else" />
        <Card className="flex flex-col items-start gap-4">
          <Title>We&rsquo;ll build the subject</Title>
          <Lead>
            Tell us what you want to get good at in your own words. If nothing
            above covers it, we write the course before you start — and we say so
            on every screen afterwards, because nobody has read it but a machine.
          </Lead>
          <ButtonLink href="/start">Tell us what you want</ButtonLink>
        </Card>
      </section>

      <Meta>
        A check narrows things down; it cannot prove you can do the work.{" "}
        <Link href="/projects" className="font-[550] text-accent underline-offset-4 hover:underline">
          Only handing in work does that.
        </Link>
      </Meta>
    </AppFrame>
  );
}
