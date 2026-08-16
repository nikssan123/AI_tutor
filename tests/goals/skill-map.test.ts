import { describe, expect, it } from "vitest";
import { buildOutline } from "@/lib/goals/outline";
import { projectSkills } from "@/lib/goals/projection";
import { buildSkillMap, SKILL_MAP, wrapLabel } from "@/lib/goals/skill-map";
import type {
  EngineDependency,
  EngineSkill,
  EngineSkillGraph,
  MasteryState,
} from "@/lib/engine";

/**
 * The arithmetic behind the picture.
 *
 * It is tested here rather than through a render because all three faults the
 * module was written for are *positional* — a name cut mid-word, a layer left
 * against the margin, a straight line raked across the canvas — and none of
 * them are things a DOM assertion can see. What a render test can check is that
 * the numbers reach the SVG, which is `tests/components/skill-map.test.tsx`.
 */

const NOW = "2026-08-13T09:00:00.000Z";
const priors = { pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.25 };

function skill(
  id: string,
  name: string,
  overrides: Partial<EngineSkill> = {},
): EngineSkill {
  return {
    id,
    slug: id,
    name,
    level: "core",
    evalTier: 1,
    estimatedHours: 4,
    bktPriors: priors,
    canDoStatement: `Do ${name} correctly`,
    area: "craft",
    ...overrides,
  };
}

function dep(
  from: string,
  to: string,
  type: EngineDependency["type"] = "hard",
): EngineDependency {
  return { fromSkillId: from, toSkillId: to, type, strength: 1 };
}

/**
 * Three layers of unequal width, one soft edge, and two names long enough to
 * need wrapping — the shape every one of these assertions needs.
 */
const graph = (): EngineSkillGraph => ({
  skills: [
    skill("basics", "Basics", { level: "foundational" }),
    skill("framing", "Framing and edges", { level: "foundational" }),
    skill("metering", "Metering and the histogram"),
    skill("white-balance", "White balance and colour temperature"),
    skill("tonal", "Tonal correction", { level: "advanced" }),
  ],
  dependencies: [
    dep("basics", "metering"),
    dep("basics", "white-balance", "soft"),
    dep("metering", "tonal"),
  ],
});

function mapFor(mastery: MasteryState[] = []) {
  const g = graph();
  const outline = buildOutline({
    graph: g,
    mastery,
    now: NOW,
    projection: projectSkills({ graph: g, mastery, now: NOW }),
  });
  return buildSkillMap(g, outline);
}

function nodeNamed(map: ReturnType<typeof mapFor>, name: string) {
  return map.nodes.find((n) => n.name === name)!;
}

describe("wrapLabel", () => {
  /**
   * The regression this whole module exists for. The path screen drew labels
   * with `slice(0, 20)`, so "The exposure triangle" was printed as "The
   * exposure triangl" — fifteen names on one screen, every one of them looking
   * like a typo.
   */
  it("never cuts inside a word while there is a line to move it to", () => {
    const lines = wrapLabel("White balance and colour temperature", 21, 2);

    expect(lines).toEqual(["White balance and", "colour temperature"]);
    for (const line of lines) expect(line).not.toContain("…");
  });

  it("leaves a name that already fits exactly alone", () => {
    expect(wrapLabel("The exposure triangle", 21, 2)).toEqual([
      "The exposure triangle",
    ]);
  });

  it("packs as many words onto a line as fit", () => {
    expect(wrapLabel("Metering and the histogram", 21, 2)).toEqual([
      "Metering and the",
      "histogram",
    ]);
  });

  /** The one thing that does get cut: a single word wider than the box. */
  it("cuts a word longer than the box, and says it was cut", () => {
    const [line] = wrapLabel("Photogrammetryandbundleadjustment", 21, 2);

    expect(line).toBe("Photogrammetryandbun…");
    expect(line!.length).toBe(21);
  });

  it("marks a name that ran out of lines", () => {
    expect(wrapLabel("One two three four five six seven eight nine", 21, 2)).toEqual(
      ["One two three four", "five six seven eight…"],
    );
  });

  /**
   * A name that overflows *and* whose last line is itself a cut word gets one
   * ellipsis, not two — which is why the mark goes on before the clip rather
   * than after it.
   */
  it("never doubles the ellipsis", () => {
    const [line] = wrapLabel(
      "Supercalifragilisticexpialidocious and then some",
      21,
      1,
    );

    expect(line).toBe("Supercalifragilistic…");
    expect(line!.match(/…/g)).toHaveLength(1);
  });
});

