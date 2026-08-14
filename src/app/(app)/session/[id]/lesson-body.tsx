import { getDb } from "@/db";
import { getAnthropic, hasApiKey } from "@/lib/ai/client";
import { lessonForBlock } from "@/lib/session/view";
import type { EngineSkill, MasteryState } from "@/lib/engine";
import type { PriorDomain } from "@/lib/contracts/goal";
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

  const { content } = await lessonForBlock(getDb(), getAnthropic(), {
    userId: props.userId,
    packSlug: props.packSlug,
    skill: props.skill,
    mastery: props.mastery,
    minutes: props.minutes,
    now: props.now,
    priorDomain: props.priorDomain,
  });

  // No lesson is shown as no lesson. Filler text would be the product teaching
  // something nobody wrote.
  if (!content) {
    return (
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
