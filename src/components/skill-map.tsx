import type { CSSProperties } from "react";
import { Card, cx, Meta } from "@/components/ui";
import {
  SKILL_MAP,
  type SkillMapEdge,
  type SkillMapLayout,
  type SkillMapNode,
} from "@/lib/goals/skill-map";
import {
  SKILL_STATE_WORD,
  SKILL_STATES,
  type SkillState,
} from "@/lib/goals/outline";

/**
 * The subject graph, drawn.
 *
 * Everything positional was decided in `buildSkillMap` and everything here is
 * colour — which is the split that lets the hard part be tested. What this file
 * is responsible for is that the picture says the same thing the list above it
 * says, and it had not been: the list showed four states and the graph showed
 * three, missing *locked* entirely, so the one fact the graph is uniquely good
 * at showing — that this box is unreachable because of that box above it — was
 * the fact it could not draw. Same four states, same four words (§8.5.5's ban
 * on colour as the sole carrier of meaning is why the key spells them out).
 *
 * The key also names what a dashed line is, which nothing on the screen did.
 * A picture with two kinds of edge and an explanation of neither is a puzzle.
 *
 * `role="img"` with one label, rather than a tree of readable nodes: the
 * outline above carries every one of these skills with its state and a sentence
 * for it, so a screen reader that also walked the graph would read the whole
 * course twice, in a worse order.
 */

/**
 * The lines.
 *
 * `--hairline` is the token for a *rule between things*, and it was wrong here
 * for a reason worth writing down: a hairline is meant to be barely there, and
 * on a dark surface it measures 1.1:1 against the card it sits on. The edges
 * are not furniture on this picture — they are its entire content, the only
 * part that says anything a list could not — so they take `--ink-faint`, held
 * back with opacity so that eighteen of them still read as a structure rather
 * than as a scribble.
 */
const EDGE_STROKE = "var(--color-ink-faint)";
const EDGE_OPACITY = 0.5;
const EDGE_WIDTH = 1.5;
const EDGE_DASH = "4 4";

/** §8.5.4 — no colour is invented at a call site; these are all tokens. */
const NODE: Record<
  SkillState,
  { fill: string; stroke: string; dash: string | null; ink: string }
> = {
  // The two solid fills, for the same reason the list gives them solid tiles:
  // the accent goes on what is next, never on what is finished. `started` is
  // ringed as well, so the node you are in the middle of is findable in a graph
  // where several are open.
  started: {
    fill: "var(--color-accent)",
    stroke: "var(--color-ink)",
    dash: null,
    ink: "var(--color-on-accent)",
  },
  open: {
    fill: "var(--color-accent)",
    stroke: "var(--color-accent)",
    dash: null,
    ink: "var(--color-on-accent)",
  },
  locked: {
    fill: "var(--color-ground)",
    stroke: "var(--color-hairline)",
    dash: null,
    ink: "var(--color-ink-muted)",
  },
  proved: {
    fill: "var(--color-accent-weak)",
    stroke: "var(--color-accent-weak)",
    dash: null,
    // Accent ink on the weak field, matching the list's proved mark exactly.
    // Muted grey on it was a near-miss for the locked box — two states two
    // shades apart in a picture whose whole job is telling states apart.
    ink: "var(--color-accent)",
  },
  optional: {
    fill: "var(--color-ground)",
    stroke: "var(--color-hairline)",
    dash: "4 3",
    ink: "var(--color-ink-faint)",
  },
};

/**
 * Under this width a graph fits a phone column outright, and the hint below
 * would be telling a learner to drag something that does not move. Only a two-
 * or three-skill subject gets there; every real one is wider than a phone and
 * always will be, which is why the hint is worth writing at all.
 */
const PHONE_COLUMN = 320;

/**
 * The nodes back into the layers `buildSkillMap` laid them out in.
 *
 * `y` identifies a layer — it is `depth * STEP_Y` plus a constant margin — and
 * every node in one shares a centring offset, which is what lets the whole
 * layer move as a group rather than each node carrying its own copy.
 */
export function layersOf(
  nodes: SkillMapNode[],
): Array<{ y: number; shift: number; nodes: SkillMapNode[] }> {
  const byY = new Map<number, SkillMapNode[]>();
  for (const node of nodes) {
    byY.set(node.y, [...(byY.get(node.y) ?? []), node]);
  }

  return [...byY].map(([y, layer]) => ({
    y,
    // Equal across the layer by construction, so the first one speaks for it.
    shift: layer[0]!.xCentred - layer[0]!.x,
    nodes: layer,
  }));
}

const EDGE_KEY = [
  { dashed: false, label: "Needed before it" },
  { dashed: true, label: "Helps, but not required" },
];

function KeyList({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ul
      className={cx(
        "m-0 flex list-none flex-wrap items-center gap-x-5 gap-y-2 p-0",
        className,
      )}
    >
      {children}
    </ul>
  );
}

