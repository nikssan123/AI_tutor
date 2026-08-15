import Link from "next/link";
import { getDb } from "@/db";
import { getAnthropic, hasApiKey } from "@/lib/ai/client";
import { lessonForBlock } from "@/lib/session/view";
import type { EngineSkill, MasteryState } from "@/lib/engine";
import type { PriorDomain } from "@/lib/contracts/goal";
import type { PlanId } from "@/lib/billing/catalog";
import { Lead, Meta, Title } from "@/components/ui";

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
    <article className="flex flex-col gap-5">
      <Lead className="text-ink">{content.objective}</Lead>

      {content.sections.map((section) => (
        <div key={section.heading} className="flex flex-col gap-1.5">
          <Title>{section.heading}</Title>
          <p className="whitespace-pre-wrap">{section.body}</p>
        </div>
      ))}

      <div className="flex flex-col gap-1.5 rounded-[var(--radius-control)] bg-raised p-5">
        <Meta>Worked example</Meta>
        <p className="whitespace-pre-wrap">{content.workedExample}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Meta>What people get wrong</Meta>
        <p className="whitespace-pre-wrap">{content.commonMistake}</p>
      </div>
    </article>
  );
}