describe("buildSkillMap", () => {
  it("places every skill and joins every dependency", () => {
    const map = mapFor();

    expect(map.nodes).toHaveLength(5);
    expect(map.edges).toHaveLength(3);
  });

  /**
   * The property `layoutGraph` exists to guarantee, carried through into
   * pixels: a skill is drawn strictly below everything it needs first, so the
   * screen can tell a learner to read it downwards and be telling the truth.
   */
  it("draws a skill below everything it needs first", () => {
    const map = mapFor();
    const at = new Map(map.nodes.map((n) => [n.skillId, n.y]));

    for (const edge of graph().dependencies) {
      expect(at.get(edge.toSkillId)!).toBeGreaterThan(
        at.get(edge.fromSkillId)!,
      );
    }
  });

  /**
   * Layers used to start at the left margin, so a layer of one sat in the
   * corner above a layer of five and every edge between them raked across the
   * whole picture. Each layer is centred on the canvas now.
   */
  it("centres each layer on the canvas", () => {
    const map = mapFor();
    const middle = map.width / 2;

    const byRow = new Map<number, number[]>();
    for (const node of map.nodes) {
      byRow.set(node.y, [...(byRow.get(node.y) ?? []), node.x]);
    }

    for (const xs of byRow.values()) {
      const left = Math.min(...xs);
      const right = Math.max(...xs) + SKILL_MAP.nodeWidth;
      expect((left + right) / 2).toBeCloseTo(middle, 0);
    }
  });

  it("leaves the padding it claims on every side", () => {
    const map = mapFor();
    const lowest = Math.max(...map.nodes.map((n) => n.y));

    expect(Math.min(...map.nodes.map((n) => n.x))).toBe(SKILL_MAP.padding);
    expect(Math.min(...map.nodes.map((n) => n.y))).toBe(SKILL_MAP.padding);
    expect(map.height - (lowest + SKILL_MAP.nodeHeight)).toBe(
      SKILL_MAP.padding,
    );
  });

  /**
   * The curve leaves the bottom of the prerequisite and arrives at the top of
   * what it unlocks, vertically at both ends — which is what makes a dozen of
   * them converging on one box still readable.
   */
  it("curves from the bottom of the prerequisite to the top of the skill", () => {
    const map = mapFor();
    const from = nodeNamed(map, "Basics");
    const to = nodeNamed(map, "Metering and the histogram");
    const edge = map.edges.find((e) => e.key === "basics->metering")!;

    const x1 = from.x + SKILL_MAP.nodeWidth / 2;
    const x2 = to.x + SKILL_MAP.nodeWidth / 2;
    const y1 = from.y + SKILL_MAP.nodeHeight;
    const bend = (to.y - y1) / 2;

    expect(edge.path).toBe(
      `M${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${to.y - bend}, ${x2} ${to.y}`,
    );
  });

  it("flags a soft prerequisite and leaves a hard one alone", () => {
    const map = mapFor();

    expect(map.edges.find((e) => e.key === "basics->white-balance")!.soft).toBe(
      true,
    );
    expect(map.edges.find((e) => e.key === "basics->metering")!.soft).toBe(
      false,
    );
  });

  /**
   * The picture reads its states off the outline rather than re-deriving them,
   * which is the only way the two halves of the screen can be guaranteed to
   * agree about the same skill.
   */
  it("takes every state from the outline", () => {
    const map = mapFor();

    expect(nodeNamed(map, "Basics").state).toBe("open");
    expect(nodeNamed(map, "Metering and the histogram").state).toBe("locked");

    const proved: MasteryState = {
      skillId: "basics",
      mastery: 0.95,
      confidence: 0.8,
      evidenceCount: 3,
      lastSuccessAt: NOW,
      lastPracticedAt: NOW,
      decayHalfLifeDays: 180,
    };
    const after = mapFor([proved]);

    expect(nodeNamed(after, "Basics").state).toBe("proved");
    expect(nodeNamed(after, "Metering and the histogram").state).toBe("open");
  });

  /** SVG positions text by its baseline, so one line and two must differ. */
  it("centres the label block in the box whether it is one line or two", () => {
    const map = mapFor();
    const one = nodeNamed(map, "Basics");
    const two = nodeNamed(map, "Metering and the histogram");

    const middleOf = (
      node: (typeof map.nodes)[number],
    ) =>
      node.labelY +
      ((node.lines.length - 1) * SKILL_MAP.lineHeight) / 2 -
      node.y;

    expect(one.lines).toHaveLength(1);
    expect(two.lines).toHaveLength(2);
    expect(middleOf(one)).toBeCloseTo(middleOf(two), 5);
  });

  it("keeps the full name for the node's own tooltip", () => {
    const node = nodeNamed(mapFor(), "White balance and colour temperature");

    expect(node.name).toBe("White balance and colour temperature");
    expect(node.lines.join(" ")).toBe(node.name);
  });
});
