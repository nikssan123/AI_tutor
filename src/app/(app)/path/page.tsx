import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { activeGoal, masteryFor } from "@/lib/goals/store";
import { standingFor } from "@/lib/goals/standing";
import { NothingRunning, PickBackUp } from "@/components/nothing-running";
import { projectSkills } from "@/lib/goals/projection";
import { buildOutline } from "@/lib/goals/outline";
import { depthOptions } from "@/lib/goals/depth";
import { currentCurriculum } from "@/lib/curriculum/store";
import { resolvePack } from "@/lib/content/resolve";
import { toEngineGraph } from "@/lib/packs/validate";
import { buildSkillMap } from "@/lib/goals/skill-map";
import {
  Button,
  Card,
  Lead,
  Meta,
  stagger,
  Status,
  MaturityBadge,
} from "@/components/ui";
import { ChevronIcon } from "@/components/icons";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import { CourseOutline, OutlineLegend } from "@/components/course-outline";
import { CurriculumChecks } from "@/components/curriculum-checks";
import { SkillMap } from "@/components/skill-map";
import { findPathBuild } from "@/lib/curriculum/build-state";
import { nudgeAt } from "@/lib/billing/gate";
import { UpgradeNudge } from "@/components/upgrade-nudge";
import { sessionsLocked } from "@/lib/billing/gate";
import { PathBuildState } from "./building";
import { setDepthAction } from "./actions";

/**
 * §8's rule for this screen is that it sets expectations honestly, so the dial
 * is described by what the learner gets, never by how the set is computed.
 * "Levels kept, closed under hard prerequisites" is true and is none of their
 * business.
 */
const DEPTH_COPY = {
  sprint: {
    name: "Sprint",
    blurb: "The foundations and the core, and nothing else. The fastest route to doing the work.",
  },
  standard: {
    name: "Standard",
    blurb: "The version we'd pick for you. Everything most people need to work unsupervised.",
  },
  mastery: {
    name: "Mastery",
    blurb: "The whole subject, including the parts most people never reach for.",
  },
} as const;

/** "1 skill", not "1 skills" — the sprint↔mastery step is often exactly one. */
function countSkills(n: number): string {
  return `${n} ${n === 1 ? "skill" : "skills"}`;
}

/**
 * Above this many, the list of what a switch changes folds away.
 *
 * The disclosure is not a way of hiding the answer — it is what keeps three
 * cards in a row the same height when one of them would otherwise be a
 * twenty-item list, and it is `<details>`, so the names are in the HTML either
 * way and open with no JavaScript. Under the threshold nothing folds, because a
 * four-line list a learner has to click for is a decision made deliberately
 * harder to inspect.
 */
const CHANGE_INLINE_MAX = 4;

/**
 * What switching to this depth would actually change, by name.
 *
 * The dial used to say this on the button — "Drop 4 skills", "Add 1 skill" —
 * which is a size without a content. Four skills out of a photography course
 * could be the colour work or it could be the reason the learner signed up, and
 * the screen whose whole job is the honest expectation-set was asking them to
 * choose blind. So the names are the answer, and the button goes back to being
 * a button.
 */
