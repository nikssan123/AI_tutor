import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import { BUILD_TIMEOUT_MINUTES, findBuild } from "@/lib/packs/build";
import { TickIcon } from "@/components/icons";
import {
  Button,
  ButtonLink,
  cx,
  HeroBand,
  Meta,
  Row,
  RowList,
  Signal,
  stagger,
  Status,
  Title,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import { abandonBuildAction, adoptBuiltPackAction } from "../actions";
import {
  BUILD_STEPS,
  elapsedWords,
  SLOW_AFTER_MINUTES,
  stepStates,
  type StepState,
  TYPICAL_MAX_MINUTES,
  TYPICAL_MINUTES,
} from "./progress";

/**
 * The wait, while §7.1's Generated tier authors a subject nobody curated.
 *
 * Several minutes and several model calls, so this page's job is to be honest
 * about that rather than to look busy. It refreshes itself with a plain
 * `<meta>` tag — no polling script, no bundle, consistent with every other
 * screen here working without JavaScript.
 *
 * What it shows in that time is read from the build row, not invented here.
 * The screen used to say one thing for the whole wait — that it was still going
 * — which is the same thing a hung page says, and it was reported as one. Now
 * the pipeline writes the phase it has reached and this marks it off, so
 * "working" is a claim with evidence behind it. Nothing is timed, estimated or
 * filled in: a step is done because the build said so.
 *
 * The corollary is that the good news has to be worth something, which means
 * saying when it is bad news. A run that has outlived `BUILD_TIMEOUT_MINUTES`
 * is dead and is reported as dead, rather than showing "writing it now" until
 * the learner gives up on it.
 */
export const metadata: Metadata = {
  title: "Building your course",
  robots: { index: false, follow: false },
};

/** Long enough not to hammer the database, short enough to feel attended to. */
const REFRESH_SECONDS = 6;

type Props = { searchParams: Promise<{ subject?: string }> };

/** The disc at the head of a step: filled, ringed, or empty. */
const MARKER: Record<StepState, string> = {
  done: "bg-accent text-on-accent",
  running: "border-2 border-accent bg-accent-weak",
  waiting: "border border-hairline",
};

/**
 * What the marker means, for a reader who cannot see it.
 *
 * §8.5.5 bans colour as the sole carrier of meaning, and a tick against a
 * teal disc is exactly that. This is the same rule the `Status` dot follows by
 * always carrying its word.
 */
const SAID: Record<StepState, string> = {
  done: "Done: ",
  running: "Happening now: ",
  waiting: "Still to come: ",
};

const LABEL: Record<StepState, string> = {
  done: "text-ink font-[550]",
  running: "text-ink font-[650]",
  waiting: "text-ink-faint font-[550]",
};

export default async function BuildingPage({ searchParams }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { subject } = await searchParams;
  const slug = (subject ?? "").trim();
  if (slug.length === 0) redirect("/start");

  const db = getDb();

  // The pack existing is the real answer; the build row is only how we got
  // here. Checking the pack first means a build that finished between two
  // refreshes is picked up even if its row was never updated.
  const pack = await resolvePack(db, slug);
  const build = await findBuild(db, slug);

  if (pack) {
    return (
      /*
       * The default width, and content to earn it.
       *
       * This shipped `narrow` holding one `AppHeader` and nothing else: a
       * title, a sentence, a badge and a button, adrift in a 624px column with
       * ~350px of gutter either side — the exact fault `AppFrame` documents
       * `/account` having had. Widening an empty page would only have made the
       * emptiness wider, which is why the fix is what the page *says*, not what
       * it measures.
       *
       * And there was something to say. The lead asks them to "tell us when
       * something looks wrong" while showing them nothing to look at, which is
       * an unactionable request dressed as an invitation — the one moment a
       * learner can sanity-check a machine-written course is before they commit
       * to it, and this screen had them commit blind. The skills are the pack's
       * substance, we already have them, and a list of them is what makes both
       * the caveat and the column honest.
       */
      <AppFrame>
        <AppHeader
          eyebrow="Built for you"
          title={`${pack.name} is ready`}
          lead="Written for you just now, and nobody has reviewed it yet. Have a look at what it covers before you start — if something here looks wrong, tell us and we will fix it."
          facts={
            <>
              <Meta>
                {pack.skills.length} skills · {pack.items.length} questions
              </Meta>
              <Status tone="attention">Experimental — help us improve it</Status>
            </>
          }
          action={
            <form action={adoptBuiltPackAction}>
              <input type="hidden" name="slug" value={pack.slug} />
              <Button type="submit">See my plan</Button>
            </form>
          }
        />

        <SectionHead
          label="What it covers"
          title="The skills, in the order they build on each other"
        />
        {/* The pack's own order, not sorted here: it is a dependency order, and
            re-sorting it alphabetically would throw away the one piece of
            information the graph call was bought for. */}
        <RowList>
          {pack.skills.map((skill, i) => (
            <Row key={skill.slug} style={stagger(i)}>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-[550]">{skill.name}</span>
                <Meta>{skill.canDoStatement}</Meta>
              </span>
              <Status tone="neutral">{skill.level}</Status>
            </Row>
          ))}
        </RowList>
      </AppFrame>
    );
  }

  /*
   * No pack and no row: there is nothing to watch under this name.
   *
   * Reachable — `discardPack` takes the pack and its build row together, so a
   * learner sitting on this screen when an operator throws the pack out ends up
   * here — and the honest thing to do with it is say so. The alternative is
   * what this page did before: render "writing it now" forever about a build
   * that does not exist, refreshing every six seconds.
   */
  if (!build) {
    return (
      <AppFrame width="narrow">
        <AppHeader
          eyebrow="Nothing to watch"
          title="Nothing is being built under that name"
          lead="There is no course by this name and nothing running to make one. Tell us what you want to learn and we’ll pick it up from there."
          action={<ButtonLink href="/start">Tell us what you want</ButtonLink>}
        />
      </AppFrame>
    );
  }

  const now = new Date();
  const runningFor = now.getTime() - build.startedAt.getTime();
  const minutes = runningFor / 60_000;

  /*
   * A build the queue has lost, said out loud.
   *
   * `startBuild` already treats a row this old as dead and will let it be
   * claimed again — the same cut-off, from the same constant, so the screen and
   * the button cannot disagree about when a build has stopped being one. Until
   * this existed the wedged case had no screen of its own: the learner was told
   * their course was being written, every six seconds, indefinitely.
   */
  const stalled =
    build.status === "building" && minutes >= BUILD_TIMEOUT_MINUTES;

  if (build.status === "failed" || stalled) {
    // §4.2 law 3 — say what actually happened rather than "try again".
    const stopped = stalled
      ? {
          title: "This one stopped partway",
          detail: `It has been going ${elapsedWords(runningFor)} with nothing finished, which is far past the point where anything more is coming.`,
        }
      : {
          title: "We couldn’t build this one",
          detail: build.detail ?? "Something went wrong while building it.",
        };

    return (
      <AppFrame width="narrow">
        <AppHeader eyebrow="Stopped" title={stopped.title} lead={stopped.detail} />
        {/*
          No "Try again", and its absence is the point.

          A retry is four model calls and about a pound, and on the free tier it
          is the catalogue paying — so a button here asked the one person who
          cannot tell a bad subject from a bad afternoon to spend that money by
          guessing. It also made a failure the learner's problem to solve, when
          a build that stopped is ours.

          So the failure is routed to us instead, and *that* is the thing this
          screen has to make unmissable. It used to be a clause in the middle of
          a faint grey paragraph — the most reassuring fact available to
          somebody who has just been told their course does not exist, set in
          the smallest type on the page and sharing a sentence with two other
          ideas. A `Signal` instead: the one element in the product that carries
          a colour on its edge, which is exactly the weight "a person has this"
          deserves here. It is the only one on the screen, per its own rule.

          `verified` is the honest tone. The header above already carries the
          bad news; this card is the part that is genuinely handled, and a green
          edge under "With our team" says so faster than any sentence.
        */}
        <Signal
          tone="verified"
          state="With our team"
          title="A person is picking this up"
        >
          {/*
            Written to be true of a stalled build as well as a failed one.

            A row that failed was reported the moment it was written; one that
            stalled was never reported by anything, because nothing ran to
            report it — but both are on `/admin/packs`, and the list is what an
            operator actually works through. So the promise is the list, not the
            mail: it holds whichever way this build stopped, which "we have
            emailed the team" would not.
          */}
          <Meta>
            The subject you asked for is on our list, along with what happened
            to it, and somebody here takes it from there. There is nothing for
            you to report and nothing to try again — and nothing you answered
            is lost.
          </Meta>
        </Signal>
        {/* The offer, kept out of the card above: it is a different subject, not
            more reassurance about this one. */}
        <Meta>
          In the meantime you can start on a subject we already cover in depth.
        </Meta>
        <div className="flex flex-wrap gap-3">
          <form action={abandonBuildAction}>
            <Button type="submit">Pick something else</Button>
          </form>
          <ButtonLink href="/learn" variant="text">
            See what we cover
          </ButtonLink>
        </div>
      </AppFrame>
    );
  }

  const states = stepStates(build.stage);
  const at = states.indexOf("running");
  /** Null while the row is queued and nothing has picked it up yet. */
  const current = at === -1 ? null : BUILD_STEPS[at]!;

  return (
    /* `narrow`, and this is the exception §8.5.9 describes rather than a page
       choosing its own width: there is one object on this screen and you are
       watching it. A four-row list across `wide` would be four short rows and
       700px of gutter. */
    <AppFrame width="narrow">
      {/* No script: the page asks the browser to come back. */}
      <meta httpEquiv="refresh" content={String(REFRESH_SECONDS)} />

      <AppHeader
        eyebrow="Writing it now"
        title={`Building your ${build.subject} course`}
        lead={`Nobody had written ${build.subject} for us, so we’re writing it — the skills, what depends on what, and the questions that work out where you already are.`}
        facts={
          <>
            <Meta>Started {elapsedWords(runningFor)} ago</Meta>
            {/* A range, because the single figure it replaced was the best case
                presented as the only one — see `TYPICAL_MINUTES`. */}
            <Meta>
              Usually {TYPICAL_MINUTES}–{TYPICAL_MAX_MINUTES} minutes
            </Meta>
          </>
        }
      />

      {/*
       * Nothing here carries `rise` or `stagger`, and that is deliberate on
       * this one screen. The page reloads itself every six seconds, so a first
       * -render animation is a *re-render* animation to the person watching:
       * four rows fading up over and over for several minutes. §8.5.6 asks for
       * motion that means something, and the only thing moving here is the one
       * thing that is actually happening.
       */}
      <HeroBand
        field={
          <>
            <div className="flex flex-col gap-1.5">
              <Meta tone="muted">
                {current
                  ? `Step ${at + 1} of ${BUILD_STEPS.length}`
                  : "In the queue"}
              </Meta>
              <Title>{current ? current.title : "Starting in a moment"}</Title>
            </div>
            <Status tone={current ? "verified" : "neutral"}>
              {current ? "Running" : "Queued"}
            </Status>
          </>
        }
        footer={
          <>
            <Meta tone="muted">
              Nothing has failed. You can close this tab — it keeps building
              without you, and it will be here when you come back.
            </Meta>
            <Meta>Checks again every {REFRESH_SECONDS} seconds</Meta>
          </>
        }
      >
        <ol className="m-0 flex list-none flex-col p-0">
          {BUILD_STEPS.map((step, i) => {
            const state = states[i]!;

            return (
              <li key={step.stage} className="relative flex gap-4 pb-5 last:pb-0">
                {/* The thread between the markers, drawn behind them and
                    stopped short of the last one so the list ends rather than
                    trailing off. */}
                {i < BUILD_STEPS.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-7 bottom-0 left-3 w-px -translate-x-1/2 bg-hairline"
                  />
                ) : null}

                <span
                  className={cx(
                    "relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                    MARKER[state],
                  )}
                >
                  {state === "done" ? <TickIcon className="size-3.5" /> : null}
                  {/* The only moving thing on the screen, and it moves for as
                      long as the step does. Reduced motion stops it at one
                      cycle — see the global clamp in tokens.css. */}
                  {state === "running" ? (
                    <span
                      aria-hidden="true"
                      className="size-2 animate-pulse rounded-full bg-accent"
                    />
                  ) : null}
                </span>

                <div className="flex min-w-0 flex-col gap-1">
                  <span
                    className={cx(
                      "text-[length:var(--text-label-size)]",
                      LABEL[state],
                    )}
                  >
                    <span className="sr-only">{SAID[state]}</span>
                    {step.title}
                  </span>
                  <Meta>{step.note}</Meta>
                </div>
              </li>
            );
          })}
        </ol>

        {/*
         * Only once it is genuinely slow, and it explains rather than soothes.
         * The promise in the last clause is one this screen keeps: a run that
         * stops is reported as stopped, which is what the `stalled` branch
         * above is for.
         */}
        {minutes >= SLOW_AFTER_MINUTES ? (
          <Meta tone="muted">
            Past the usual {TYPICAL_MAX_MINUTES} minutes now — which is already
            a second attempt, so this one has been written twice and is taking
            its time on both. It has not failed, and if it ever does stop this
            page says so rather than leaving you here.
          </Meta>
        ) : null}
      </HeroBand>
    </AppFrame>
  );
}
