import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { createClient } from "@/db";
import {
  learningGoal,
  learningSession,
  session as sessionTable,
  user as userTable,
} from "@/db/schema";
import { findPack } from "@/lib/content";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { createGoal, upsertMastery } from "@/lib/goals/store";
import { scheduleRetrieval } from "@/lib/session/store";
import { saveCurriculum } from "@/lib/curriculum/store";
import { createSubmission, recordEvaluation } from "@/lib/submissions/store";
import type { GradedResult } from "@/lib/evaluation";
import type { MasteryState } from "@/lib/engine";

/**
 * Puts a learner in front of `/calendar` with every state it can draw, so the
 * grid can be looked at rather than only asserted on.
 *
 * The same argument as `mastery-screens-fixture.ts`: a green suite is not a
 * rendered page, and this screen is the first one in the product that is a
 * picture rather than a column of sentences. Nothing here calls a model, so
 * driving it costs nothing.
 *
 * What it sets up, deliberately one of each:
 *   · a run of kept weeks, and a current week that is not there yet
 *   · worked days scattered through the month
 *   · a retrieval item already overdue, and two still to come
 *   · a claim with a short half-life, so it has a date it stops counting on
 *   · a path whose checkpoints land either side of the deadline
 *
 *   pnpm tsx scripts/calendar-screen-fixture.ts
 */

/**
 * The learner this seeds. Overridable so the screen can also be driven through
 * a real sign-in — the printed cookie is the fast path, and an account you can
 * actually log into is the one that proves the chrome around the page works.
 */
const USER_ID = process.env.FIXTURE_USER_ID ?? "calendar-probe-user";
const EMAIL = "calendar-probe@example.com";
/**
 * The same pack `mastery-screens-fixture.ts` uses, and not by taste:
 * `tests/packs/seed.test.ts` clears every pack except this one on the way out,
 * so a fixture goal against any other pack blocks that delete on a foreign key
 * and fails a suite that has nothing to do with this screen.
 */
const PACK = "sql-data-analysis";
const TOKEN = "calendar-probe-session-token";

const DAY = 86_400_000;

const graded = (): GradedResult => ({
  overall: 0.82,
  confidence: 0.8,
  evalTier: 2,
  verification: {
    upheld: [],
    invalidated: [],
    missing: [],
    passed: true,
    quotedWeight: 1,
    located: [],
  },
  criteria: [
    {
      criterionId: "grain",
      name: "Grain",
      band: "strong",
      evidence: "GROUP BY customer_id, month",
      locator: null,
      marks: "text",
      reasoning: "the grain matches the question asked",
      weight: 1,
    },
  ],
  strengths: ["kept the grain straight"],
  gaps: [],
  nextActions: [],
  bandSpread: 0,
  humanReview: false,
  observation: { correct: true, confidence: 0.8, evidenceTier: 2 },
});

