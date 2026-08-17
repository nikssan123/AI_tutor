import type {
  DraftCriterion,
  DraftEvidence,
  DraftSkill,
} from "@/lib/contracts/pack";
import { MAX_SLUG_LENGTH, type EvalTier, type PackSkill, type Workspace } from "../types";

type Priors = PackSkill["bktPriors"];

/**
 * Everything about a generated pack that is computed rather than asked for.
 *
 * The dividing line: a model is asked what a subject's skills *are* and what
 * good work looks like; it is never asked for a slug, a probability, a tier, or
 * a set of numbers that has to sum to 1. Those are the outputs models are worst
 * at and the ones `validatePack` blocks on, so asking would guarantee a repair
 * loop that arithmetic avoids entirely.
 */

/* ── Slugs ────────────────────────────────────────────────────────────────── */

/**
 * A pack-safe slug from a display name.
 *
 * Must satisfy the `slug` rule in `types.ts`: lowercase, hyphen-separated, no
 * leading or trailing hyphen, 2–64 characters. Diacritics are folded rather
 * than stripped so "Séparation" becomes "separation" and not "sparation".
 */
export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  /*
   * A name of nothing but punctuation reduces to "", which fails the schema's
   * 2-character minimum. It falls back to a fixed word rather than to a
   * prefixed one: `skill-${base}` with an empty base is "skill-", and a
   * trailing hyphen is the one thing the slug rule explicitly forbids.
   * `uniqueSlugs` handles two such names colliding.
   */
  return base.length >= 2 ? base : "skill";
}

/**
 * Slugs for a list of names, made unique by suffixing collisions.
 *
 * Two skills called "Joins" and "JOINs" both slugify to `joins`, and the pack
 * validator rejects duplicate slugs — correctly, since the engine keys on them.
 * Disambiguating here keeps that a naming quirk rather than a failed generation.
 */
export function uniqueSlugs(names: string[]): Map<string, string> {
  const used = new Set<string>();
  const bySource = new Map<string, string>();

  for (const name of names) {
    // A repeated *name* is the same skill mentioned twice; it maps to the slug
    // already assigned rather than to a second one.
    if (bySource.has(name)) continue;

    const base = slugify(name);
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      // Room reserved for the suffix rather than a hard-coded 60. The same
      // arithmetic left implicit is what let item slugs run two characters
      // over the cap and cost a whole generation — see `numberedSlug`.
      const tail = `-${n}`;
      slug = `${base.slice(0, MAX_SLUG_LENGTH - tail.length)}${tail}`;
      n += 1;
    }

    used.add(slug);
    bySource.set(name, slug);
  }

  return bySource;
}

/**
 * `<base>-<n>`, guaranteed to satisfy the slug rule however long the base is.
 *
 * **The 297¢ bug.** Item slugs were built as a bare `` `${skill}-${n}` ``, with
 * a comment reasoning carefully about why they could not *repeat* and nothing
 * at all about how long they could get. `slugify` caps a skill at exactly
 * `MAX_SLUG_LENGTH`, so any skill near the cap produced a 65- or 66-character
 * item slug, `DomainPackSchema` refused the pack, and the four model calls that
 * had produced it were thrown away — three times over, because the throw looked
 * transient to the queue. A subject with long skill names (".NET development")
 * was all it took.
 *
 * Trimming alone is not enough: two skills sharing their first sixty characters
 * would collide once the tail is cut off. So the suffix is reserved first and
 * a collision widens it, which is `uniqueSlugs`' rule applied to a name that
 * has a number on the end.
 */
export function numberedSlug(
  base: string,
  n: number,
  used: Set<string>,
): string {
  const fit = (tail: string) =>
    `${base.slice(0, MAX_SLUG_LENGTH - tail.length).replace(/-+$/g, "")}${tail}`;

  let slug = fit(`-${n}`);
  for (let extra = 2; used.has(slug); extra += 1) {
    slug = fit(`-${extra}-${n}`);
  }

  used.add(slug);
  return slug;
}

/**
 * The reference a later call uses to point at a skill from the graph.
 *
 * Short, opaque, and impossible to tidy. Asking a model to echo a prose name
 * back "exactly as given" does not work: told `- Build and run a Cargo project
 * (foundational)`, the item author returns the skill as *"Build and run a Cargo
 * project (foundational)"* — level included — and every item for that skill is
 * dropped as naming a skill that does not exist. That cost two full generations
 * before the drop log was read, and no amount of prompt insistence fixes it,
 * because the model is copying exactly what it was shown.
 *
 * `s0`, `s1`, `s2` have nothing to tidy.
 */
export function skillRef(index: number): string {
  return `s${index}`;
}