export function SkillMap({
  layout,
  label,
}: {
  layout: SkillMapLayout;
  /** What the picture is, for anyone who cannot see it. */
  label: string;
}) {
  return (
    <Card className="flex flex-col gap-5">
      {/* The scroll bleeds to the card's edge so a wide subject reads as
          continuing rather than as cropped, while the key below keeps the
          card's own padding and stays put while the picture moves.

          `shrink-0 max-w-none` is what stops the browser doing the obliging
          thing. The reset gives an `svg` `max-width: 100%`, so a graph wider
          than its card was being scaled down to fit — which sounds harmless
          and is not: it takes the 12px label with it, so a wide subject on a
          desktop set its names at 10px and the same subject on a phone set
          them at 5. A picture you can read a third of is worth more than one
          you can see all of and read none of.

          `.scroll-x` rather than `overflow-x-auto` for the other half of that
          trade: every platform this ships to hides the scrollbar until
          something is already scrolling, so the pane needs to say for itself
          that there is more of it. See its note in `globals.css`.

          No padding on the pane — the canvas carries its own margin, because
          padding here is part of the scrollable width and made a picture that
          fits its card scroll anyway, shading an edge that had nothing behind
          it. */}
      <div className="scroll-x -mx-6">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={label}
          className="block max-w-none shrink-0"
        >
          {/*
            The edges twice, and the nodes once.

            An edge spans two layers whose centring offsets differ, so no single
            translate carries a curve from one placement to the other — it has
            to be drawn from each set of coordinates. A *node* lives in exactly
            one layer, so it moves with its layer and is drawn once. That
            asymmetry is worth the slightly odd shape of this block: duplicating
            the nodes would put every skill's name in the DOM twice, and a
            `<title>` read out twice is worse than a curve drawn twice.

            See `.map-panned` / `.map-whole` and `.map-layer` in `globals.css`,
            and `buildSkillMap` for why there are two placements at all.
          */}
          {(
            [
              ["map-panned", (e: SkillMapEdge) => e.path],
              ["map-whole", (e: SkillMapEdge) => e.pathCentred],
            ] as const
          ).map(([placement, pathOf]) => (
            <g key={placement} className={placement}>
              {layout.edges.map((edge) => (
                <path
                  key={edge.key}
                  d={pathOf(edge)}
                  fill="none"
                  stroke={EDGE_STROKE}
                  strokeOpacity={EDGE_OPACITY}
                  strokeWidth={EDGE_WIDTH}
                  strokeDasharray={edge.soft ? EDGE_DASH : undefined}
                />
              ))}
            </g>
          ))}

          {layersOf(layout.nodes).map((layer) => (
            <g
              key={layer.y}
              className="map-layer"
              // Every node in a layer shares one offset, which is the whole
              // reason the nodes need no second copy.
              style={{ "--map-shift": `${layer.shift}px` } as CSSProperties}
            >
              {layer.nodes.map((node) => {
                const style = NODE[node.state];
                return (
                  <g key={node.skillId}>
                    {/* The full name, for a label that had to be wrapped short. */}
                    <title>{`${node.name} — ${SKILL_STATE_WORD[node.state].toLowerCase()}`}</title>
                    <rect
                      x={node.x}
                      y={node.y}
                      width={SKILL_MAP.nodeWidth}
                      height={SKILL_MAP.nodeHeight}
                      rx={12}
                      fill={style.fill}
                      stroke={style.stroke}
                      strokeDasharray={style.dash ?? undefined}
                    />
                    {node.lines.map((line, index) => (
                      <text
                        key={`${node.skillId}-${index}`}
                        x={node.x + SKILL_MAP.nodeWidth / 2}
                        y={node.labelY + index * SKILL_MAP.lineHeight}
                        textAnchor="middle"
                        fill={style.ink}
                        fontSize={SKILL_MAP.fontSize}
                        fontWeight={550}
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>

      <div className="flex flex-col gap-3 border-t border-hairline pt-4">
        {/* Belt and braces with the shading above it, and only where the
            shading is easiest to miss: a phone hides its scrollbar entirely,
            and it is the one screen where the picture is mostly off-frame. */}
        {layout.width > PHONE_COLUMN ? (
          <Meta className="sm:hidden">
            Wider than the screen &mdash; drag it sideways to see the rest.
          </Meta>
        ) : null}

        <KeyList>
          {SKILL_STATES.map((state) => {
            const style = NODE[state];
            return (
              <li key={state} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block size-3.5 rounded-[4px]"
                  style={{
                    background: style.fill,
                    border: `1px ${style.dash ? "dashed" : "solid"} ${style.stroke}`,
                  }}
                />
                <Meta>{SKILL_STATE_WORD[state]}</Meta>
              </li>
            );
          })}
        </KeyList>

        <KeyList>
          {EDGE_KEY.map((edge) => (
            <li key={edge.label} className="flex items-center gap-2">
              {/* Drawn rather than bordered, so the swatch is the same stroke
                  at the same weight and opacity as the thing it explains. */}
              <svg
                width={24}
                height={EDGE_WIDTH * 2}
                aria-hidden="true"
                className="shrink-0 overflow-visible"
              >
                <line
                  x1={0}
                  y1={EDGE_WIDTH}
                  x2={24}
                  y2={EDGE_WIDTH}
                  stroke={EDGE_STROKE}
                  strokeOpacity={EDGE_OPACITY}
                  strokeWidth={EDGE_WIDTH}
                  strokeDasharray={edge.dashed ? EDGE_DASH : undefined}
                />
              </svg>
              <Meta>{edge.label}</Meta>
            </li>
          ))}
        </KeyList>
      </div>
    </Card>
  );
}