async function main() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");

  const { db, close } = createClient(process.env.DATABASE_URL!, 2);
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const iso = (date: Date) => date.toISOString().slice(0, 10);

  const pack = findPack(PACK)!;
  await seedPack(db, loadPack(`packs/${PACK}`));

  const project = pack.projects[0]!;
  const [first, second, third, fourth] = pack.skills;

  // An account handed in from outside already has a password on it, and
  // dropping the row would take that with it. Its goals still go, so a re-run
  // is the same screen rather than a pile of them.
  if (process.env.FIXTURE_USER_ID === undefined) {
    await db.delete(userTable).where(eq(userTable.id, USER_ID));
    await db.insert(userTable).values({
      id: USER_ID,
      name: "Calendar Probe",
      email: EMAIL,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db.delete(learningGoal).where(eq(learningGoal.userId, USER_ID));
  }
  // The token is unique, so a re-run replaces its session rather than failing.
  await db.delete(sessionTable).where(eq(sessionTable.token, TOKEN));
  await db.insert(sessionTable).values({
    id: crypto.randomUUID(),
    userId: USER_ID,
    token: TOKEN,
    expiresAt: new Date(now.getTime() + DAY),
    createdAt: now,
    updatedAt: now,
  });

  const goalId = await createGoal(db, {
    userId: USER_ID,
    packSlug: PACK,
    spec: {
      rawGoal: "I want to answer revenue questions with SQL myself",
      domain: PACK,
      targetOutcome: "Correct aggregate queries over a real schema",
      outcomeType: "career",
      statedLevel: "beginner",
      weeklyHours: 3,
      // Close enough that the projected work runs past it, which is the
      // warning worth looking at.
      deadline: iso(new Date(now.getTime() + 35 * DAY)),
      motivation: "I keep having to ask the data team for numbers",
      constraints: [],
      existingAssets: [],
      priorDomain: "none",
      depth: "standard",
      clarity: 0.9,
    },
    mastery: [],
    now,
  });

  /** Two kept weeks behind a week that is not there yet. */
  const days: Array<[number, number]> = [
    [2, 45],
    [9, 120],
    [11, 80],
    [16, 100],
    [18, 95],
    [24, 55],
  ];
  for (const [daysAgo, minutes] of days) {
    await db.insert(learningSession).values({
      userId: USER_ID,
      goalId,
      startedAt: ago(daysAgo),
      completedAt: ago(daysAgo),
      blocks: [],
      durationMinutes: minutes,
    });
  }

  // One already waiting, two still to come.
  const queued: Array<[string, string, number]> = [
    [first!.slug, "select-alias-basic", -3],
    [second!.slug, "filter-and-or-precedence", 2],
    [third!.slug, "sort-nondeterministic-limit", 6],
  ];
  for (const [skillSlug, itemSlug, inDays] of queued) {
    await scheduleRetrieval(db, {
      userId: USER_ID,
      packSlug: PACK,
      skillSlug,
      itemSlug,
      succeeded: true,
      halfLifeDays: inDays,
      now,
    });
  }

  // A claim with a hand-in behind it and a short half-life, so it has a date.
  const prior: MasteryState = {
    skillId: first!.slug,
    mastery: 0.94,
    confidence: 0.8,
    evidenceCount: 2,
    lastSuccessAt: ago(1).toISOString(),
    lastPracticedAt: ago(1).toISOString(),
    decayHalfLifeDays: 7,
  };

  const submissionId = await createSubmission(db, {
    userId: USER_ID,
    packSlug: PACK,
    projectSlug: project.slug,
    artefact: "SELECT customer_id, date_trunc('month', ordered_at) …",
    truncated: false,
    skillSlug: first!.slug,
    now: ago(2),
  });
  await recordEvaluation(db, {
    submissionId,
    userId: USER_ID,
    packSlug: PACK,
    rubricSlug: project.rubric,
    rubricVersion: 1,
    skill: first!,
    mastery: prior,
    result: graded(),
    model: "claude-opus-5",
    promptVersion: "fixture",
    now: ago(2),
  });
  await upsertMastery(db, USER_ID, PACK, prior, now);

  await saveCurriculum(db, {
    goalId,
    packSlug: PACK,
    draft: {
      modules: [
        {
          order: 0,
          title: "Filtering without losing rows you meant to keep",
          targetSkillIds: [second!.slug],
          estimatedHours: 4,
          outputArtifact: "none",
          acceptanceCriteria: [],
          rubricId: null,
        },
        {
          order: 1,
          title: "A funnel that survives being questioned",
          targetSkillIds: [third!.slug],
          estimatedHours: 5,
          outputArtifact: "project",
          acceptanceCriteria: ["one query, one grain"],
          rubricId: project.rubric,
        },
        {
          order: 2,
          title: "A cohort table that argues for itself",
          targetSkillIds: [fourth!.slug],
          estimatedHours: 6,
          outputArtifact: "document",
          acceptanceCriteria: ["the table, and a paragraph on why"],
          rubricId: null,
        },
      ],
      totalHours: 15,
      rationale: "shortest path to a number you can defend",
    },
    report: null,
    source: "generated",
    now,
  });

  const signature = createHmac("sha256", secret).update(TOKEN).digest("base64");
  const cookie = encodeURIComponent(`${TOKEN}.${signature}`);

  console.log(`goal:     ${goalId}`);
  console.log(`claim:    ${first!.slug} (stops counting in a few days)`);
  console.log(`\nurl:      http://localhost:3000/calendar`);
  console.log(`cookie:   better-auth.session_token=${cookie}`);

  await close();
}

void main();
