import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { entitlementsForUser } from "@/lib/billing/store";
import { MAX_TURNS, turnsTaken } from "@/lib/goals/analyzer";
import { matchChosen } from "@/lib/goals/match";
import {
  displayDeadline,
  displayHours,
  displayLevel,
} from "@/lib/goals/captured-display";
import { LATEST } from "@/lib/goals/anchors";
import { customPathHref } from "@/lib/goals/custom-path";
import {
  PACK_FIELD,
  projectStartHref,
  projectStartSeed,
} from "@/lib/goals/project-start";
import { findProject } from "@/lib/content";
import { resolvePack } from "@/lib/content/resolve";
import { slugify } from "@/lib/packs/generate/derive";
import { withDestination } from "@/lib/account/next-url";
import { loadIntake } from "@/lib/goals/intake-store";
import {
  Button,
  ButtonLink,
  Card,
  cx,
  Meta,
  Status,
  Title,
  stagger,
} from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import {
  buildFromConversationAction,
  openAction,
  replyAction,
  restartAction,
  startFreshAction,
} from "./actions";
import { LEARNER_BUBBLE, ANALYZER_BUBBLE } from "./bubbles";
import { Composer } from "./composer";

/**
 * §8 screen 3 — goal creation, as the conversation the plan always described.
 *
 * "Chat, one question at a time, with **smart chips** for common answers so most
 * replies are one tap. Live-updating sidebar showing what's been captured."
 *
 * Every turn is a form POST that redirects back here, so the screen is a pure
 * function of the stored conversation and a refresh re-reads it rather than
 * re-sending an answer. The chips are submit buttons carrying their own value,
 * which is what makes "one tap" work without a bundle.
 *
 * That much still holds with scripting off. What is no longer true is "no
 * client JavaScript at all": `Composer` is a client component, because the
 * analyzer takes seconds and a screen that shows nothing for those seconds
 * reads as broken — it was reported as exactly that. It enhances the same
 * forms rather than replacing them, so the no-scripting path is unchanged.
 */
export const metadata: Metadata = {
  title: "Set a goal",
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ error?: string; topic?: string; project?: string }>;
};

/**
 * How much of a seeded topic is carried in. Matches `MAX_REPLY` in the action,
 * which does the same slice again — this one is only so the screen never echoes
 * back more than it is going to send.
 */
const MAX_TOPIC = 500;

/**
 * Every way this screen can hand somebody back to itself, said in full.
 *
 * `ReactNode` rather than `string` for one of them, and that one is why this
 * comment exists. `generated` used to have no entry at all, so pressing "Build
 * my plan" on a subject we do not cover bounced to `?error=generated` and fell
 * through to the `subject` fallback — the screen said we could not work out
 * what you wanted to learn, about a subject it had just spent five questions
 * establishing. The truthful version is that we understood perfectly and the
 * plan does not include building it, which is only useful said next to the way
 * out of it.
 */
