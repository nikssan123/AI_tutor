import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import {
  learnerProfile,
  learnerSkillMastery,
  learningGoal,
  skill as skillTable,
} from "@/db/schema";
import { packId, skillId } from "@/lib/packs/ids";
import { GoalSpec } from "@/lib/contracts/goal";
import type { MasteryState } from "@/lib/engine";

/**
 * Persistence for a learner's goal and their mastery state.
 *
 * The seam this file defends: **the engine works in slug space, the database
 * works in UUID space.** Packs reference each other by slug, and the planner,
 * the diagnostic and the projection all key on `skill.slug`; the database keys
 * on a UUID derived deterministically from the pack and skill slugs (see
 * `packs/ids.ts`). Converting in exactly one place means neither side has to
 * know the other exists, and it means a mastery row written by the Skill Check
 * lines up with one written by an evaluation three months later.
 */

export interface StoredGoal {
  id: string;
  packSlug: string;
  spec: GoalSpec;
  createdAt: Date;
}

export interface NewGoal {
  userId: string;
  packSlug: string;
  spec: GoalSpec;
  /** Seeded mastery in slug space — typically replayed from a Skill Check. */
  mastery: MasteryState[];
  now: Date;
}

function toDate(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * Creates the goal and everything a first `/today` needs to plan against, in
 * one transaction: a profile carrying the weekly budget, the goal itself, and
 * whatever mastery the learner has already evidenced.
 *
 * Mastery is upserted rather than inserted because a learner can start a second
 * goal in a pack they have history in, and that history is theirs — it belongs
 * to the `(userId, skillId)` pair, not to the goal.
 */
export async function createGoal(db: Db, input: NewGoal): Promise<string> {
  const spec = GoalSpec.parse(input.spec);
  const goalId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx
      .insert(learnerProfile)
      .values({
        userId: input.userId,
        weeklyHours: spec.weeklyHours,
        motivation: spec.motivation,
        constraints: spec.constraints,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: learnerProfile.userId,
        set: {
          weeklyHours: spec.weeklyHours,
          motivation: spec.motivation,
          constraints: spec.constraints,
          updatedAt: input.now,
        },
      });

    await tx.insert(learningGoal).values({
      id: goalId,
      userId: input.userId,
      packId: packId(input.packSlug),
      rawGoalText: spec.rawGoal,
      goalSpec: spec,
      targetOutcome: spec.targetOutcome,
      deadline: spec.deadline,
      status: "active",
      createdAt: input.now,
    });

    for (const state of input.mastery) {
      const row = {
        userId: input.userId,
        skillId: skillId(input.packSlug, state.skillId),
        mastery: state.mastery,
        confidence: state.confidence,
        evidenceCount: state.evidenceCount,
        lastSuccessAt: toDate(state.lastSuccessAt),
        lastPracticedAt: toDate(state.lastPracticedAt),
        decayHalfLifeDays: state.decayHalfLifeDays,
        updatedAt: input.now,
      };

      await tx
        .insert(learnerSkillMastery)
        .values(row)
        .onConflictDoUpdate({
          target: [learnerSkillMastery.userId, learnerSkillMastery.skillId],
          set: row,
        });
    }
  });

  return goalId;
}

/**
 * The goal `/today` plans against. Newest active goal wins; multiple concurrent
 * goals are a real product question (§8 screen 6 shows one card) and this is the
 * answer until that question is asked properly.
 */
export async function activeGoal(
  db: Db,
  userId: string,
): Promise<StoredGoal | undefined> {
  const rows = await db
    .select({
      id: learningGoal.id,
      goalSpec: learningGoal.goalSpec,
      createdAt: learningGoal.createdAt,
    })
    .from(learningGoal)
    .where(
      and(eq(learningGoal.userId, userId), eq(learningGoal.status, "active")),
    )
    .orderBy(desc(learningGoal.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  // A goal whose spec no longer parses is a goal we cannot plan against, and
  // guessing at the missing fields would produce a plan the learner never
  // asked for. Treated as absent so `/today` offers to set one up again.
  const spec = GoalSpec.safeParse(row.goalSpec);
  if (!spec.success) return undefined;

  return {
    id: row.id,
    packSlug: spec.data.domain,
    spec: spec.data,
    createdAt: row.createdAt,
  };
}

/** §16.1's `availableMinutes`. Falls back to the column default (§15). */
export const DEFAULT_SESSION_MINUTES = 30;

export async function sessionMinutesFor(
  db: Db,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ minutes: learnerProfile.preferredSessionLength })
    .from(learnerProfile)
    .where(eq(learnerProfile.userId, userId))
    .limit(1);

  return rows[0]?.minutes ?? DEFAULT_SESSION_MINUTES;
}

/**
 * One skill's mastery, written back after an observation.
 *
 * Upsert rather than update: a skill can be observed for the first time in a
 * session — the diagnostic only seeds the skills it actually asked about — and
 * an update that matched no row would drop the evidence silently.
 */
export async function upsertMastery(
  db: Db,
  userId: string,
  packSlug: string,
  state: MasteryState,
  now: Date,
): Promise<void> {
  const row = {
    userId,
    skillId: skillId(packSlug, state.skillId),
    mastery: state.mastery,
    confidence: state.confidence,
    evidenceCount: state.evidenceCount,
    lastSuccessAt: toDate(state.lastSuccessAt),
    lastPracticedAt: toDate(state.lastPracticedAt),
    decayHalfLifeDays: state.decayHalfLifeDays,
    updatedAt: now,
  };

  await db
    .insert(learnerSkillMastery)
    .values(row)
    .onConflictDoUpdate({
      target: [learnerSkillMastery.userId, learnerSkillMastery.skillId],
      set: row,
    });
}

/**
 * Mastery for one pack, translated back into the slug space the engine reads.
 *
 * Joined against `skill` rather than recomputing UUIDs, because the join is
 * what proves the row still points at a skill that exists — a pack edit that
 * removes a skill leaves rows behind, and they must not reappear as a mystery
 * entry in someone's plan.
 */
export async function masteryFor(
  db: Db,
  userId: string,
  packSlug: string,
): Promise<MasteryState[]> {
  const rows = await db
    .select({
      slug: skillTable.slug,
      mastery: learnerSkillMastery.mastery,
      confidence: learnerSkillMastery.confidence,
      evidenceCount: learnerSkillMastery.evidenceCount,
      lastSuccessAt: learnerSkillMastery.lastSuccessAt,
      lastPracticedAt: learnerSkillMastery.lastPracticedAt,
      decayHalfLifeDays: learnerSkillMastery.decayHalfLifeDays,
    })
    .from(learnerSkillMastery)
    .innerJoin(skillTable, eq(skillTable.id, learnerSkillMastery.skillId))
    .where(
      and(
        eq(learnerSkillMastery.userId, userId),
        eq(skillTable.packId, packId(packSlug)),
      ),
    );

  return rows
    .map((row) => ({
      skillId: row.slug,
      mastery: row.mastery,
      confidence: row.confidence,
      evidenceCount: row.evidenceCount,
      lastSuccessAt: toIso(row.lastSuccessAt),
      lastPracticedAt: toIso(row.lastPracticedAt),
      decayHalfLifeDays: row.decayHalfLifeDays,
    }))
    .sort((a, b) => a.skillId.localeCompare(b.skillId));
}
