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
import { layoutGraph } from "@/lib/packs/layout";
import { effectiveMastery } from "@/lib/engine/bkt";
import { CURRICULUM_MASTERED_THRESHOLD } from "@/lib/curriculum/validate";
import {
  Button,
  ButtonLink,
  Card,
  Lead,
  Meta,
  stagger,
  Status,
  MaturityBadge,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import { CourseOutline, OutlineLegend } from "@/components/course-outline";
import { buildPathAction, setDepthAction } from "./actions";

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
 * There is no percentage anywhere on this page (§24 E9).
 */
export const metadata: Metadata = {
  title: "Your path",
  robots: { index: false, follow: false },
};

const NODE_W = 150;
const NODE_H = 34;
const GAP_X = 22;
const GAP_Y = 84;

/**
 * §8 screen 5's states, drawn with the palette that exists (§8.5.4 — no colour
 * is invented at a call site).
 *
 * The accent outline goes on what is *next*, not on what is finished: the
 * question this page answers is "what am I doing", and a graph that shouts
 * loudest about completed work answers the wrong one.
 */
const STATE = {
  current: {
    fill: "var(--color-raised)",
    stroke: "var(--color-accent)",
    width: 2,
    label: "On your path",
  },
  mastered: {
    fill: "var(--color-accent-weak)",
    stroke: "var(--color-hairline)",
    width: 1,
    label: "Already yours",
  },
  optional: {
    fill: "var(--color-surface)",
    stroke: "var(--color-hairline)",
    width: 1,
    label: "Optional",
  },
} as const;

export default async function PathPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const db = getDb();
  const goal = await activeGoal(db, session.user.id);

  /*
   * No course running, and no ownership check needed to say so.
   *
   * This screen used to live at `/goals/{id}/path` and opened by comparing the
   * id in the URL against the learner's active goal — because reading someone
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
  const projection = projectSkills({
    graph,
    mastery,
    now,
    depth: goal.spec.depth,
  });
  const stored = await currentCurriculum(db, goal.id);
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

  const names = new Map(graph.skills.map((s) => [s.id, s.name]));
  const effective = new Map(
    mastery.map((m) => [m.skillId, effectiveMastery(m, now)]),
  );
  const optional = new Set(projection.optionalSkillIds);

  const layout = layoutGraph(graph);
  const positions = new Map(
    layout.nodes.map((n) => [
      n.id,
      { x: n.index * (NODE_W + GAP_X) + GAP_X, y: n.depth * GAP_Y + GAP_Y / 2 },
    ]),
  );
  const svgWidth = layout.width * (NODE_W + GAP_X) + GAP_X;
  const svgHeight = layout.depth * GAP_Y + GAP_Y;

  const stateOf = (skillId: string) => {
    if ((effective.get(skillId) ?? 0) > CURRICULUM_MASTERED_THRESHOLD) {
      return STATE.mastered;
    }
    return optional.has(skillId) ? STATE.optional : STATE.current;
  };

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

        {stored ? (
          <div>
            <ButtonLink href="/today">Start today&rsquo;s session</ButtonLink>
          </div>
        ) : (
          /* §8.5.5's empty state is one sentence and one button — except this
             one is no longer empty. The outline below is already the subject,
             grouped by area; building the path is what re-cuts it into modules
             that end in something you hand in. */
          <Card className="flex flex-col items-start gap-4">
            {/*
              No duration in it, and that is deliberate.

              It said "about a minute", which is not true for a free account:
              `aiCurriculum` is false there, so the path is arithmetic over the
              graph and comes back at once. Quoting a wait to somebody who will
              not have one is the same fault the build screen had when it
              promised three minutes for a build that takes three to eight —
              and this screen has no idea which plan is reading it, so any
              single figure is wrong for somebody.

              What is true for everyone is what the step is *for*, so that is
              what it says. If a plan ever needs a wait explained, the honest
              place is a screen that knows which plan it is talking to.
            */}
            <Meta>
              These are the pack&rsquo;s own areas. Build your path and we
              regroup them into modules that each end in a piece of work,
              checked against the graph before you see it.
            </Meta>
            <form action={buildPathAction.bind(null, goal.id)}>
              <Button type="submit">Build my path</Button>
            </form>
          </Card>
        )}

        <CourseOutline outline={outline} />
      </section>

      {/* ── The DAG ────────────────────────────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(2)}>
        <SectionHead
          label="The graph"
          title="How the subject holds together"
        />
        <Meta>
          The same skills, laid out by depth — every one sits below what it
          needs first.
        </Meta>
        <Card className="overflow-x-auto">
          <svg
            width={svgWidth}
            height={svgHeight}
            role="img"
            aria-label={`Skill graph for ${pack.name}`}
          >
            {graph.dependencies.map((edge) => {
              // Total by construction: the validator rejects a pack whose edge
              // names a skill that does not exist, and layoutGraph places every
              // skill in the graph.
              const from = positions.get(edge.fromSkillId)!;
              const to = positions.get(edge.toSkillId)!;
              return (
                <line
                  key={`${edge.fromSkillId}-${edge.toSkillId}`}
                  x1={from.x + NODE_W / 2}
                  y1={from.y + NODE_H}
                  x2={to.x + NODE_W / 2}
                  y2={to.y}
                  stroke="var(--color-hairline)"
                  strokeDasharray={edge.type === "soft" ? "4 4" : undefined}
                />
              );
            })}
            {layout.nodes.map((node) => {
              const at = positions.get(node.id)!;
              const state = stateOf(node.id);
              return (
                <g key={node.id}>
                  <rect
                    x={at.x}
                    y={at.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={8}
                    fill={state.fill}
                    stroke={state.stroke}
                    strokeWidth={state.width}
                  />
                  <text
                    x={at.x + 10}
                    y={at.y + 22}
                    fill="var(--color-ink)"
                    fontSize="12"
                  >
                    {names.get(node.id)!.slice(0, 20)}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 border-t border-hairline pt-4">
            {Object.values(STATE).map((s) => (
              <span key={s.label} className="flex items-center gap-2">
                <span
                  className="inline-block size-3 rounded-[3px]"
                  style={{
                    background: s.fill,
                    border: `${s.width}px solid ${s.stroke}`,
                  }}
                />
                <Meta>{s.label}</Meta>
              </span>
            ))}
          </div>
        </Card>
      </section>

      {/* ── How much of the subject you're taking on ───────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(3)}>
        <SectionHead label="How deep" title="How much of this you're taking on" />
        <Lead>
          Each is priced against what you&rsquo;ve already shown you can do, so
          these are your hours, not a brochure&rsquo;s. Switching never takes
          away a skill you&rsquo;ve already proved.
        </Lead>
        <ul className="grid list-none grid-cols-1 gap-3 p-0 m-0 sm:grid-cols-3">
          {depths.map((option) => {
            const copy = DEPTH_COPY[option.depth];
            return (
              <li key={option.depth} className="flex">
                <Card className="flex flex-1 flex-col items-start gap-3 p-5">
                  <div className="flex flex-col gap-1">
                    <strong className="text-[length:var(--text-label-size)] font-[var(--text-label-weight)]">
                      {copy.name}
                    </strong>
                    <Meta>
                      {option.skillCount} skills &middot; {option.estimatedHours}
                      h
                    </Meta>
                  </div>
                  <Meta>{copy.blurb}</Meta>
                  {option.current ? (
                    <Status tone="verified">Your course</Status>
                  ) : (
                    <form
                      action={setDepthAction.bind(null, goal.id, option.depth)}
                    >
                      <Button type="submit" variant="text">
                        {option.dropped.length > 0
                          ? `Drop ${countSkills(option.dropped.length)}`
                          : `Add ${countSkills(option.added.length)}`}
                      </Button>
                    </form>
                  )}
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
            title="What we checked before showing you this"
          />
          <ul className="m-0 flex list-none flex-col gap-0 overflow-hidden rounded-[var(--radius-card)] bg-surface p-0 shadow-[var(--shadow-raised)]">
            {stored.report.checks.map((c) => (
              <li
                key={c.name}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-hairline px-5 py-4 last:border-b-0"
              >
                <Status tone={c.passed ? "verified" : "attention"}>
                  {c.passed ? "Pass" : "Flagged"}
                </Status>
                <Meta>{c.detail}</Meta>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </AppFrame>
  );
}
