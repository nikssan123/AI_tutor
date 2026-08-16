import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { intakeAccessFor } from "@/lib/billing/quota";
import { MAX_TURNS, turnsTaken } from "@/lib/goals/analyzer";
import {
  displayDeadline,
  displayHours,
  displayLevel,
} from "@/lib/goals/captured-display";
import { LATEST, READY } from "@/lib/goals/anchors";
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
import { goalsFor } from "@/lib/goals/store";
import {
  Button,
  ButtonLink,
  Card,
  cx,
  Lead,
  Meta,
  Signal,
  Status,
  Title,
  stagger,
} from "@/components/ui";
import { AppFrame, AppHeader } from "@/components/app-shell";
import {
  buildFromConversationAction,
  openAction,
  reopenAction,
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
 * Ties the build button to the sentence above it.
 *
 * The button is what a fragment lands on and what `autofocus` takes, so on
 * every arrival that matters it is announced *first* and on its own — "Build my
 * plan, button" — with the heading and the sentence that explain it never read
 * at all. Describing it puts them back in the announcement.
 */
const READY_LEAD = "ready-lead";

/**
 * Every way this screen can hand somebody back to itself, said in full.
 *
 * `ReactNode` rather than `string` for one of them, and that one is why this
 * comment exists. `generated` used to have no entry at all, so pressing "Build
 * my plan" on a subject we do not cover bounced to `?error=generated` and fell
 * through to the `subject` fallback — the screen said we could not work out
 * what you wanted to learn, about a subject it had just spent five questions
 * establishing. The truthful version is that we understood perfectly and there
 * is no build left on this account, which is only useful said next to the way
 * out of it.
 */
const ERRORS: Record<string, React.ReactNode> = {
  analyzer: "That didn't go through. Try saying it again.",
  subject: "We couldn't work out what you wanted to learn. Try again?",
  busy: "You already have a course being built. Give that one a moment.",
  generated: (
    <>
      You&rsquo;ve already had the one custom subject your plan builds. Nothing
      you answered is lost — it is all still here.{" "}
      <Link href="/pricing" className="underline underline-offset-4">
        See which plans build more
      </Link>
      .
    </>
  ),
  /*
   * A discard this plan does not include, refused at the door.
   *
   * Nobody should reach it from a screen — the offer is not rendered on a plan
   * that keeps one conversation — so this is what a direct POST is told, and it
   * says the thing that matters most: your answers are still here, and they are
   * still yours to change.
   */
  restart: (
    <>
      Your plan comes with one goal conversation, so this one stays — but
      nothing in it is settled. Change any answer and we&rsquo;ll take the new
      one.{" "}
      <Link href="/pricing" className="underline underline-offset-4">
        See which plans start another
      </Link>
      .
    </>
  ),
};

/**
 * What a free learner sees once their custom subject is spent.
 *
 * Two ways onward and neither is a dead end, which is the difference between a
 * paywall and a wall. The catalogue is still open to them — `/start/form`
 * resolves a pack we already have and creates a goal against it, with no model
 * call and nothing to meter — and the plans page says what the conversation
 * costs to keep.
 *
 * It does not say "upgrade to retry". A stopped build is not theirs to retry at
 * any price; it is the team's, and telling somebody money would fix a thing
 * money will not fix is the kind of sentence §4.2 law 3 exists to prevent.
 */
function IntakeClosed({ built }: { built: { id: string; name: string } | null }) {
  return (
    <AppFrame width="narrow">
      <AppHeader
        eyebrow="Set a goal"
        title="You&rsquo;ve had the custom subject your plan builds"
        lead="We built you a course for a subject nobody had curated. That is the one your plan includes, so this conversation is closed — but the catalogue is not."
      />
      {/*
        The course the sentence above is about, with a way into it.
        
        This screen named it and then offered the catalogue and a price list,
        which reads as a wall for somebody who has just been told they already
        have the thing. It is also where the "See my plan" button used to land
        anyone who pressed it twice — bounced off their own finished course by
        the control that exists to open it — so it is worth being the first
        thing here rather than a footnote.
      */}
      {built ? (
        <Card className="flex flex-col items-start gap-4">
          <Title>{built.name}</Title>
          <Meta>
            The one we built for you. Everything you answered went into it.
          </Meta>
          <ButtonLink href={`/goals/${built.id}/path`}>Open my course</ButtonLink>
        </Card>
      ) : null}
      <Card className="flex flex-col items-start gap-4">
        <Title>Start on something we already cover</Title>
        <Meta>
          Every subject in the catalogue is open to you, with the same plan, the
          same graded briefs and the same ledger.
        </Meta>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/start/form">Pick a subject</ButtonLink>
          <ButtonLink href="/learn" variant="text">
            See what we cover
          </ButtonLink>
        </div>
      </Card>
      <Card className="flex flex-col items-start gap-4">
        <Title>Or build another one</Title>
        <Meta>
          Paid plans keep the conversation open, so you can have a course built
          for any subject, as often as you want one.
        </Meta>
        <ButtonLink href="/pricing" variant="text">
          See the plans
        </ButtonLink>
      </Card>
    </AppFrame>
  );
}

/**
 * What a learner is shown when they arrive asking for one subject, already have
 * a conversation about another, and are on the plan that keeps one.
 *
 * The same card serves both doors — a typed subject and a project brief —
 * because from here they are the same event: something new was asked for, and
 * saying yes to it means the stored answers go. On a plan that includes that,
 * the screens offer it; on the plan that does not, this is the honest version.
 *
 * Two ways onward, and the first is the one that will actually help most people
 * standing here. A conversation that is still going is still theirs to change:
 * carrying on and saying they meant something else is a thing the analyzer
 * handles on the next turn, and it costs nothing. The pricing link is second
 * because it is the answer to the smaller question — "and if I really do want a
 * clean start?"
 */
function OneConversation({
  held,
  wanted,
}: {
  held: string | null;
  wanted: string;
}) {
  return (
    <Card className="flex flex-col items-start gap-4">
      <Title>You already have a conversation going</Title>
      <Meta>
        {held ? `It’s about ${held}.` : "It’s about something else."} Your plan
        comes with one, and starting on {wanted} would mean throwing those
        answers away.
      </Meta>
      <Meta tone="muted">
        Nothing you told us is settled, though — carry on and change any answer
        you gave.
      </Meta>
      <div className="flex flex-wrap items-center gap-5">
        <ButtonLink href="/start">
          {held ? `Carry on with ${held}` : "Carry on where I was"}
        </ButtonLink>
        <Link
          href="/pricing"
          className="text-[length:var(--text-label-size)] text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          See which plans start another
        </Link>
      </div>
    </Card>
  );
}

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
  /*
   * The door, and the whole screen turns on it.
   *
   * A free account gets one custom subject. Once it has commissioned one there
   * is nothing this conversation can do for them that does not cost money — a
   * turn is a model call, and the button at the end commissions a ~£1 build the
   * catalogue pays for — so it closes rather than running five questions to a
   * wall. Everything below is skipped: no intake read, no analyzer, no
   * `matchChosen`, no billing lookups.
   *
   * It is deliberately not a check on whether their build *worked*. A failure
   * is the team's to retry (`/admin/packs`); handing back a fresh conversation
   * would let a subject that cannot be built be re-commissioned indefinitely at
   * our expense.
   */
  const access = await intakeAccessFor(getDb(), session.user.id);
  if (!access.open) {
    /*
     * The course they were told they have, so the screen can point at it.
     *
     * Newest first out of `goalsFor`, and the newest is the one this wall is
     * about — a free account reaches here precisely because it spent its one
     * custom subject, so the most recent goal is that build. One indexed read,
     * and only on the closed path.
     */
    const [newest] = await goalsFor(getDb(), session.user.id);
    // The pack's own name rather than the spec's slug: `domain` is
    // `net-c`, and the course is called ".NET / C#".
    const builtPack = newest ? await resolvePack(getDb(), newest.packSlug) : null;
    return (
      <IntakeClosed
        built={
          newest && builtPack ? { id: newest.id, name: builtPack.name } : null
        }
      />
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
   * Whether any of this screen's offers that end in `clearIntake` may be made:
   * "Start over" in the composer, "Start over" under a finished conversation,
   * and starting on a subject or a brief they arrived holding.
   *
   * `started` is half the question and it is the half that is not about money.
   * A learner with nothing stored is not being offered a second conversation,
   * they are being offered their first — which is open to everybody, so their
   * plan never comes into it and the screens below must not consult it.
   */
  const mayRestart = started && access.mayRestart;

  /*
   * No "can you build this" check on this screen at all, and its absence is
   * the change.
   *
   * It used to run `matchChosen` on every render of a finished conversation —
   * the same call the action makes — purely to decide whether to put a wall
   * where the button goes. The question is asked at the door now: a free
   * account that has had its one custom subject never reaches this screen. So
   * by the time the button is on the page the learner is certainly allowed to
   * press it, and the screen is one database round-trip lighter for it.
   */

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

        {/*
         * The brief is still described above — the course, what it is marked
         * against, how you get there — because a reader who has just read a
         * rubric end to end should not be handed a wall where the page they
         * asked for was. What they cannot do is take it *now*, and the reason
         * is the conversation they already have rather than anything about this
         * course.
         */}
        {started && !mayRestart ? (
          <OneConversation
            held={heldSubject}
            wanted={`the ${brief.topicName} course`}
          />
        ) : (
          <Card
            className="rise flex flex-col items-start gap-5"
            style={stagger(1)}
          >
            <Title>What we still need</Title>
            <Meta>
              No more than {MAX_TURNS} questions, and you can skip any of them.
              The subject is settled — you chose it. What we ask about is you:
              what you want to do with {brief.topicName}, where you are
              starting from, and how many hours a week you actually have.
            </Meta>
            {/* Through `startFreshAction`, which clears any held conversation
                and then posts this as the opening line. Both halves matter:
                without the clear the analyzer answers the old chat, and without
                the reply the brief is not in the conversation at all. */}
            <form action={startFreshAction}>
              <input
                type="hidden"
                name="reply"
                value={projectStartSeed(brief.title, brief.topicName)}
              />
              {/* So a failed opening turn comes back here rather than to a bare
                  intake. The action cannot recover the brief from the reply —
                  by then it is prose — and this is the only place that still
                  has the slug. */}
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
        )}

        {/* Only next to the offer it qualifies. The card above already says all
            of this when the offer is not there to make. */}
        {started && mayRestart ? (
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
              {!collides ? null : !mayRestart ? (
                <OneConversation held={heldSubject} wanted={`“${seed}”`} />
              ) : (
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
              )}

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
                /*
                 * The end of the conversation, drawn as the one thing left to
                 * do rather than as a button after some chat.
                 *
                 * It used to be a plain `Card` holding a bare "Build my plan" —
                 * the same surface, the same weight and the same white as every
                 * message above it, at the bottom of a scroll six exchanges
                 * long. `Signal` is the component for exactly this: something
                 * unfinished, waiting on the learner, marked with a rule down
                 * its edge so it cannot be read as one more bubble. It is the
                 * shape `/today` already uses to say a plan was left ready, so
                 * the offer looks the same on the screen that points here and
                 * on the screen it points at.
                 *
                 * `startFreshAction` is not offered as the way out. The subject
                 * is the thing they asked for; suggesting they pick a different
                 * one to get past a price is the sort of nudge §7.2 exists to
                 * keep out of this product.
                 *
                 * Under it, the two things that are still true of a finished
                 * conversation. Changing an answer is offered to everybody and
                 * is the one most people standing here want — a conversation
                 * closes as soon as the analyzer has enough, which is often one
                 * sentence after the thing you wish you had said differently.
                 * Throwing the whole conversation away is the other, and it is
                 * only on the plans that include it.
                 */
                <div className="flex flex-col items-start gap-4">
                  <Signal
                    className="rise w-full"
                    style={stagger(1)}
                    /* Ready, not at risk: nothing has gone wrong and nothing is
                       owed. The same tone `/today` gives this same offer. */
                    tone="verified"
                    state="Waiting on you"
                    title="Your plan is ready to build"
                    action={
                      <form action={buildFromConversationAction}>
                        <Button
                          type="submit"
                          /*
                           * The landing spot, and it is the button rather than
                           * the card because a fragment only *focuses* a target
                           * that can hold focus — see `anchors.ts`. `autoFocus`
                           * covers the client-side arrival, where no fragment is
                           * ever processed.
                           */
                          id={READY}
                          autoFocus
                          /* Enough room above it for the card it belongs to.
                             Landing with the button flush to the top edge shows
                             a control and none of the sentence explaining it. */
                          className="scroll-mt-48"
                          aria-describedby={READY_LEAD}
                        >
                          Build my plan
                        </Button>
                      </form>
                    }
                  >
                    <Lead id={READY_LEAD}>
                      {captured?.subject
                        ? `Nothing more to answer about ${captured.subject}.`
                        : "Nothing more to answer."}{" "}
                      We&rsquo;ll turn what you told us into a path — what to do
                      first, and what to skip because you can already do it.
                    </Lead>
                  </Signal>
                  <div className="flex flex-wrap items-center gap-5">
                    <form action={reopenAction}>
                      <button
                        type="submit"
                        className="text-[length:var(--text-meta-size)] text-ink-faint underline underline-offset-4 hover:text-ink"
                      >
                        Change an answer
                      </button>
                    </form>
                    {mayRestart ? (
                      <form action={restartAction}>
                        <button
                          type="submit"
                          className="text-[length:var(--text-meta-size)] text-ink-faint underline underline-offset-4 hover:text-ink"
                        >
                          Start over
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
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
                  restart={mayRestart ? restartAction : undefined}
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
