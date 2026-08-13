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
  DisplayTitle,
  Lead,
  Meta,
  Status,
  Title,
} from "@/components/ui";
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
  const projection = projectSkills({ graph, mastery, now });
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
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <DisplayTitle>Your path through {pack.name}</DisplayTitle>
        <Lead>
          {projection.requiredSkillIds.length} skills to go ·{" "}
          {projection.estimatedHours} hours at your current level ·{" "}
          {goal.spec.weeklyHours}h a week
          {goal.spec.deadline ? ` · by ${goal.spec.deadline}` : ""}
        </Lead>
      </header>

      {/* ── The DAG ────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <Title>The whole subject</Title>
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
          <div className="mt-4 flex flex-wrap gap-4">
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
      <section className="flex flex-col gap-4">
        <Title>What you&rsquo;ll do, in order</Title>
        {stored ? (
          <ul className="flex list-none flex-col gap-0 p-0 m-0 overflow-hidden rounded-[var(--radius-card)] bg-surface">
            {stored.modules.map((mod) => (
              <li
                key={mod.order}
                className="flex items-baseline justify-between gap-4 border-b border-hairline px-5 py-4 last:border-b-0"
              >
                <span className="flex flex-col gap-1">
                  <span className="font-[550]">{mod.title}</span>
                  <Meta>
                    {mod.targetSkillIds
                      .map((s) => names.get(s) ?? s)
                      .join(" · ")}
                  </Meta>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {mod.outputArtifact === "project" ? (
                    <Status tone="verified">Graded</Status>
                  ) : null}
                  <Meta>{mod.estimatedHours}h</Meta>
                </span>
              </li>
            ))}
          </ul>
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
        <section className="flex flex-col gap-3">
          <Title>What we skipped</Title>
          <Meta>
            You don&rsquo;t have to take our word for it — each of these was
            skipped because you showed you could already do it.
          </Meta>
          <ul className="flex list-none flex-col gap-2 p-0 m-0">
            {projection.excludedSkillIds.map((skillId) => (
              <li key={skillId}>
                <Meta>{projection.exclusionReasons[skillId]}</Meta>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── What was checked (§14.6) ───────────────────────────────────── */}
      {stored?.report ? (
        <section className="flex flex-col gap-3">
          <Title>What we checked before showing you this</Title>
          <ul className="flex list-none flex-col gap-2 p-0 m-0">
            {stored.report.checks.map((c) => (
              <li key={c.name} className="flex items-baseline gap-3">
                <Status tone={c.passed ? "verified" : "attention"}>
                  {c.passed ? "Pass" : "Flagged"}
                </Status>
                <Meta>{c.detail}</Meta>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
