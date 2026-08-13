import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { MAX_TURNS, turnsTaken } from "@/lib/goals/analyzer";
import { loadIntake } from "@/lib/goals/intake-store";
import {
  Button,
  Card,
  DisplayTitle,
  Lead,
  Meta,
  Status,
  Title,
  stagger,
} from "@/components/ui";
import {
  buildFromConversationAction,
  openAction,
  replyAction,
  restartAction,
} from "./actions";

/**
 * §8 screen 3 — goal creation, as the conversation the plan always described.
 *
 * "Chat, one question at a time, with **smart chips** for common answers so most
 * replies are one tap. Live-updating sidebar showing what's been captured."
 *
 * No client JavaScript. Every turn is a form POST that redirects back here, so
 * the screen is a pure function of the stored conversation and a refresh
 * re-reads it rather than re-sending an answer. The chips are submit buttons
 * carrying their own value, which is what makes "one tap" work without a bundle.
 */
export const metadata: Metadata = {
  title: "Set a goal",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ error?: string }> };

const ERRORS: Record<string, string> = {
  analyzer: "That didn't go through. Try saying it again.",
  subject: "We couldn't work out what you wanted to learn. Try again?",
  busy: "You already have a course being built. Give that one a moment.",
};

/** One captured field in the sidebar. Absent fields say so rather than hide. */
function Captured({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-hairline py-2.5 first:border-t-0">
      <Meta tone="muted">{label}</Meta>
      <span
        className={
          value === null
            ? "text-[length:var(--text-label-size)] text-ink-faint"
            : "text-[length:var(--text-label-size)] font-[550] text-ink text-right"
        }
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

const LEVELS: Record<string, string> = {
  none: "Never done it",
  beginner: "Dabbled a bit",
  intermediate: "Can do the basics",
  advanced: "Experienced",
};

const OUTCOMES: Record<string, string> = {
  career: "Work",
  project: "Something to make",
  exam: "An exam",
  personal: "For myself",
  curiosity: "Curiosity",
};

export default async function StartPage({ searchParams }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { error } = await searchParams;
  const intake = await loadIntake(getDb(), session.user.id);
  const captured = intake.captured;
  const asked = turnsTaken(intake.messages);

  const input =
    "min-h-[var(--touch-min)] w-full rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-ink placeholder:text-ink-faint focus:border-accent transition-colors duration-[var(--dur-fast)]";

  return (
    /* §8.5.9 — a task screen. The sidebar earns the wider column here because
       it is the thing that makes the conversation feel like progress rather
       than a chat window; it stacks below on narrow screens. */
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-16">
      <div className="rise flex flex-col gap-5">
        <DisplayTitle>What do you want to get good at?</DisplayTitle>
        <Lead>
          Tell us in your own words. Anything — if we don&rsquo;t already cover
          it, we&rsquo;ll build it.
        </Lead>
      </div>

      {error ? <Status tone="problem">{ERRORS[error] ?? ERRORS.subject}</Status> : null}

      <div className="flex flex-col gap-8 md:flex-row md:items-start">
        {/* ── The conversation ─────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {intake.messages.length === 0 ? (
            <Card className="rise flex flex-col items-start gap-4" style={stagger(1)}>
              <Title>Let&rsquo;s work out what you need</Title>
              <Meta>
                A few questions — no more than {MAX_TURNS}. You can skip any of
                them.
              </Meta>
              <form action={openAction}>
                <Button type="submit">Start</Button>
              </form>
            </Card>
          ) : (
            <>
              <ol className="flex list-none flex-col gap-4 p-0 m-0">
                {intake.messages.map((message, i) => (
                  <li
                    key={i}
                    className={
                      message.r === "l"
                        ? "self-end max-w-[85%] rounded-[var(--radius-card)] bg-accent-weak px-5 py-3.5"
                        : "self-start max-w-[90%] rounded-[var(--radius-card)] border border-hairline px-5 py-3.5"
                    }
                  >
                    <span className="sr-only">
                      {message.r === "l" ? "You said" : "We asked"}:{" "}
                    </span>
                    {message.t}
                  </li>
                ))}
              </ol>

              {intake.done ? (
                <Card className="flex flex-col items-start gap-4">
                  <form action={buildFromConversationAction}>
                    <Button type="submit">Build my plan</Button>
                  </form>
                  <form action={restartAction}>
                    <button
                      type="submit"
                      className="text-[length:var(--text-meta-size)] text-ink-faint underline underline-offset-4 hover:text-ink"
                    >
                      Start over
                    </button>
                  </form>
                </Card>
              ) : (
                <>
                  {/* Chips are submit buttons carrying their own answer, which
                      is how one tap works with no JavaScript at all. */}
                  {intake.chips.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {intake.chips.map((chip) => (
                        <form action={replyAction} key={chip}>
                          <input type="hidden" name="reply" value={chip} />
                          <button
                            type="submit"
                            className="min-h-[var(--touch-min)] rounded-[var(--radius-control)] border border-hairline bg-ground px-4 text-[length:var(--text-label-size)] transition-colors duration-[var(--dur-fast)] hover:border-accent hover:bg-accent-weak"
                          >
                            {chip}
                          </button>
                        </form>
                      ))}
                    </div>
                  ) : null}

                  <form action={replyAction} className="flex flex-col gap-3">
                    <label htmlFor="reply" className="sr-only">
                      Your answer
                    </label>
                    <input
                      id="reply"
                      name="reply"
                      maxLength={500}
                      required
                      autoComplete="off"
                      placeholder="Type your answer…"
                      className={input}
                    />
                    <div className="flex items-center gap-4">
                      <Button type="submit">Send</Button>
                      <Meta tone="muted">
                        {asked} of {MAX_TURNS} questions
                      </Meta>
                    </div>
                  </form>

                  <form action={restartAction}>
                    <button
                      type="submit"
                      className="self-start text-[length:var(--text-meta-size)] text-ink-faint underline underline-offset-4 hover:text-ink"
                    >
                      Start over
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </div>

        {/* ── What we have so far ──────────────────────────────────────────── */}
        <Card className="rise w-full md:w-72 md:shrink-0" style={stagger(2)}>
          <div className="flex flex-col">
            <Title className="pb-3 text-[length:var(--text-label-size)]">
              What we have so far
            </Title>
            <Captured label="Subject" value={captured?.subject ?? null} />
            <Captured
              label="Level"
              value={
                captured?.statedLevel ? LEVELS[captured.statedLevel]! : null
              }
            />
            <Captured
              label="Time"
              value={
                captured?.weeklyHours
                  ? `${captured.weeklyHours} hrs/week`
                  : null
              }
            />
            <Captured label="Deadline" value={captured?.deadline ?? null} />
            <Captured
              label="For"
              value={
                captured?.outcomeType ? OUTCOMES[captured.outcomeType]! : null
              }
            />
            {captured?.matchedPack ? (
              <div className="pt-4">
                <Status tone="verified">We cover this one already</Status>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Meta tone="muted">
        Would rather fill in a form?{" "}
        <Link href="/start/form" className="underline underline-offset-4">
          Do that instead
        </Link>
        .
      </Meta>
    </main>
  );
}
