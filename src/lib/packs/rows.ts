import { itemId, packId, projectId, resourceId, rubricId, skillId } from "./ids";
import type { DomainPack } from "./types";

/**
 * Pure mapping from a pack to database rows.
 *
 * Kept separate from the seeder so the interesting half — slug resolution,
 * defaults, deterministic ids — is testable with no database, and the half that
 * touches Postgres stays small enough to read in one go.
 */

export interface PackRows {
  pack: {
    id: string;
    slug: string;
    name: string;
    taxonomyParent: string | null;
    maturity: string;
    evalTier: number;
    workspace: string;
    version: number;
    evaluatorConfig: Record<string, unknown>;
    qualityStatus: string;
    qualityScore: number | null;
    reviewedBy: string | null;
    reviewKind: string | null;
    reviewedAt: Date | null;
  };
  skills: Array<{
    id: string;
    packId: string;
    slug: string;
    name: string;
    description: string;
    level: string;
    area: string;
    evalTier: number;
    estimatedHours: number;
    bktPriors: Record<string, number>;
    canDoStatement: string;
    observableEvidence: string[];
  }>;
  dependencies: Array<{
    fromSkillId: string;
    toSkillId: string;
    type: string;
    strength: number;
  }>;
  items: Array<{
    id: string;
    packId: string;
    skillId: string;
    slug: string;
    type: string;
    prompt: string;
    answerFormat: string;
    options: string[] | null;
    answerKey: unknown;
    difficulty: number;
    discrimination: number;
  }>;
  rubrics: Array<{
    id: string;
    packId: string;
    slug: string;
    version: number;
    criteria: unknown;
    isPublic: boolean;
  }>;
  projects: Array<{
    id: string;
    packId: string;
    slug: string;
    title: string;
    brief: string;
    rubricId: string;
    evidenceType: string;
    difficulty: number;
    targetSkillIds: string[];
    acceptanceCriteria: string[];
    estimatedMinutes: number;
    isPublic: boolean;
  }>;
  resources: Array<{
    id: string;
    packId: string;
    slug: string;
    url: string;
    title: string;
    publisher: string;
    kind: string;
    skillIds: string[];
    assessment: string;
    publishedAt: string | null;
    checkedAt: Date | null;
    reachable: boolean;
  }>;
}

export function toRows(pack: DomainPack): PackRows {
  const id = packId(pack.slug);
  const skill = (slug: string) => skillId(pack.slug, slug);

  return {
    pack: {
      id,
      slug: pack.slug,
      name: pack.name,
      taxonomyParent: pack.taxonomyParent,
      maturity: pack.maturity,
      evalTier: pack.evalTier,
      workspace: pack.workspace,
      version: pack.version,
      evaluatorConfig: pack.evaluatorConfig,
      qualityStatus: pack.quality.status,
      qualityScore: pack.quality.score,
      reviewedBy: pack.quality.reviewedBy,
      reviewKind: pack.quality.reviewKind,
      reviewedAt: pack.quality.reviewedAt
        ? new Date(pack.quality.reviewedAt)
        : null,
    },
    skills: pack.skills.map((s) => ({
      id: skill(s.slug),
      packId: id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      level: s.level,
      area: s.area,
      evalTier: s.evalTier,
      estimatedHours: s.estimatedHours,
      bktPriors: s.bktPriors,
      canDoStatement: s.canDoStatement,
      observableEvidence: s.observableEvidence,
    })),
    dependencies: pack.dependencies.map((d) => ({
      fromSkillId: skill(d.from),
      toSkillId: skill(d.to),
      type: d.type,
      strength: d.strength,
    })),
    items: pack.items.map((i) => ({
      id: itemId(pack.slug, i.slug),
      packId: id,
      skillId: skill(i.skill),
      slug: i.slug,
      type: i.type,
      prompt: i.prompt,
      answerFormat: i.answerFormat,
      options: i.options ?? null,
      answerKey: i.answerKey ?? null,
      difficulty: i.difficulty,
      discrimination: i.discrimination,
    })),
    rubrics: pack.rubrics.map((r) => ({
      id: rubricId(pack.slug, r.slug),
      packId: id,
      slug: r.slug,
      version: r.version,
      criteria: r.criteria,
      isPublic: r.isPublic,
    })),
    projects: pack.projects.map((p) => ({
      id: projectId(pack.slug, p.slug),
      packId: id,
      slug: p.slug,
      title: p.title,
      brief: p.brief,
      rubricId: rubricId(pack.slug, p.rubric),
      evidenceType: p.evidenceType,
      difficulty: p.difficulty,
      targetSkillIds: p.targetSkills.map(skill),
      acceptanceCriteria: p.acceptanceCriteria,
      estimatedMinutes: p.estimatedMinutes,
      isPublic: p.isPublic,
    })),
    resources: pack.resources.map((r) => ({
      id: resourceId(pack.slug, r.slug),
      packId: id,
      slug: r.slug,
      url: r.url,
      title: r.title,
      publisher: r.publisher,
      kind: r.kind,
      skillIds: r.skills.map(skill),
      assessment: r.assessment,
      publishedAt: r.publishedAt,
      // The column is an instant and the pack carries an ISO string, the same
      // conversion `quality.reviewedAt` makes two fields up.
      checkedAt: r.checkedAt ? new Date(r.checkedAt) : null,
      reachable: r.reachable,
    })),
  };
}