const ERRORS: Record<string, React.ReactNode> = {
  analyzer: "That didn't go through. Try saying it again.",
  subject: "We couldn't work out what you wanted to learn. Try again?",
  busy: "You already have a course being built. Give that one a moment.",
  generated: (
    <>
      Building a course we don&rsquo;t already run isn&rsquo;t part of your
      plan. Nothing you answered is lost — it is all still here.{" "}
      <Link href="/pricing" className="underline underline-offset-4">
        See which plans include it
      </Link>
      .
    </>
  ),
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

const OUTCOMES: Record<string, string> = {
  career: "Work",
  project: "Something to make",
  exam: "An exam",
  personal: "For myself",
  curiosity: "Curiosity",
};

export default async function StartPage({ searchParams }: Props) {
  const { error, topic, project } = await searchParams;

  /*
   * The brief they pressed the button on, or nothing.
   *
   * Resolved before anything else is decided, because a slug that resolves is
   * the strongest instruction this screen can receive — it names one pack and
   * one project — and a slug that does not resolve must leave no trace at all.
   * Nothing a visitor can put in the query string reaches the page through
   * here: it is either a project we publish or it is `undefined`.
   */
  const brief = project ? findProject(project) : undefined;

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) {
    // The typed subject comes back with them. Without this, someone who asked
    // us to build a subject signs in and is asked what they want all over
    // again — on the one screen whose whole job is not to lose that answer.
    //
    // The brief comes back with them for the same reason and it is the more
    // expensive one to drop: they read a rubric end to end before pressing the
    // button, and landing on a bare intake afterwards throws all of that away.
    redirect(
      withDestination(
        "/sign-in",
        brief ? projectStartHref(brief.slug) : customPathHref(topic ?? ""),
      ),
    );
  }
  const intake = await loadIntake(getDb(), session.user.id);
  const captured = intake.captured;
  const asked = turnsTaken(intake.messages);

  /*
   * What they typed into the search box on the way here (`/learn` offers this
   * when nothing covers their subject). It opens the conversation as their
   * first message rather than sitting in a hidden field: the analyzer's first
   * question then answers what they said instead of asking it back at them.
   */
  const seed = (topic ?? "").trim().slice(0, MAX_TOPIC);
  const started = intake.messages.length > 0;

  /*
   * The course they arrived having already chosen, if they did.
   *
   * A brief names its own; a typed subject names one only when it happens to be
   * a course we run — which is the same test `matchSubject` applies at the very
   * end, moved to the front where it costs a lookup instead of a model call. A
   * subject that resolves to nothing is left alone: that is the case §7.1's
   * Generated tier exists for, and the conversation is what decides it.
   */
  const chosen = brief
    ? brief.topicSlug
    : seed.length > 0
      ? (await resolvePack(getDb(), slugify(seed)))?.slug
      : undefined;

  /** The subject of the conversation already in progress, if there is one. */
  const heldSubject = captured?.subject ?? null;

  /*
   * Whether pressing "Build my plan" is going to work — asked before it is
   * pressed rather than after.
   *
   * `buildFromConversationAction` makes exactly this decision and, on a plan
   * without generated packs, answers it with a redirect back to this screen. A
   * banner is the right thing to say once somebody has been stopped; it is the
   * wrong thing to be the *first* mention of a limit, after five questions
   * answered on a screen headed "Anything — if we don't already cover it, we'll
   * build it". That promise is true of the product and not of every plan, and
   * the honest place to say which is above the button.
   *
   * Both lookups are behind `intake.done`, so nothing is spent on this until
   * the conversation has actually closed and the button exists. The decision
   * itself is `matchChosen`'s, the same call the action makes, so the screen
   * and the button cannot disagree about whether this subject is a gap.
   */
  const gap =
    intake.done && captured
      ? await matchChosen(getDb(), captured, intake.packSlug)
      : undefined;
  /*
   * The subject we would have to author, and nothing when there is none.
   *
   * Carried as the subject rather than as a boolean because that is the one
   * place it is guaranteed to be a real name: `matchSubject` returns a gap with
   * a non-empty slug only for a subject that survived a trim, so the copy below
   * cannot be handed an empty string or a null. Reading `captured.subject` for
   * the same sentence would need a fallback for a case that cannot happen.
   */
  const unbuilt =
    gap?.kind === "gap" && gap.slug.length > 0 ? gap.subject : undefined;
  const canBuild =
    unbuilt === undefined ||
    (await entitlementsForUser(getDb(), session.user.id, undefined))
      .entitlements.generatedPacks;

  /*
   * A brief takes the screen.
   *
   * This is the bug that shipped. A project click arrived as `?topic=<a whole
   * sentence>`, which is the parameter a *search box* fills, so the conversation
   * below treated it exactly like a vague query: an unfinished chat about
   * something else rendered in full, with the brief reduced to one line inside a
   * collision card — and the card asked whether you wanted to start on
   * `I want to learn SQL so I can do the “…” project.`, because the wording it
   * interpolates is meant to be a subject name.
   *
   * Worse, and quieter: the seed only ever became a first message when there was
   * no conversation at all. Anyone with an abandoned chat got their brief
   * dropped on the floor and their old answers shown instead.
   *
   * So a resolved brief returns here instead of falling through. The reader
   * chose one specific piece of work and read its rubric to the end; the screen
   * that follows is about that, and nothing else is drawn on it.
   *
   * The old conversation is not deleted on the way in. Clearing is a `POST`
   * below, because `Link` prefetches this route — a `GET` that threw away an
   * unfinished intake would do it to people who only hovered.
   */
  if (brief) {
    return (
      <AppFrame>
        {/*
         * The course, not the brief.
         *
         * This screen used to be headed `Start “Sales dashboard”`, which reads
         * as an offer to do one piece of work — and a project is not a thing
         * you can do on its own here. Every brief belongs to exactly one
         * course, is marked against that course's rubric, and proves that
         * course's skills; pressing this button enrols you in the whole thing.
         * Saying so at the top is the honest version, and it is also the
         * bigger offer: a reader who came for one brief is being handed the
         * path that gets them to it.
         */}
        <AppHeader
          title={`Start the ${brief.topicName} course`}
          lead={`“${brief.title}” is one of its graded briefs, and it is what you hand in at the end — marked against the checklist you have already read. The course is how you get there: every skill that brief needs, in the order they build on each other, starting from wherever you already are.`}
        />

        {error ? (
          <Status tone="problem">{ERRORS[error] ?? ERRORS.subject}</Status>
        ) : null}

        <Card className="rise flex flex-col items-start gap-5" style={stagger(1)}>
          <Title>What we still need</Title>
          <Meta>
            No more than {MAX_TURNS} questions, and you can skip any of them.
            The subject is settled — you chose it. What we ask about is you:
            what you want to do with {brief.topicName}, where you are starting
            from, and how many hours a week you actually have.
          </Meta>
          {/* Through `startFreshAction`, which clears any held conversation and
              then posts this as the opening line. Both halves matter: without
              the clear the analyzer answers the old chat, and without the reply
              the brief is not in the conversation at all. */}
          <form action={startFreshAction}>
            <input
              type="hidden"
              name="reply"
              value={projectStartSeed(brief.title, brief.topicName)}
            />
            {/* So a failed opening turn comes back here rather than to a bare
                intake. The action cannot recover the brief from the reply — by
                then it is prose — and this is the only place that still has the
                slug. */}
            <input type="hidden" name="project" value={brief.slug} />
            {/* The course itself, so the conversation is bound to it from the
                first turn instead of having to recognise it back out of that
                sentence at the end. */}
            <input type="hidden" name={PACK_FIELD} value={brief.topicSlug} />
            <Button type="submit">
              Start the {brief.topicName} course
            </Button>
          </form>
        </Card>

        {started ? (
          <Meta tone="muted">
            {heldSubject
              ? `You still have a conversation going about ${heldSubject}.`
              : "You still have a conversation going about something else."}{" "}
            Starting here puts it aside — nothing has been built from it yet, so
            it costs you a plan you never had, but the answers go.{" "}
            <Link href="/start" className="underline underline-offset-4">
              {heldSubject ? `Carry on with ${heldSubject}` : "Carry on with it"}
            </Link>{" "}
            instead.
          </Meta>
        ) : null}
      </AppFrame>
    );
  }

  /*
   * They arrived asking for one subject and there is already a conversation
   * about another. The screen used to render the old one and say nothing —
   * `/start?topic=javascript` showed a half-finished conversation about
   * Japanese, which reads as the product having invented both the subject and
   * the answers.
   *
   * Compared loosely because the stored subject is the analyzer's wording and
   * the topic is theirs: "JavaScript" and "javascript" are not two subjects.
   *
   * This only ever sees a *subject*, which is the invariant the project offer
   * broke by routing a whole sentence through `?topic=`: no sentence equals a
   * stored subject, so every such arrival collided.
   */
  const collides =
    seed.length > 0 &&
    started &&
    heldSubject?.trim().toLowerCase() !== seed.toLowerCase();

  return (
    /* §8.5.9 — a task screen, but on the shared frame like every other one.
       It used to hand-roll a `max-w-4xl` main, which made it the third column
       width in the product and put its title at a different height from the
       screens on either side of it. `flush` is the one thing it genuinely
       needs that the others do not: the composer is pinned to the bottom of
       the viewport, so the frame gives up its bottom padding.

       Only while the composer is actually there. Once the conversation is done
       it is replaced by the "Build my plan" card, which is in normal flow — and
       a frame with no bottom padding puts that button under the fixed mobile
       nav, on the one screen where the button is the entire point. */
    <AppFrame flush={started && !intake.done}>
      {started ? (
        /*
         * The headline has done its job by now — it asked a question that has
         * four answers above it. Kept as the h1 because the screen still needs
         * one, at a size that no longer competes with the conversation.
         */
        <h1 className="text-[length:var(--text-label-size)] font-[650] text-ink-muted">
          What do you want to get good at?
        </h1>
      ) : (
        <AppHeader
          title="What do you want to get good at?"
          lead="Tell us in your own words. Anything — if we don’t already cover it, we’ll build it."
        />
      )}

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
              {seed ? (
                <>
                  <Meta tone="muted">
                    Starting from what you asked for:{" "}
                    <span className="font-[550] text-ink">
                      &ldquo;{seed}&rdquo;
                    </span>
                  </Meta>
                  {/* The seed goes through `replyAction`, which is already the
                      "the learner said something" path — an empty conversation
                      plus one message is exactly what it expects. */}
                  <form action={replyAction}>
                    <input type="hidden" name="reply" value={seed} />
                    {/* Only when what they typed is a course we run. A subject
                        we do not have has no slug to carry, and the whole point
                        of this screen is that it takes those too. */}
                    {chosen ? (
                      <input type="hidden" name={PACK_FIELD} value={chosen} />
                    ) : null}
                    <Button type="submit">Start</Button>
                  </form>
                </>
              ) : (
                <form action={openAction}>
                  <Button type="submit">Start</Button>
                </form>
              )}
            </Card>
          ) : (
            <>
              {collides ? (
                <Card className="flex flex-col items-start gap-4">
                  <Title>Start on &ldquo;{seed}&rdquo;?</Title>
                  <Meta>
                    {heldSubject
                      ? `You still have a conversation going about ${heldSubject}.`
                      : "You still have a conversation going about something else."}{" "}
                    Nothing has been built from it yet, so putting it aside
                    costs you a plan you never had — but the answers below go.
                  </Meta>
                  <div className="flex flex-wrap items-center gap-5">
                    <form action={startFreshAction}>
                      <input type="hidden" name="reply" value={seed} />
                      {chosen ? (
                        <input type="hidden" name={PACK_FIELD} value={chosen} />
                      ) : null}
                      <Button type="submit">Start on &ldquo;{seed}&rdquo;</Button>
                    </form>
                    <Link
                      href="/start"
                      className="text-[length:var(--text-label-size)] text-ink-muted underline underline-offset-4 hover:text-ink"
                    >
                      {heldSubject
                        ? `Carry on with ${heldSubject}`
                        : "Carry on where I was"}
                    </Link>
                  </div>
                </Card>
              ) : null}

              <ol className="flex list-none flex-col gap-4 p-0 m-0">
                {intake.messages.map((message, i) => (
                  <li
                    key={i}
                    /*
                     * Every turn redirects to #latest so the browser opens the
                     * page on the newest question. Without it the composer,
                     * now pinned to the bottom, covers the very question its
                     * chips are answering — the screen loads showing four
                     * answers to something you cannot read.
                     */
                    id={i === intake.messages.length - 1 ? LATEST : undefined}
                    className={cx(
                      "scroll-mt-8",
                      message.r === "l" ? LEARNER_BUBBLE : ANALYZER_BUBBLE,
                    )}
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
                  {/*
                   * The wall, where it can still be acted on.
                   *
                   * Not `UpgradeNudge`: that component is for a limit hit
                   * *beside* something that still works — a lesson that reads
                   * without the tutor, a plan that exists without a new
                   * session. Here the limit is standing on the only button on
                   * the screen, and the button has to say so rather than sit
                   * next to something that does.
                   *
                   * `startFreshAction` is not offered as the way out. The
                   * subject is the thing they asked for; suggesting they pick
                   * a different one to get past a price is the sort of nudge
                   * §7.2 exists to keep out of this product.
                   */}
                  {canBuild ? (
                    <form action={buildFromConversationAction}>
                      <Button type="submit">Build my plan</Button>
                    </form>
                  ) : (
                    <>
                      <Title>We don&rsquo;t run {unbuilt} yet</Title>
                      <Meta>
                        We can build the whole course for it — the skills, the
                        order they go in, and the graded briefs at the end —
                        but that isn&rsquo;t part of your plan. Your answers
                        stay here either way, and the button comes back the
                        moment your plan covers it.
                      </Meta>
                      <ButtonLink href="/pricing" variant="text">
                        See which plans include it
                      </ButtonLink>
                    </>
                  )}
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
                /*
                 * Pinned to the bottom of the viewport, and the one part of
                 * this screen that takes client JavaScript.
                 *
                 * Two problems, one place. In normal flow the answer box was
                 * the thing needed on every turn and the thing that had
                 * scrolled off the bottom. And with no scripting at all there
                 * was nothing to see for the several seconds the analyzer
                 * takes, so a sent answer read as a frozen page.
                 *
                 * Keyed by the turn count so the optimistic echo inside it is
                 * dropped the moment the real turn arrives above.
                 */
                <Composer
                  key={intake.messages.length}
                  chips={intake.chips}
                  asked={asked}
                  maxTurns={MAX_TURNS}
                  reply={replyAction}
                  restart={restartAction}
                />
              )}
            </>
          )}
        </div>

        {/* ── What we have so far ──────────────────────────────────────────── */}
        {/* Follows the conversation down rather than scrolling away from it —
            a running summary is only worth the column if it is still on screen
            when the answer it summarises is being typed. */}
        <Card
          className="rise w-full md:sticky md:top-8 md:w-72 md:shrink-0"
          style={stagger(2)}
        >
          <div className="flex flex-col">
            <Title className="pb-3 text-[length:var(--text-label-size)]">
              What we have so far
            </Title>
            <Captured label="Subject" value={captured?.subject ?? null} />
            {/* Their words first, ours only when they never said it — see
                captured-display.ts for what this card got wrong before. */}
            <Captured label="Level" value={displayLevel(captured)} />
            <Captured label="Time" value={displayHours(captured)} />
            <Captured label="Deadline" value={displayDeadline(captured)} />
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

      {/*
       * Only before the conversation starts, for two reasons. Offering the
       * form to someone four questions in is offering to throw away the four
       * answers. And anything rendered after the composer extends the page
       * past it, so scrolling to the end left the bar floating mid-screen with
       * a strip of dead page underneath — the composer stops feeling pinned
       * exactly when you have scrolled to reach it.
       */}
      {started ? null : (
        <Meta tone="muted">
          Would rather fill in a form?{" "}
          <Link href="/start/form" className="underline underline-offset-4">
            Do that instead
          </Link>
          .
        </Meta>
      )}
    </AppFrame>
  );
}
