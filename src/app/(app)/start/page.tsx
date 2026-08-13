import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { allTopics } from "@/lib/content";
import { cookieName, decode } from "@/lib/check/session";
import { SubjectIcon } from "@/components/icons";
import {
  Button,
  Card,
  DisplayTitle,
  Lead,
  Meta,
  Status,
  Title,
} from "@/components/ui";
import { createGoalAction } from "./actions";

/**
 * §8 screen 3 — goal creation.
 *
 * The plan describes this as a conversation, not a form, and it should be one:
 * the Goal Analyzer's job is to take "I want to switch into data" and work out
 * the subject, the level and the budget. Until that model is wired up, asking
 * directly is the honest version of the same screen — it collects exactly the
 * fields §14.9.2's `GoalSpec` needs, and it does not pretend to understand
 * anything it wasn't told.
 */
export const metadata: Metadata = {
  title: "Set a goal",
  robots: { index: false, follow: false },
};

const OUTCOMES = [
  { value: "career", label: "Work — a job, a promotion, a change" },
  { value: "project", label: "Something specific I want to make" },
  { value: "exam", label: "An exam or certification" },
  { value: "personal", label: "For myself" },
  { value: "curiosity", label: "Curiosity" },
];

const LEVELS = [
  { value: "none", label: "Never done it" },
  { value: "beginner", label: "Dabbled a bit" },
  { value: "intermediate", label: "Can do the basics" },
  { value: "advanced", label: "Experienced, filling gaps" },
];

type Props = { searchParams: Promise<{ error?: string }> };

export default async function StartPage({ searchParams }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { error } = await searchParams;
  const topics = allTopics();
  const jar = await cookies();

  // A visitor who took a check before signing up should see that it counted for
  // something, on the screen where it starts counting (§24 E11).
  const answered = new Set(
    topics
      .filter((t) => decode(jar.get(cookieName(t.slug))?.value).a.length > 0)
      .map((t) => t.slug),
  );

  const field = "flex flex-col gap-2";
  const input =
    "rounded-[var(--radius-control)] border border-hairline bg-surface p-3 text-ink placeholder:text-ink-faint";

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-10 px-6 py-16">
      <DisplayTitle>What do you want to get good at?</DisplayTitle>
      <Lead>
        Pick a subject and tell us how much time you actually have. We&rsquo;ll
        work out what to do first — and what to skip because you can already do
        it.
      </Lead>

      {error ? <Status tone="problem">{error}</Status> : null}

      <form action={createGoalAction} className="flex flex-col gap-10">
        <fieldset className="flex flex-col gap-3 border-0 p-0 m-0">
          <legend className="sr-only">Subject</legend>
          <Title>Subject</Title>
          <ul className="flex list-none flex-col gap-0 p-0 m-0 overflow-hidden rounded-[var(--radius-card)] bg-surface">
            {topics.map((topic, i) => (
              <li key={topic.slug} className="border-b border-hairline last:border-b-0">
                <label className="flex cursor-pointer items-center gap-3 px-5 py-4">
                  <input
                    type="radio"
                    name="topic"
                    value={topic.slug}
                    defaultChecked={i === 0}
                    required
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="text-ink-muted">
                    <SubjectIcon taxonomyParent={topic.taxonomyParent} />
                  </span>
                  <span className="font-[550]">{topic.name}</span>
                  <span className="ml-auto flex items-center gap-3">
                    {answered.has(topic.slug) ? (
                      <Status tone="verified">Your check comes with you</Status>
                    ) : null}
                    <Meta>{topic.skillCount} skills</Meta>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className={field}>
          <label htmlFor="rawGoal">
            <Title>In your own words</Title>
          </label>
          <Meta>
            Optional. Stored exactly as you write it — nothing reads it yet.
          </Meta>
          <input
            id="rawGoal"
            name="rawGoal"
            maxLength={500}
            placeholder="I want to stop guessing at my shutter speed"
            className={input}
          />
        </div>

        <fieldset className="flex flex-col gap-3 border-0 p-0 m-0">
          <legend className="sr-only">What this is for</legend>
          <Title>What&rsquo;s it for?</Title>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {OUTCOMES.map((outcome, i) => (
              <label key={outcome.value} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="outcomeType"
                  value={outcome.value}
                  defaultChecked={i === 0}
                  required
                  className="accent-[var(--color-accent)]"
                />
                {outcome.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 border-0 p-0 m-0">
          <legend className="sr-only">Where you are starting from</legend>
          <Title>Where are you starting?</Title>
          <Meta>
            This sets your expectations, not ours. It never moves your record —
            only work we can actually check does that.
          </Meta>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {LEVELS.map((level, i) => (
              <label key={level.value} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="statedLevel"
                  value={level.value}
                  defaultChecked={i === 0}
                  required
                  className="accent-[var(--color-accent)]"
                />
                {level.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-8">
          <div className={field}>
            <label htmlFor="weeklyHours">
              <Title>Hours a week</Title>
            </label>
            <input
              id="weeklyHours"
              name="weeklyHours"
              type="number"
              min={0.5}
              max={40}
              step={0.5}
              defaultValue={3}
              required
              className={`${input} w-32`}
            />
          </div>

          <div className={field}>
            <label htmlFor="deadline">
              <Title>Deadline</Title>
            </label>
            <Meta>Optional. A real date changes what gets cut.</Meta>
            <input id="deadline" name="deadline" type="date" className={input} />
          </div>
        </div>

        <div className={field}>
          <label htmlFor="motivation">
            <Title>Why now?</Title>
          </label>
          <Meta>Optional.</Meta>
          <input
            id="motivation"
            name="motivation"
            maxLength={500}
            className={input}
          />
        </div>

        <Card>
          <Meta>
            Nothing you say about yourself here counts as evidence. Your record
            starts empty and fills up with work that was actually checked.
          </Meta>
        </Card>

        <div>
          <Button type="submit">Build my plan</Button>
        </div>
      </form>
    </main>
  );
}
