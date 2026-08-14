import Link from "next/link";
import { SubjectIcon } from "@/components/icons";
import { MaturityBadge, Meta, Row, RowList, stagger, Status } from "@/components/ui";
import { groupByCategory } from "@/lib/content/categories";
import type { TopicSummary } from "@/lib/content";

/**
 * The catalogue row, shared by `/subjects` and the no-goal `/today`.
 *
 * Shared because both screens are making the same two offers about the same
 * subject — take the check, or start here — and a learner who sees them worded
 * differently on two screens reasonably concludes they are different things.
 *
 * §8.5.1 forbids browse as a permanent fixture, and this is not one: neither
 * screen that renders it is in the nav as a place to graze. It is the door in
 * for someone with no course, and it closes behind them.
 */

/**
 * `/start` takes free text and opens the conversation with it, so the link
 * carries the subject's **name** rather than its slug. The analyzer then reads
 * "Photography" instead of "photography-fundamentals", which is what a person
 * would have typed and what its prompt is written against.
 */
export function startHref(topic: TopicSummary): string {
  return `/start?topic=${encodeURIComponent(topic.name)}`;
}

export function SubjectRow({
  topic,
  checked = false,
  index = 0,
}: {
  topic: TopicSummary;
  /**
   * They already answered a check in this subject. §24 E11 carries those
   * answers into the course, and the promise is worth making *before* they
   * commit rather than only on the form at the end of the funnel.
   */
  checked?: boolean;
  index?: number;
}) {
  return (
    <Row className="rise flex-wrap" style={stagger(index)}>
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-accent">
          <SubjectIcon taxonomyParent={topic.taxonomyParent} />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <Link
            href={startHref(topic)}
            className="font-[550] underline-offset-4 hover:text-accent hover:underline"
          >
            {topic.name}
          </Link>
          <Meta>
            {topic.skillCount} skills · about {topic.totalHours} hours
          </Meta>
        </span>
      </span>

      <span className="flex shrink-0 flex-wrap items-center gap-3">
        {checked ? (
          <Status tone="verified">Your check comes with you</Status>
        ) : (
          <MaturityBadge maturity={topic.maturity} />
        )}
        <Link
          href={`/check/${topic.slug}`}
          className="font-[550] text-accent underline-offset-4 hover:underline"
        >
          {checked ? "Check again" : "Take the check"}
        </Link>
      </span>
    </Row>
  );
}

/**
 * Grouped by §7.1's taxonomy branch once there is more than one group.
 *
 * A flat list of six subjects is still readable; a flat list of the sixty §7.1
 * plans is a wall, and the shape of the catalogue is information in itself —
 * a learner scanning for "is there anything here for me" answers it from the
 * headings without reading a single row.
 *
 * The heading only appears from the second group onwards for the same reason
 * `/mastery` suppresses its subject heading with one course: with everything in
 * one branch, a heading names what the page has already named.
 */
export function SubjectList({
  topics,
  checked,
}: {
  topics: readonly TopicSummary[];
  checked: ReadonlySet<string>;
}) {
  const groups = groupByCategory([...topics]);

  if (groups.length <= 1) {
    return (
      <RowList className="shadow-[var(--shadow-raised)]">
        {topics.map((topic, i) => (
          <SubjectRow
            key={topic.slug}
            topic={topic}
            checked={checked.has(topic.slug)}
            index={i}
          />
        ))}
      </RowList>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map(({ category, topics: inGroup }) => (
        <section key={category.slug} className="flex flex-col gap-3">
          <span className="text-[length:var(--text-meta-size)] font-[650] uppercase tracking-[0.12em] text-accent">
            {category.name}
          </span>
          <RowList className="shadow-[var(--shadow-raised)]">
            {inGroup.map((topic, i) => (
              <SubjectRow
                key={topic.slug}
                topic={topic}
                checked={checked.has(topic.slug)}
                index={i}
              />
            ))}
          </RowList>
        </section>
      ))}
    </div>
  );
}
