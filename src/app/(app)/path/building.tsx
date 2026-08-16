import {
  isRunning,
  PATH_BUILD_TIMEOUT_MINUTES,
  type PathBuild,
} from "@/lib/curriculum/build-state";
import { StepList } from "@/components/step-list";
import { SubmitButton } from "@/components/submit-button";
import {
  ButtonLink,
  Card,
  HeroBand,
  Meta,
  Status,
  Title,
} from "@/components/ui";
import { elapsedWords } from "../start/building/progress";
import { buildPathAction } from "./actions";
import { currentStep, PATH_BUILD_STEPS, pathStepStates } from "./progress";

/**
 * What to do next about your path — the offer, the wait, or what stopped it.
 *
 * One component rather than five branches scattered through the page, because
 * it is one question. The page around it is unchanged in all five states: the
 * whole subject is laid out below either way, and what moves is only whether
 * those areas have been re-cut into modules that each end in something you hand
 * in.
 *
 * **The wait is the reason this exists.** The build used to run inside the
 * server action the button posted to, and a server action posts over `fetch` —
 * so there was no navigation for the browser to spin, no row anywhere saying
 * work was under way, and nothing for a reload to find. The learner pressed
 * "Build my path" and watched an unchanged page for up to two model calls. Now
 * the action claims a row, the queue moves it through its phases, and this
 * reads it back.
 */

/**
 * Long enough not to hammer the database, short enough to feel attended to.
 *
 * The same interval `/start/building` refreshes at, and the same mechanism: a
 * `<meta>` tag rather than a polling script, so the screen that reports on a
 * background job needs no JavaScript to do it.
 */
const REFRESH_SECONDS = 5;

export function PathBuildState({
  build,
  hasPath,
  goalId,
  now = new Date(),
}: {
  /** Undefined when this goal has never been through the queue. */
  build: PathBuild | undefined;
  /** Whether a curriculum is already stored — a rebuild is not a first build. */
  hasPath: boolean;
  goalId: string;
  now?: Date;
}) {
  if (build && isRunning(build, now)) {
    const states = pathStepStates(build.stage);
    const at = currentStep(states);

    return (
      <HeroBand
        /* No `rise` or `stagger` anywhere in here, deliberately: the page
           reloads itself every few seconds, so a first-render animation is a
           re-render animation to the person watching. §8.5.6 asks for motion
           that means something, and the only thing that should be moving is the
           step that is actually happening. */
        field={
          <>
            <div className="flex flex-col gap-1.5">
              <Meta tone="muted">
                {at === null
                  ? "In the queue"
                  : `Step ${at + 1} of ${PATH_BUILD_STEPS.length}`}
              </Meta>
              <Title>
                {at === null
                  ? "Starting in a moment"
                  : PATH_BUILD_STEPS[at]!.title}
              </Title>
            </div>
            <Status tone={at === null ? "neutral" : "verified"}>
              {at === null ? "Queued" : "Running"}
            </Status>
          </>
        }
        footer={
          <>
            <Meta tone="muted">
              Nothing has failed. You can leave this page — it keeps building
              without you, and your path will be here when you come back.
            </Meta>
            <Meta>Checks again every {REFRESH_SECONDS} seconds</Meta>
          </>
        }
      >
        {/* The browser is asked to come back rather than a script asking for
            us. React hoists this into the head from wherever it is written. */}
        <meta httpEquiv="refresh" content={String(REFRESH_SECONDS)} />
        <StepList steps={PATH_BUILD_STEPS} states={states} />
        <Meta>Started {elapsedWords(now.getTime() - build.startedAt.getTime())} ago</Meta>
      </HeroBand>
    );
  }

  /*
   * Nothing to build, and it is not a failure.
   *
   * A learner who has already proved everything their course covers has
   * finished it, and "we couldn't build your path" would be the worst available
   * reading of the best available news. No retry either: pressing the button
   * again reaches the same conclusion at the same price. See `outcomeDetail`,
   * which writes the sentence at the moment the queue knows which case it is.
   */
  if (build?.status === "skipped") {
    return (
      <Card className="flex flex-col items-start gap-4">
        <Status tone="neutral">Nothing to build</Status>
        <Meta>{build.detail}</Meta>
      </Card>
    );
  }

  /*
   * A build that stopped, however it stopped.
   *
   * Two ways in, and the difference is worth saying out loud. A `failed` row
   * was written by something that knew what went wrong; a row still saying
   * `building` past the timeout was written by nothing at all — the worker died
   * without getting to the end — so all we can honestly report is that it has
   * been going far too long with nothing finished.
   *
   * Unlike a pack build, this one offers to try again. A pack is ~£1 of
   * authoring the learner cannot diagnose; this is their own course, the usual
   * cause is a queue that could not be reached, and a retry that never gets
   * past `planning` costs nothing at all.
   */
  if (build && build.status !== "ready") {
    const stalled = build.status === "building";

    return (
      <Card className="flex flex-col items-start gap-4">
        <Status tone="attention">Stopped</Status>
        <Meta>
          {stalled
            ? `It has been going ${elapsedWords(now.getTime() - build.startedAt.getTime())} with nothing finished, which is well past ${PATH_BUILD_TIMEOUT_MINUTES} minutes and past the point where anything more is coming.`
            : (build.detail ??
              "It stopped before it reached a path, and did not say why.")}
        </Meta>
        <div className="flex flex-wrap items-center gap-3">
          <BuildForm goalId={goalId} label="Try again" />
          {hasPath ? (
            <ButtonLink href="/today" variant="text">
              Start today&rsquo;s session
            </ButtonLink>
          ) : null}
        </div>
      </Card>
    );
  }

  if (hasPath) {
    return (
      <div>
        <ButtonLink href="/today">Start today&rsquo;s session</ButtonLink>
      </div>
    );
  }

  /* §8.5.5's empty state is one sentence and one button — except this one is no
     longer empty. The outline below is already the subject, grouped by area;
     building the path is what re-cuts it into modules that end in something you
     hand in. */
  return (
    <Card className="flex flex-col items-start gap-4">
      {/*
        No duration in it, and that is deliberate.

        It said "about a minute", which is not true for a free account:
        `aiCurriculum` is false there, so the path is arithmetic over the graph
        and comes back at once. Quoting a wait to somebody who will not have one
        is the same fault the pack build screen had when it promised three
        minutes for a build that takes three to eight — and this screen has no
        idea which plan is reading it, so any single figure is wrong for
        somebody.

        What is true for everyone is what the step is *for*, so that is what it
        says. The wait itself is now reported as it happens rather than
        predicted, which is the honest way to answer "how long will this take".
      */}
      <Meta>
        These are the pack&rsquo;s own areas. Build your path and we regroup them
        into modules that each end in a piece of work, checked against the graph
        before you see it.
      </Meta>
      <BuildForm goalId={goalId} label="Build my path" />
    </Card>
  );
}

/**
 * The button, in the two places that offer it.
 *
 * `SubmitButton` rather than `Button` because a server action posts over
 * `fetch`: without it the press has no acknowledgement of any kind until the
 * page comes back with the wait band on it.
 */
function BuildForm({ goalId, label }: { goalId: string; label: string }) {
  return (
    <form action={buildPathAction.bind(null, goalId)}>
      <SubmitButton
        pendingLabel="Starting the build"
        note="Handing it over to be built. This page will show you how it is getting on."
      >
        {label}
      </SubmitButton>
    </form>
  );
}
