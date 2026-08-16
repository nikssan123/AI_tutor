import Link from "next/link";
import { getDb } from "@/db";
import { getAnthropic, hasApiKey } from "@/lib/ai/client";
import { lessonForBlock } from "@/lib/session/view";
import type { EngineSkill, MasteryState } from "@/lib/engine";
import type { PriorDomain } from "@/lib/contracts/goal";
import type { PlanId } from "@/lib/billing/catalog";
import { cx, Meta, Status, Title } from "@/components/ui";
import { GeneratedProse } from "@/components/generated-prose";

/**
 * The lesson body, in its own file so it can be awaited on its own.
 *
 * It is the one part of a session that can cost a model call, so the page
 * renders it inside a Suspense boundary: the blocks, the progress rail and the
 * tutor are already in the browser while this is still being written. That is
 * what makes §24 E7's first-token budget a property of the page rather than of
 * the slowest thing on it.
 */

export interface LessonBodyProps {
  userId: string;
  packSlug: string;
  skill: EngineSkill | undefined;
  mastery: MasteryState | undefined;
  minutes: number;
  now: Date;
  /** The analogy the lesson may reach for — see `PriorDomain`. */
  priorDomain: PriorDomain;
  /** §14.9.7 limit 1 — whose ceiling this generation counts against. */
  plan: PlanId;
  /** The plan's per-course lesson allowance. `null` is unlimited. */
  lessonsPerCourse: number | null;
}

export async function LessonBody(props: LessonBodyProps) {
  if (!props.skill || !props.mastery || !hasApiKey()) {
    return (
      <Meta>
        The written lesson isn&rsquo;t available right now. The tutor below knows
        what this block is about and can talk you through it.
      </Meta>
    );
  }

  const { content, capped, locked } = await lessonForBlock(
    getDb(),
    getAnthropic(),
    {
      userId: props.userId,
      packSlug: props.packSlug,
      skill: props.skill,
      mastery: props.mastery,
      minutes: props.minutes,
      now: props.now,
      priorDomain: props.priorDomain,
      plan: props.plan,
      lessonsPerCourse: props.lessonsPerCourse,
    },
  );

  /*
   * Three ways to have no lesson, and none of them are the same sentence.
   *
   * The paywall is first because it is the only one that is *by design*. It
   * says where the course stops and what it costs to carry on, and it says it
   * about this course — a learner who has read one lesson of a plan they can
   * see all of knows exactly what they would be buying, which is the whole
   * reason the plan is given away in full.
   *
   * A ceiling is something the learner can act on but is not being sold, so it
   * says so and mentions the reset. A failed generation is ours, so it
   * apologises and does not try to sell anything — pitching an upgrade on the
   * back of our own error would be the worst moment in the product to do it.
   */
  if (!content && locked) {
    return (
      <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-hairline p-5">
        <Title>This is where the free course stops</Title>
        <Meta>
          You&rsquo;ve read the lesson your free plan includes. The rest of{" "}
          {props.skill.name} — and every other skill on your plan — is written
          the same way, and the tutor below can still talk you through this
          block in the meantime.
        </Meta>
        <Link
          href="/pricing"
          className="text-accent underline-offset-4 hover:underline"
        >
          Unlock the rest of this course
        </Link>
      </div>
    );
  }

  if (!content) {
    return capped ? (
      <Meta>
        You&rsquo;ve used everything this month&rsquo;s free plan includes, so
        there&rsquo;s no written lesson for this block. The tutor below can
        still talk you through it, and it all resets on the 1st.{" "}
        <Link href="/pricing" className="text-accent underline-offset-4 hover:underline">
          Or see what Pro includes
        </Link>
        .
      </Meta>
    ) : (
      <Meta>
        We couldn&rsquo;t write this lesson just now. The tutor below can still
        talk you through it.
      </Meta>
    );
  }

  return (
    /*
     * `gap-14` between the parts of a lesson, against `gap-7` between the
     * paragraphs inside one. The ratio is the whole of what makes a long lesson
     * scannable: every gap on the page has to be unmistakably bigger or smaller
     * than the gaps either side of it, and this article used `gap-10` over
     * `gap-4` over a 25.6px line — three spacings close enough together that
     * the eye read them as one.
     */
    <article className="flex flex-col gap-14">
      {/*
       * The objective, and then nothing else claiming to be the objective. The
       * block used to open with the skill's can-do statement in a `Lead` and
       * this line directly under it, which are the same sentence written twice
       * — the reader's first two paragraphs said one thing.
       *
       * Written out rather than `<Lead className="text-ink">`, which is what it
       * was and which never worked: `Lead` carries `text-ink-muted`, and two
       * competing `text-*` utilities resolve by the order Tailwind emitted them
       * rather than the order they are written. The opening claim of the lesson
       * has been rendering a tone quieter than the body under it.
       */}
      <p
        className={cx(
          /* `text-pretty`, not `text-balance`. Balancing equalises every line
             of a block, which is what you want for a two-line heading and very
             much not for a six-line standfirst — it wrapped this one at about
             45 characters and left the column looking half-used. */
          "max-w-[var(--measure)] text-ink text-pretty",
          "text-[length:var(--text-title-size)] leading-[1.35] font-[550]",
          "tracking-[var(--text-title-tracking)]",
        )}
      >
        {content.objective}
      </p>

      {content.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-5">
          <Title>{section.heading}</Title>
          <GeneratedProse variant="reading" text={section.body} />
        </section>
      ))}

      {/*
       * The worked example, which §16.4 makes the part a stuck learner reads,
       * marked as the one passage to follow along with.
       *
       * The rule is the whole mark, and it runs the full height of the passage
       * rather than sitting under a label — it is the only thing on the page
       * saying "this bit is a single sequence, follow it top to bottom".
       */}
      <section className="flex flex-col gap-5 border-l-2 border-accent ps-6">
        <Title>Worked example</Title>
        <GeneratedProse variant="reading" text={content.workedExample} />
      </section>

      {/*
       * The mistake, in the one tone the design has for "this is the bit that
       * catches people". It was a 13px faint label over body text — the most
       * useful four lines in the lesson, set as the quietest thing on screen.
       */}
      <section className="flex flex-col gap-5">
        <Status tone="attention">What people get wrong</Status>
        <GeneratedProse variant="reading" text={content.commonMistake} />
      </section>
    </article>
  );
}