function DepthChange({ verb, skills }: { verb: string; skills: string[] }) {
  return (
    <details open={skills.length <= CHANGE_INLINE_MAX} className="group w-full">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronIcon className="size-3.5 text-ink-faint transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] group-open:rotate-90" />
        <span className="text-[length:var(--text-label-size)] font-[550] text-ink">
          {verb} {countSkills(skills.length)}
        </span>
      </summary>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 pl-6">
        {skills.map((name) => (
          <li key={name}>
            <Meta>{name}</Meta>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * §8 screen 5 — the generated learning path.
 *
 * "The 'wow', and the honest expectation-set." Both halves are still here; what
 * changed is which one leads.
 *
 * **The graph was answering a question nobody asked.** §8 specifies four states
 * — "mastered / in progress / locked / skipped-because-you-know-it" — and this
 * page drew three of them as fills on a DAG. The fourth, *locked*, it could not
 * draw at all: an untouched skill and an unreachable one were the same
 * rectangle, so the most useful thing the engine knows — what has to happen
 * first — never reached the screen. Meanwhile the honest half lived in a
 * separate list at the bottom, so the skipped skills sat outside the shape of
 * the course rather than in the place they were skipped from.
 *
 * So the outline leads now: the whole course, sectioned, every skill carrying
 * its state and a sentence for it, in the shape every course catalogue on the
 * internet uses because it works. The graph keeps its band lower down, where
 * "how does this subject hold together" is a fair question to be asked.
 * §24 E6's criterion is unchanged and still met — the DAG renders, and what was
 * skipped is listed with its reason, now beside the module it was skipped from.
 *
 * **All three bands were then redrawn, for the same fault said three ways: the
 * screen knew things it was not telling anyone.**
 *
 * - The outline said all four states with the same furniture — a dot and a word
 *   mid-row — so a locked skill and an open one had identical silhouettes and
 *   the list could only be read a line at a time. Every row leads with a mark
 *   now (`course-outline.tsx`), and a lock is a lock from across the room.
 * - The graph cut its labels with `slice(0, 20)`, which made every name in it
 *   look misspelt, drew three of the four states, left each layer hard against
 *   the left margin and joined them with straight diagonals. It is
 *   `SkillMap` now, laid out by `buildSkillMap`, and it reads off the same
 *   outline the list does so the two cannot disagree.
 * - The depth dial put its whole answer on a button: "Drop 4 skills" is a size
 *   with no content. Each option names them.
 *
 * There is no percentage anywhere on this page (§24 E9).
 */
export const metadata: Metadata = {
  title: "Your path",
  robots: { index: false, follow: false },
};

export default async function PathPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const db = getDb();
  const goal = await activeGoal(db, session.user.id);

  /*
   * No course running, and no ownership check needed to say so.
   *
   * This screen used to live at `/goals/{id}/path` and open by comparing the id
   * in the URL against the learner's active goal — because reading someone
   * else's path by guessing a UUID is not a feature. The id is gone and the
   * guarantee is stronger for it: there is no id to guess, and `activeGoal`
   * only ever returns this learner's own.
   *
   * The same card the other destinations give the same learner, for
   * `NothingRunning`'s own reason: the offer is the same learner's state
   * wherever they read it, and a `notFound()` here would have been the one
   * destination in the rail that answered "nothing running" with a 404.
   */
  const pack = goal ? await resolvePack(db, goal.packSlug) : undefined;

  if (!goal || !pack) {
    const standing = await standingFor(db, session.user.id);

    return (
      <AppFrame>
        <AppHeader
          title="Your path"
          lead="The whole course, in the order it builds on itself — once there is a course to lay out."
        />
        <NothingRunning
          standing={standing}
          note="Once a course is running, this is where you can see all of it: what is open to you now, what is waiting on something else, and what we skipped because you can already do it."
        />
        <PickBackUp courses={standing.again} />
      </AppFrame>
    );
  }

  const now = new Date().toISOString();
  const graph = toEngineGraph(pack);
  const mastery = await masteryFor(db, session.user.id, goal.packSlug);

  // This screen offers the same button `/today` does, so it owes the same
  // answer: an offer to start something the month has no room for is a door
  // with nothing behind it.
  const sessionsAreLocked = await sessionsLocked(
    db,
    session.user.id,
    session.user.plan,
  );
  const projection = projectSkills({
    graph,
    mastery,
    now,
    depth: goal.spec.depth,
  });
  const stored = await currentCurriculum(db, goal.id);
  // What the queue is doing to this goal, if anything. Cheap — one row on the
  // primary key — and it is what turns a silent button into a wait with steps.
  const pathBuild = await findPathBuild(db, goal.id);
  const depths = depthOptions({
    graph,
    mastery,
    now,
    current: goal.spec.depth,
  });

  const outline = buildOutline({
    graph,
    mastery,
    now,
    projection,
    modules: stored?.modules,
  });

  // Built from the outline rather than re-derived, so the picture and the list
  // cannot end up saying two different things about the same skill.
  const map = buildSkillMap(graph, outline);

  /*
   * The free tier's shape, on the one screen that shows what it applies to.
   *
   * This is the whole plan — every skill, in order — and a free learner can
   * reach exactly one lesson of it. Saying so here is the difference between a
   * price and a bait-and-switch: `lessonForBlock` refuses lesson two either
   * way, and a limit discovered by walking into it feels like one however
   * generous the tier is.
   *
   * **Asked unconditionally, after two narrower rules failed.** It was keyed
   * first to a `?built=1` parameter off the handoff redirect (survived one
   * navigation; anyone returning through the "your course is ready" email saw
   * nothing), then to the course being untouched — which switched the ask off
   * the moment somebody read the one lesson free includes, i.e. at the exact
   * point they have seen what the product does and have nothing left to do with
   * it. Both rules hid it from the learner most ready to act on it.
   *
   * So the condition is the plan, and only the plan. `nudgeAt` returns nothing
   * for anybody whose lessons are not capped, so a paying learner sees nothing
   * and there is no plan check to write here.
   */
  const locked = await nudgeAt(
    db,
    session.user.id,
    session.user.plan,
    "course_locked",
  );

  return (
    <AppFrame>
      <AppHeader
        title={`Your path through ${pack.name}`}
        facts={
          <>
            <Meta>{projection.requiredSkillIds.length} skills to go</Meta>
            <Meta>
              {projection.estimatedHours} hours at your current level
            </Meta>
            <Meta>{goal.spec.weeklyHours}h a week</Meta>
            {goal.spec.deadline ? <Meta>by {goal.spec.deadline}</Meta> : null}
            {/* §7.1 — see /today. The path is the screen people show other
                people. */}
            {pack.maturity !== "curated" ? (
              <MaturityBadge
                maturity={pack.maturity}
                review={pack.quality.reviewKind}
              />
            ) : null}
          </>
        }
      />

      {/* Under the header, which still says what course this is — and above the
          outline, because the outline is the thing being described. */}
      {locked ? <UpgradeNudge nudge={locked} /> : null}

      {/* ── The outline ────────────────────────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(1)}>
        <SectionHead
          label="The course"
          title="Everything in it, and what's open to you now"
        />
        <Lead>
          The whole subject, not just the next bit. A skill you can&rsquo;t start
          yet says what has to happen first, so nothing here is a locked door
          with no sign on it.
        </Lead>
        <OutlineLegend counts={outline.counts} />

        {/* The offer, the wait, or what stopped it — one question, answered in
            one place. See `building.tsx`. */}
        <PathBuildState
          locked={sessionsAreLocked}
          build={pathBuild}
          hasPath={stored !== undefined}
          goalId={goal.id}
        />


        <CourseOutline outline={outline} />
      </section>

      {/* ── The DAG ────────────────────────────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(2)}>
        <SectionHead
          label="The graph"
          title="How the subject holds together"
        />
        <Lead>
          Read it downwards: nothing sits above the things it needs first. The
          same {countSkills(graph.skills.length)} as the list, in the shape the
          subject actually has rather than the order we happen to teach it in.
        </Lead>
        <SkillMap
          layout={map}
          label={`How the skills in ${pack.name} build on each other`}
        />
      </section>

      {/* ── How much of the subject you're taking on ───────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(3)}>
        <SectionHead label="How deep" title="How much of this you're taking on" />
        <Lead>
          Three sizes of the same subject, each priced against what you&rsquo;ve
          already shown you can do &mdash; so these are your hours, not a
          brochure&rsquo;s. Every option names the skills it would add or stop
          asking for, and switching never takes away a skill you&rsquo;ve
          already proved.
        </Lead>
        <ul className="grid list-none grid-cols-1 gap-3 p-0 m-0 sm:grid-cols-3">
          {depths.map((option) => {
            const copy = DEPTH_COPY[option.depth];
            return (
              <li key={option.depth} className="flex">
                <Card className="flex flex-1 flex-col items-start gap-4 p-5">
                  <div className="flex flex-col gap-1">
                    <strong className="text-[length:var(--text-label-size)] font-[var(--text-label-weight)]">
                      {copy.name}
                    </strong>
                    <Meta>
                      {countSkills(option.skillCount)} &middot;{" "}
                      {option.estimatedHours}h
                    </Meta>
                  </div>
                  <Meta>{copy.blurb}</Meta>

                  {/* Both, rather than whichever is bigger. A shallower course
                      only ever drops and a deeper one only ever adds, but the
                      card should not be the thing that knows that. */}
                  {option.dropped.length > 0 ? (
                    <DepthChange verb="Leaves out" skills={option.dropped} />
                  ) : null}
                  {option.added.length > 0 ? (
                    <DepthChange verb="Adds" skills={option.added} />
                  ) : null}

                  {/* `mt-auto` so the three cards' actions line up along the
                      bottom however long their lists are, and the touch height
                      so the card you are already on does not sit its status a
                      few pixels below its neighbours' buttons. */}
                  <div className="mt-auto flex min-h-[var(--touch-min)] items-center pt-1">
                    {option.current ? (
                      <Status tone="verified">Your course</Status>
                    ) : (
                      <form
                        action={setDepthAction.bind(null, goal.id, option.depth)}
                      >
                        <Button type="submit" variant="text" className="-ml-3">
                          Switch to {copy.name}
                        </Button>
                      </form>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── What was checked (§14.6) ───────────────────────────────────── */}
      {stored?.report ? (
        <section className="rise flex flex-col gap-6" style={stagger(4)}>
          <SectionHead
            label="Before you saw it"
            title="Every check this plan had to clear"
          />
          <Lead>
            A plan is checked against the subject&rsquo;s own graph, and against
            what you have already proved, before it becomes your course. One
            that fails a hard check goes back to be rewritten rather than out to
            you.
          </Lead>
          <CurriculumChecks report={stored.report} />
        </section>
      ) : null}
    </AppFrame>
  );
}