/**
 * Resolves a name the model wrote later against the names it wrote earlier.
 *
 * The item and rubric calls are told to name skills "exactly as given", and
 * they nearly do — but a graph skill called "Ownership, moves and \`Copy\`" comes
 * back from the item author as "Ownership, moves and Copy", and an exact-match
 * lookup drops every item for it. That is not a hallucinated skill, it is the
 * same skill with the punctuation tidied, and treating the two as different
 * cost a whole generation before the drop log was read.
 *
 * Matching on the slugified form folds exactly the differences that turn up in
 * practice — punctuation, backticks, case, spacing — while still refusing a
 * name that genuinely is not in the graph.
 */
export function nameResolver(
  slugOf: Map<string, string>,
  /** Reference → slug, when the caller handed the model references to quote. */
  refs: Map<string, string> = new Map(),
): (name: string) => string | undefined {
  const loose = new Map<string, string>();
  for (const [name, slug] of slugOf) {
    // First writer wins, so a real collision cannot silently steal a mapping.
    if (!loose.has(slugify(name))) loose.set(slugify(name), slug);
  }

  return (value) =>
    refs.get(value.trim()) ?? slugOf.get(value) ?? loose.get(slugify(value));
}

/* ── BKT priors ───────────────────────────────────────────────────────────── */

/**
 * Priors per skill level, seeded from the curated packs' own calibration.
 *
 * §16 wants these "expert-seeded, refit from your own data once you have ~500
 * observations per skill". These are the averages of the hand-authored values
 * across the three curated packs, which makes a generated pack start from the
 * same beliefs an author would have written rather than from a model's guess at
 * a probability. The monotonicity is the point: a foundational skill is more
 * likely to be already known and easier to guess than a specialist one.
 */
export const PRIORS_BY_LEVEL: Record<DraftSkill["level"], Priors> = {
  foundational: { pInit: 0.22, pLearn: 0.2, pSlip: 0.11, pGuess: 0.15 },
  core: { pInit: 0.15, pLearn: 0.18, pSlip: 0.12, pGuess: 0.11 },
  advanced: { pInit: 0.08, pLearn: 0.16, pSlip: 0.13, pGuess: 0.07 },
  specialist: { pInit: 0.05, pLearn: 0.13, pSlip: 0.15, pGuess: 0.04 },
};

/* ── Evaluation tiers ─────────────────────────────────────────────────────── */

/**
 * The strongest tier a *generated* pack is allowed to claim, by workspace.
 *
 * §7.2 tier 1 is "execute + assert against expected behaviour", and its licensed
 * claim is *"Verified: this works."* A generated pack has no evaluator config,
 * no test harness and no human review, so it cannot execute anything — which
 * makes tier 1 a claim it is structurally incapable of honouring. Code caps it
 * rather than trusting a prompt not to ask for it, because §4.2 law 3 (never
 * claim more than the evidence supports) is exactly what the Generated tier is
 * most likely to break.
 *
 * A curated pack in the same workspace may still be tier 1. The difference is
 * that a person built and checked its evaluator.
 */
export const MAX_GENERATED_TIER: Record<Workspace, EvalTier> = {
  code: 2,
  "query-sheet": 2,
  text: 2,
  media: 3,
  audio: 4,
  conversation: 4,
};

/** §7.2 tier 5 — self-report only, and it can never raise mastery. */
export const SELF_REPORT_TIER: EvalTier = 5;

export function tierFor(workspace: Workspace, selfReportOnly: boolean): EvalTier {
  return selfReportOnly ? SELF_REPORT_TIER : MAX_GENERATED_TIER[workspace];
}

/* ── Rubric weights ───────────────────────────────────────────────────────── */

/**
 * Criterion weights normalised to sum to exactly 1.
 *
 * `validatePack` blocks a rubric whose weights are off by more than 0.001, and
 * a model asked for four numbers summing to 1 returns 0.3/0.3/0.2/0.25 often
 * enough that it is not worth asking. It is asked for *relative* importance
 * instead, which it is good at, and the division happens here.
 *
 * The final weight absorbs the rounding remainder so the sum is exact rather
 * than 0.9999999999999999 — floating point, not the model, would fail the check.
 */
export function normaliseWeights(criteria: DraftCriterion[]): number[] {
  const total = criteria.reduce((sum, c) => sum + c.weight, 0);

  const weights = criteria.map((c) => Math.round((c.weight / total) * 1000) / 1000);
  const drift = 1 - weights.reduce((sum, w) => sum + w, 0);
  weights[weights.length - 1] = +(weights[weights.length - 1]! + drift).toFixed(6);

  return weights;
}

