import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { allTopics } from "@/lib/content";
import { answeredTopics } from "@/lib/check/session";
import { CUSTOM_SUBJECT, MAX_CUSTOM_SUBJECT } from "@/lib/goals/intake";
import { SubjectIcon } from "@/components/icons";
import {
  Button,
  Card,
  Meta,
  stagger,
  Status,
} from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import { createGoalAction } from "../actions";

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

type Props = { searchParams: Promise<{ error?: string; subject?: string }> };

export default async function StartPage({ searchParams }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { error, subject } = await searchParams;
  const topics = allTopics();
  const jar = await cookies();

  /*
   * A subject they typed on a submission that came back with an error.
   *
   * The action puts it here rather than dropping it, so a form rejected over
   * the hours field does not also quietly swap the subject they asked for back
   * to the first one on the list. It also decides which row opens checked.
   */
  const typed = (subject ?? "").trim().slice(0, MAX_CUSTOM_SUBJECT);

  // A visitor who took a check before signing up should see that it counted for
  // something, on the screen where it starts counting (§24 E11). Shared with
  // `/subjects` and the no-goal `/today`, which make the same promise.
  const answered = answeredTopics(
    topics.map((t) => t.slug),
    (name) => jar.get(name)?.value,
  );

  const input =
    "min-h-[var(--touch-min)] rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-ink placeholder:text-ink-faint focus:border-accent transition-colors duration-[var(--dur-fast)]";

  /* A form field's name is a label, not a heading. Every one of these used to
     be a `Title` — 24px semibold — which turned a six-field form into a stack
     of section headings with inputs between them. */
  const fieldLabel =
    "text-[length:var(--text-label-size)] font-[650] text-ink";

  /* One radio in a wrapping row. Repeated for outcome and level, which are the
     same control asking about different things. */
  const choice = (
    name: string,
    options: ReadonlyArray<{ value: string; label: string }>,
  ) => (
    <div className="flex flex-wrap gap-2">
      {options.map((option, i) => (
        <label
          key={option.value}
          className="flex min-h-[var(--touch-min)] cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-[length:var(--text-label-size)] transition-colors duration-[var(--dur-fast)] hover:border-accent has-checked:border-accent has-checked:bg-accent-weak"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={i === 0}
            required
            className="accent-[var(--color-accent)]"
          />
          {option.label}
        </label>
      ))}
    </div>
  );

  return (
    /* §8.5.9 — a task screen, so it keeps the narrow column. A goal form read
       across 1024px would be worse, not better. */
    <AppFrame width="narrow">
      <AppHeader
        title="What do you want to get good at?"
        lead="Pick a subject — or name one we don’t cover yet, and we’ll write it — and tell us how much time you actually have. We’ll work out what to do first, and what to skip because you can already do it."
      />

      {error ? <Status tone="problem">{error}</Status> : null}

      <form action={createGoalAction} className="flex flex-col gap-6">
        {/* ── Subject ──────────────────────────────────────────────────────── */}
        <Card className="rise flex flex-col gap-4 p-0" style={stagger(1)}>
          <fieldset className="flex flex-col gap-4 border-0 p-0 m-0">
            <legend className="sr-only">Subject</legend>
            <span className={`${fieldLabel} px-6 pt-6`}>Subject</span>
            <ul className="flex list-none flex-col gap-0 p-0 m-0">
              {topics.map((topic, i) => (
                <li
                  key={topic.slug}
                  className="border-t border-hairline last:rounded-b-[var(--radius-card)] last:overflow-hidden"
                >
                  <label className="flex min-h-[var(--touch-min)] cursor-pointer items-center gap-3 px-6 py-4 transition-colors duration-[var(--dur-fast)] hover:bg-accent-weak has-checked:bg-accent-weak">
                    <input
                      type="radio"
                      name="topic"
                      value={topic.slug}
                      defaultChecked={i === 0 && typed.length === 0}
                      required
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="text-accent">
                      <SubjectIcon taxonomyParent={topic.taxonomyParent} />
                    </span>
                    <span className="font-[550]">{topic.name}</span>
                    <span className="ml-auto flex items-center gap-3">
                      {answered.has(topic.slug) ? (
                        <Status tone="verified">Your check comes with you</Status>
                      ) : null}
                      {/* --ink-faint is under the small-text bar on the
                          accent-weak fill a checked row takes (§8.5.4). */}
                      <Meta tone="muted">{topic.skillCount} skills</Meta>
                    </span>
                  </label>
                </li>
              ))}

              {/*
                The subject we do not have, on the screen that used to end at
                the ones we do.

                §7.1's Generated tier is why the conversation accepts anything
                at all, and this form is that same intake with the model taken
                out — so a list of seven radios was quietly a different product:
                it told anyone whose subject was missing that we could not teach
                it, on the one screen that exists to take the answer.

                The box is revealed by its own radio, in CSS, so the no-script
                path is unchanged and the box can never be filled in for a
                subject that is not selected. The action does not trust that:
                it reads the field only when the radio names it.
              */}
              <li className="group border-t border-hairline last:rounded-b-[var(--radius-card)] last:overflow-hidden">
                <label className="flex min-h-[var(--touch-min)] cursor-pointer items-center gap-3 px-6 py-4 transition-colors duration-[var(--dur-fast)] hover:bg-accent-weak has-checked:bg-accent-weak">
                  <input
                    type="radio"
                    name="topic"
                    value={CUSTOM_SUBJECT}
                    defaultChecked={typed.length > 0}
                    required
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="text-accent">
                    {/* The neutral mark: we do not know what this is yet. */}
                    <SubjectIcon taxonomyParent={null} />
                  </span>
                  <span className="font-[550]">Something else</span>
                  <span className="ml-auto">
                    <Meta tone="muted">We&rsquo;ll write it</Meta>
                  </span>
                </label>

                <div className="hidden flex-col gap-2 px-6 pb-6 group-has-[:checked]:flex">
                  <label htmlFor="customSubject" className={fieldLabel}>
                    What do you want to learn?
                  </label>
                  <Meta>
                    Nobody has written this one for us, so we&rsquo;ll write it
                    first — the skills, the order they go in, and the graded
                    briefs at the end. It takes a few minutes, and you can close
                    the tab while it runs.
                  </Meta>
                  <input
                    id="customSubject"
                    name="customSubject"
                    maxLength={MAX_CUSTOM_SUBJECT}
                    defaultValue={typed}
                    placeholder="Rust, tarot, medieval Latin…"
                    className={input}
                  />
                </div>
              </li>
            </ul>
          </fieldset>
        </Card>

        {/* ── About the goal ───────────────────────────────────────────────── */}
        <Card className="rise flex flex-col gap-8" style={stagger(2)}>
          <div className="flex flex-col gap-2">
            <label htmlFor="rawGoal" className={fieldLabel}>
              In your own words
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
            <span className={fieldLabel}>What&rsquo;s it for?</span>
            {choice("outcomeType", OUTCOMES)}
          </fieldset>

          <fieldset className="flex flex-col gap-3 border-0 p-0 m-0">
            <legend className="sr-only">Where you are starting from</legend>
            <span className={fieldLabel}>Where are you starting?</span>
            <Meta>Just a starting point. The check adjusts it.</Meta>
            {choice("statedLevel", LEVELS)}
          </fieldset>
        </Card>

        {/* ── Time ─────────────────────────────────────────────────────────── */}
        <Card className="rise flex flex-col gap-8" style={stagger(3)}>
          <div className="flex flex-wrap gap-8">
            <div className="flex flex-col gap-2">
              <label htmlFor="weeklyHours" className={fieldLabel}>
                Hours a week
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

            <div className="flex flex-col gap-2">
              <label htmlFor="deadline" className={fieldLabel}>
                Deadline
              </label>
              <Meta>Optional. A real date changes what gets cut.</Meta>
              <input id="deadline" name="deadline" type="date" className={input} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="motivation" className={fieldLabel}>
              Why now?
            </label>
            <Meta>Optional.</Meta>
            <input
              id="motivation"
              name="motivation"
              maxLength={500}
              className={input}
            />
          </div>
        </Card>

        <div className="rise" style={stagger(5)}>
          <Button type="submit">Build my plan</Button>
        </div>
      </form>
    </AppFrame>
  );
}
