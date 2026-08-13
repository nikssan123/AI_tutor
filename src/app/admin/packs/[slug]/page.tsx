import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { join } from "node:path";
import { requireAdmin } from "@/lib/admin/guard";
import { loadPack, PACKS_DIR } from "@/lib/packs/loader";
import { toEngineGraph, validatePack } from "@/lib/packs/validate";
import { layoutGraph } from "@/lib/packs/layout";
import {
  Card,
  DisplayTitle,
  MaturityBadge,
  Meta,
  Row,
  RowList,
  Status,
  Title,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Pack",
  robots: { index: false, follow: false },
};

const NODE_W = 168;
const NODE_H = 44;
const GAP_X = 24;
const GAP_Y = 72;

/**
 * §24 E2 — the pack admin viewer.
 *
 * Its job is to make a reviewer's judgement possible: does this graph teach the
 * thing in a sensible order, and does the validator agree? So it shows the DAG
 * *and* the validation report, including warnings that do not block.
 */
export default async function PackPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireAdmin();

  const { slug } = await params;

  let pack;
  try {
    pack = loadPack(join(PACKS_DIR, slug));
  } catch {
    notFound();
  }

  const report = validatePack(pack);
  const layout = layoutGraph(toEngineGraph(pack));

  const position = (node: { depth: number; index: number }) => ({
    x: node.index * (NODE_W + GAP_X) + GAP_X,
    y: node.depth * GAP_Y + GAP_Y / 2,
  });

  const positions = new Map(layout.nodes.map((n) => [n.id, position(n)]));
  const svgWidth = layout.width * (NODE_W + GAP_X) + GAP_X;
  const svgHeight = layout.depth * GAP_Y + GAP_Y;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <DisplayTitle>{pack.name}</DisplayTitle>
        <div className="flex flex-wrap items-center gap-6">
          <MaturityBadge maturity={pack.maturity} />
          <Status tone={report.passed ? "verified" : "problem"}>
            {report.passed ? "Validation passing" : "Validation failing"}
          </Status>
          <Meta>
            Tier {pack.evalTier} · {pack.workspace} workspace
          </Meta>
        </div>
      </header>

      <Card className="flex flex-wrap gap-x-10 gap-y-3">
        {[
          ["Skills", report.stats.skills],
          ["Dependencies", report.stats.dependencies],
          ["Items", report.stats.items],
          ["Production / MCQ", `${report.stats.productionItems} / ${report.stats.mcqItems}`],
          ["Rubrics", report.stats.rubrics],
          ["Projects", report.stats.projects],
        ].map(([label, value]) => (
          <div key={String(label)} className="flex flex-col">
            <Meta>{label}</Meta>
            <span className="text-[length:var(--text-title-size)] font-semibold">
              {value}
            </span>
          </div>
        ))}
      </Card>

      <section className="flex flex-col gap-4">
        <Title>Skill graph</Title>
        <Meta>
          Laid out by depth, so every skill sits below all of its prerequisites.
          Solid edges are hard prerequisites; dashed are soft.
        </Meta>
        <Card className="overflow-x-auto">
          <svg
            width={svgWidth}
            height={svgHeight}
            role="img"
            aria-label={`Skill graph for ${pack.name}`}
          >
            {layout.edges.map((edge) => {
              // Every edge endpoint is a laid-out node — layoutGraph derives
              // both from the same graph.
              const from = positions.get(edge.from)!;
              const to = positions.get(edge.to)!;
              return (
                <line
                  key={`${edge.from}-${edge.to}`}
                  x1={from.x + NODE_W / 2}
                  y1={from.y + NODE_H}
                  x2={to.x + NODE_W / 2}
                  y2={to.y}
                  stroke="var(--hairline)"
                  strokeWidth={edge.type === "hard" ? 2 : 1}
                  strokeDasharray={edge.type === "soft" ? "4 4" : undefined}
                />
              );
            })}
            {layout.nodes.map((node) => {
              const { x, y } = positions.get(node.id)!;
              return (
                <g key={node.id}>
                  <rect
                    x={x}
                    y={y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={12}
                    fill="var(--accent-weak)"
                    stroke="var(--hairline)"
                  />
                  <text
                    x={x + NODE_W / 2}
                    y={y + NODE_H / 2 + 4}
                    textAnchor="middle"
                    fontSize="12"
                    fill="var(--ink)"
                  >
                    {node.name.length > 22
                      ? `${node.name.slice(0, 21)}…`
                      : node.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <Title>Validation</Title>
        <RowList>
          {report.issues.map((issue, i) => (
            <Row key={`${issue.check}-${i}`}>
              <span className="flex flex-col">
                <span>{issue.message}</span>
                <Meta>{issue.check}</Meta>
              </span>
              <Status
                tone={issue.severity === "blocking" ? "problem" : "attention"}
              >
                {issue.severity}
              </Status>
            </Row>
          ))}
          {report.issues.length === 0 ? (
            <Row>
              <span>Every check passed.</span>
              <Status tone="verified">Clean</Status>
            </Row>
          ) : null}
        </RowList>
      </section>
    </main>
  );
}
