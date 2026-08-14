import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { activeGoal, masteryFor } from "@/lib/goals/store";
import { projectSkills } from "@/lib/goals/projection";
import { currentCurriculum } from "@/lib/curriculum/store";
import { resolvePack } from "@/lib/content/resolve";
import { toEngineGraph } from "@/lib/packs/validate";
import { layoutGraph } from "@/lib/packs/layout";
import { effectiveMastery } from "@/lib/engine/bkt";
import { CURRICULUM_MASTERED_THRESHOLD } from "@/lib/curriculum/validate";
import {
  Button,
  Card,
  Lead,
  Meta,
  stagger,
  Status,
  MaturityBadge,
} from "@/components/ui";
import { AppFrame, AppHeader, SectionHead } from "@/components/app-shell";
import { buildPathAction } from "./actions";

/**
 * §8 screen 5 — the generated learning path.
 *
 * "The 'wow', and the honest expectation-set." Both halves matter: the DAG is
 * the wow, and the skipped list is the honesty. §8 is explicit that the page
 * must "explicitly list what was skipped and why" — that is the "don't waste my
 * time" promise made visible, and it is the part a progress bar can never say.
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

type Props = { params: Promise<{ id: string }> };

export default async function PathPage({ params }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { id } = await params;
  const db = getDb();

  const goal = await activeGoal(db, session.user.id);
  // Scoped to the signed-in learner's own goal: reading someone else's path by
  // guessing a UUID is not a feature.
  if (!goal || goal.id !== id) notFound();

  const pack = await resolvePack(db, goal.packSlug);
  if (!pack) notFound();

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
              <MaturityBadge maturity={pack.maturity} />
            ) : null}
          </>
        }
      />

      {/* ── The DAG ────────────────────────────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(1)}>
        <SectionHead label="The graph" title="The whole subject" />
        <Meta>
          Laid out by depth, so every skill sits below what it needs first.
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

      {/* ── The modules ────────────────────────────────────────────────── */}
      <section className="rise flex flex-col gap-6" style={stagger(2)}>
        <SectionHead label="In order" title="What you'll do" />
        {stored ? (
          /* Numbered, because "in order" is the whole claim of this list and
             a stack of equal rows does not say it. */
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {stored.modules.map((mod, i) => (
              <li key={mod.order}>
                <Card className="flex flex-wrap items-baseline gap-x-5 gap-y-3 p-5">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-[length:var(--text-meta-size)] font-[650] text-accent tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[length:var(--text-lead-size)] font-[550] text-ink">
                      {mod.title}
                    </span>
                    <Meta>
                      {mod.targetSkillIds
                        .map((s) => names.get(s) ?? s)
                        .join(" · ")}
                    </Meta>
                  </span>
                  <span className="flex shrink-0 items-center gap-4">
                    {mod.outputArtifact === "project" ? (
                      <Status tone="verified">Graded</Status>
                    ) : null}
                    <Meta>{mod.estimatedHours}h</Meta>
                  </span>
                </Card>
              </li>
            ))}
          </ol>
        ) : (
          <Card className="flex flex-col items-start gap-4">
            <Meta>
              No path built yet. It takes about a minute — we generate one, then
              check it against the graph before you see it.
            </Meta>
            <form action={buildPathAction.bind(null, goal.id)}>
              <Button type="submit">Build my path</Button>
            </form>
          </Card>
        )}
      </section>

      {/* ── What was skipped, and why ──────────────────────────────────── */}
      {projection.excludedSkillIds.length > 0 ? (
        <section className="rise flex flex-col gap-6" style={stagger(3)}>
          <SectionHead label="Not on it" title="What we skipped" />
          <Lead>
            You don&rsquo;t have to take our word for it — each of these was
            skipped because you showed you could already do it.
          </Lead>
          <ul className="grid list-none grid-cols-1 gap-3 p-0 m-0 sm:grid-cols-2">
            {projection.excludedSkillIds.map((skillId) => (
              <li
                key={skillId}
                className="rounded-[var(--radius-control)] bg-surface px-4 py-3 shadow-[var(--shadow-raised)]"
              >
                <Meta>{projection.exclusionReasons[skillId]}</Meta>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