/* ── Evidence ─────────────────────────────────────────────────────────────── */

/**
 * §24 E8.5's three rules, applied to the draft before it becomes a pack.
 *
 * `validatePack` states them and blocks on them; this is where a generated pack
 * comes to satisfy them, which is what keeps `meetsQualityFloor`'s claim true —
 * assembly produces packs that pass every blocking rule rather than packs that
 * happen to. The model is asked what it knows (does this work need a
 * photograph, and does this criterion judge one) and its answer is then made
 * consistent, exactly as `normaliseWeights` does above.
 *
 * Every repair is recorded. A silently demoted brief is a brief that stopped
 * asking for the photograph its rubric was written around, and nobody would
 * know which pass did it.
 */
export interface EvidenceReconciliation {
  /**
   * By rubric index, then criterion index — **positions, not names.**
   *
   * `uniqueSlugs` exists in this file because two rubrics, two projects or two
   * criteria in one draft can share a display name; a map keyed by name would
   * silently merge them and settle both from whichever came last.
   */
  marks: DraftCriterion["marks"][][];
  /** By project index. `image` demoted where rule 3 bites, `images` clamped. */
  evidence: DraftEvidence[];
  notes: string[];
}

interface ReconcileInput {
  projects: Array<{ title: string; rubric: string; evidence: DraftEvidence }>;
  rubrics: Array<{
    name: string;
    criteria: Array<{
      name: string;
      weight: number;
      marks: DraftCriterion["marks"];
    }>;
  }>;
}

export function reconcileEvidence(
  input: ReconcileInput,
  maxImages: number,
): EvidenceReconciliation {
  const notes: string[] = [];

  /*
   * Rule 1 asks whether "its project" accepts images, and a rubric can be named
   * by more than one project. The strict reading is the only one with a single
   * answer: a rubric may judge a photograph only if *every* project handing work
   * in against it asks for one. A rubric named by no project judges none,
   * because nothing will ever be submitted against it.
   */
  const takesImages = (name: string): boolean => {
    const users = input.projects.filter((p) => p.rubric === name);
    return users.length > 0 && users.every((p) => p.evidence.image !== "none");
  };

  const marks = input.rubrics.map((rubric) => {
    const allowed = takesImages(rubric.name);

    const settled = rubric.criteria.map((c) => {
      // Rule 1 — nothing to look at, so nothing may claim to have looked.
      if (!allowed && c.marks !== "text") {
        notes.push(
          `criterion "${c.name}" in rubric "${rubric.name}" judged a photograph its project does not ask for; it reads the write-up instead`,
        );
        return "text" as const;
      }
      return c.marks;
    });

    /*
     * Rule 2 — every rubric keeps something the verifier can anchor to.
     *
     * `both` counts, and that is a reading of the rule rather than a softening
     * of it. What rule 2 protects is §14.5's deterministic quote check having
     * real text to run against, and a `both` criterion quotes the write-up like
     * any other. The unmarkable rubric is the one where *nothing* reads the
     * write-up, and the repair is the smallest that fixes it: the criterion
     * carrying the most weight starts reading both.
     */
    // `some`, not `!every`: TypeScript infers a type predicate from the arrow
    // and `every` would narrow `settled` to `"image"[]`, making the repair
    // below unassignable to the array it is repairing.
    const anchored = settled.some((m) => m !== "image");

    if (settled.length > 0 && !anchored) {
      const heaviest = rubric.criteria.reduce(
        (best, c, i) => (c.weight > rubric.criteria[best]!.weight ? i : best),
        0,
      );
      settled[heaviest] = "both";
      notes.push(
        `rubric "${rubric.name}" read nothing from the write-up, leaving no quote to check; "${rubric.criteria[heaviest]!.name}" now reads both`,
      );
    }

    return settled;
  });

  const evidence = input.projects.map((project) => {
    const index = input.rubrics.findIndex((r) => r.name === project.rubric);
    const looksAtImage = (marks[index] ?? []).some((m) => m !== "text");

    let image = project.evidence.image;

    // Rule 3 — a brief may not demand a photograph that changes no band. The
    // same defect as a targeted skill no criterion assesses, in other clothes.
    if (image === "required" && !looksAtImage) {
      notes.push(
        `project "${project.title}" required a photograph no criterion in "${project.rubric}" judges; asked for as optional instead`,
      );
      image = "optional";
    }

    const images = Math.min(project.evidence.images, maxImages);
    if (images !== project.evidence.images) {
      notes.push(
        `project "${project.title}" asked for ${project.evidence.images} photographs; capped at ${maxImages}`,
      );
    }

    return { image, images };
  });

  return { marks, evidence, notes };
}
