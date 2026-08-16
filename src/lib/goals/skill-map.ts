import { layoutGraph } from "@/lib/packs/layout";
import type { EngineSkillGraph } from "@/lib/engine";
import type { Outline, SkillState } from "./outline";

/**
 * The subject graph, laid out to be looked at.
 *
 * `layoutGraph` answers the structural question — which layer does each skill
 * belong to, so that nothing sits above its own prerequisites — and stops
 * there, because it was written for an admin reviewer checking a pack. The
 * learner's path screen drew it directly and inherited three faults that made
 * the picture worse than no picture:
 *
 * 1. **The names were cut with `slice(0, 20)`.** "The exposure triangle" was
 *    drawn as "The exposure triangl" and "White balance and colour temperature"
 *    as "White balance and co". Every label in the graph looked misspelt,
 *    because every label *was* — a hard cut mid-word is indistinguishable from
 *    a typo, and there were fifteen of them on one screen.
 * 2. **Every layer started at the left edge.** A layer of two sat above a layer
 *    of five, hard against the same margin, so the edges between them raked
 *    diagonally across the whole picture and the shape said nothing about the
 *    subject.
 * 3. **Straight lines, bottom-centre to top-centre.** Two long diagonals
 *    crossing at a shallow angle are two lines nobody can follow to their ends.
 *
 * So the wrapping, the centring and the curves are here, as arithmetic, where
 * they can be tested — the component that draws it decides colour and nothing
 * else. `now` never enters: the same graph and the same states must produce the
 * same picture twice.
 */

/**
 * Geometry, in one place, because the component needs the box size to draw the
 * rectangles this module positioned.
 *
 * `maxChars` is derived rather than guessed: the box is 168px wide with 12px of
 * air either side, and the label is set at 12px, whose average advance in the
 * product's typeface is a shade over 6px. 21 characters is what fits, and a
 * name that does not fit is wrapped rather than cut.
 */
export const SKILL_MAP = {
  nodeWidth: 168,
  nodeHeight: 52,
  gapX: 20,
  gapY: 52,
  padding: 16,
  fontSize: 12,
  lineHeight: 15,
  maxChars: 21,
  maxLines: 2,
} as const;

const STEP_X = SKILL_MAP.nodeWidth + SKILL_MAP.gapX;
const STEP_Y = SKILL_MAP.nodeHeight + SKILL_MAP.gapY;

export interface SkillMapNode {
  skillId: string;
  /** The full name, for the node's `<title>` — the wrapped one may be cut. */
  name: string;
  state: SkillState;
  x: number;
  y: number;
  /** The name broken over at most `maxLines` lines. Never cut mid-word. */
  lines: string[];
  /** Baseline of the first line, so the block sits centred in the box. */
  labelY: number;
}

export interface SkillMapEdge {
  key: string;
  /** A cubic curve from the bottom of the prerequisite to the top of the skill. */
  path: string;
  /** Soft prerequisites are drawn dashed: they help, they do not gate. */
  soft: boolean;
}

export interface SkillMapLayout {
  nodes: SkillMapNode[];
  edges: SkillMapEdge[];
  width: number;
  height: number;
}

/** Cut a line that still does not fit, and say so rather than appearing to end. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A name, broken on word boundaries to fit the box.
 *
 * The rule that matters is that it never cuts *inside* a word while there is
 * another line to move it to, because that is the fault this whole module was
 * written for: a label reading "White balance and co" is not a shortened name,
 * it is a misspelt one. A word longer than the whole box is the only thing that
 * gets cut, and it takes an ellipsis so the reader knows it was.
 */
export function wrapLabel(
  name: string,
  maxChars: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let overflowed = false;

  for (const word of name.split(/\s+/)) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= maxChars) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else if (lines.length < maxLines) {
      lines.push(word);
    } else {
      overflowed = true;
    }
  }

  // The ellipsis goes on before the clip, not after, so a name that ran out of
  // room and a word that ran out of room cannot produce "……" between them.
  if (overflowed) lines[lines.length - 1] = `${lines.at(-1)!}…`;

  return lines.map((line) => clip(line, maxChars));
}

/**
 * Where the text block starts, so one line and two lines are both centred in
 * the same box. The `+11` is the ascent of the 12px face — SVG positions text
 * by its baseline, not by its top.
 */
function baselineFor(y: number, lineCount: number): number {
  return (
    y + (SKILL_MAP.nodeHeight - lineCount * SKILL_MAP.lineHeight) / 2 + 11
  );
}

/**
 * The picture and the list are built from the same outline, which is the only
 * way they can be guaranteed to agree — a graph that recomputed its own states
 * from mastery and the projection would eventually disagree with the rows above
 * it about the same skill, on the same screen, in front of the same learner.
 */
export function buildSkillMap(
  graph: EngineSkillGraph,
  outline: Outline,
): SkillMapLayout {
  // Total over the graph by construction: every skill lands in exactly one
  // section — the modules claim what they cover and `buildOutline`'s trailing
  // buckets sweep up the rest, bucketed by state.
  const states = new Map<string, SkillState>(
    outline.sections.flatMap((section) =>
      section.skills.map((skill) => [skill.skillId, skill.state]),
    ),
  );

  const layout = layoutGraph(graph);

  const perLayer = new Map<number, number>();
  for (const node of layout.nodes) {
    perLayer.set(node.depth, (perLayer.get(node.depth) ?? 0) + 1);
  }

  const content = layout.width * STEP_X - SKILL_MAP.gapX;
  const width = content + SKILL_MAP.padding * 2;
  const height =
    layout.depth * STEP_Y - SKILL_MAP.gapY + SKILL_MAP.padding * 2;

  const nodes: SkillMapNode[] = layout.nodes.map((node) => {
    // Each layer is centred on the widest one, so the picture reads as a river
    // rather than as a left-aligned staircase, and an edge between neighbouring
    // layers is short enough to follow with your eye.
    const layerWidth = perLayer.get(node.depth)! * STEP_X - SKILL_MAP.gapX;
    const x = Math.round(
      SKILL_MAP.padding + (content - layerWidth) / 2 + node.index * STEP_X,
    );
    const y = SKILL_MAP.padding + node.depth * STEP_Y;
    const lines = wrapLabel(node.name, SKILL_MAP.maxChars, SKILL_MAP.maxLines);

    return {
      skillId: node.id,
      name: node.name,
      state: states.get(node.id)!,
      x,
      y,
      lines,
      labelY: baselineFor(y, lines.length),
    };
  });

  const at = new Map(nodes.map((node) => [node.skillId, node]));
  const half = SKILL_MAP.nodeWidth / 2;

  const edges: SkillMapEdge[] = graph.dependencies.map((edge) => {
    // Total by construction: the pack validator rejects a dependency naming a
    // skill that does not exist, and `layoutGraph` places every skill.
    const from = at.get(edge.fromSkillId)!;
    const to = at.get(edge.toSkillId)!;

    const x1 = from.x + half;
    const y1 = from.y + SKILL_MAP.nodeHeight;
    const x2 = to.x + half;
    const y2 = to.y;
    // Control points straight below the start and straight above the end: the
    // curve leaves and arrives vertically, so it is obvious which end is which
    // even where a dozen of them converge on the same box.
    const bend = (y2 - y1) / 2;

    return {
      key: `${edge.fromSkillId}->${edge.toSkillId}`,
      path: `M${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`,
      soft: edge.type === "soft",
    };
  });

  return { nodes, edges, width, height };
}
