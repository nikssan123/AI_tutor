import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { createClient } from "@/db";
import {
  learningSession,
  session as sessionTable,
  user as userTable,
} from "@/db/schema";
import { findPack } from "@/lib/content";
import { loadPack } from "@/lib/packs/loader";
import { seedPack } from "@/lib/packs/seed";
import { createGoal, upsertMastery } from "@/lib/goals/store";
import { recordMasteryUpdate } from "@/lib/session/store";
import { createSubmission, recordEvaluation } from "@/lib/submissions/store";
import type { GradedResult } from "@/lib/evaluation";
import type { MasteryState } from "@/lib/engine";

/**
 * Puts a learner in front of `/mastery` and `/progress` with every state those
 * screens can render, so both can be looked at in a browser rather than only
 * asserted on.
 *
 * Pass 19's lesson was that a green suite is not a rendered page: a session
 * screen shipped broken because nothing had ever loaded it. Neither of these
 * screens calls a model, so unlike the submission loop this costs nothing to
 * drive — which makes there being no fixture the only reason not to look.
 *
 * The evaluations here are written directly rather than graded. What is being
 * looked at is the ledger, and the grader is E8's business, verified against the
 * real API in pass 19.
 *
 *   pnpm tsx scripts/mastery-screens-fixture.ts
 */

const USER_ID = "mastery-probe-user";
const EMAIL = "mastery-probe@example.com";
const PACK = "sql-data-analysis";
const TOKEN = "mastery-probe-session-token";

const DAY = 86_400_000;

const graded = (overall: number): GradedResult => ({
  overall,
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

  const pack = findPack(PACK)!;
  await seedPack(db, loadPack(`packs/${PACK}`));

  const project = pack.projects[0]!;
  // Four skills, four standings: shown, fading, faded, unproven. Everything
  // else in the pack stays untouched, which is the fifth.
  const [shown, fading, faded, unproven] = pack.skills;

  await db.delete(userTable).where(eq(userTable.id, USER_ID));
  await db.insert(userTable).values({
    id: USER_ID,
    name: "Mastery Probe",
    email: EMAIL,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
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
      targetOutcome: "Write correct aggregate queries over a real schema",
      outcomeType: "career",
      statedLevel: "beginner",
      weeklyHours: 3,
      deadline: null,
      motivation: "I keep having to ask the data team for numbers",
      constraints: [],
      existingAssets: [],
      priorDomain: "none",
      depth: "standard",
      clarity: 0.8,
    },
    mastery: [],
    now,
  });

  const prior = (slug: string): MasteryState => ({
    skillId: slug,
    mastery: 0.9,
    confidence: 0.8,
    evidenceCount: 2,
    lastSuccessAt: now.toISOString(),
    lastPracticedAt: now.toISOString(),
    decayHalfLifeDays: 180,
  });

  /** A marked hand-in, then the exact mastery state the screen should show. */
  async function evidenced(slug: string, at: Date, state: MasteryState) {
    const id = await createSubmission(db, {
      userId: USER_ID,
      packSlug: PACK,
      projectSlug: project.slug,
      artefact: "SELECT customer_id, date_trunc('month', ordered_at) …",
      truncated: false,
      skillSlug: slug,
      now: at,
    });

    await recordEvaluation(db, {
      submissionId: id,
      userId: USER_ID,
      packSlug: PACK,
      rubricSlug: project.rubric,
      rubricVersion: 1,
      skill: pack.skills.find((s) => s.slug === slug)!,
      mastery: prior(slug),
      result: graded(0.82),
      model: "claude-opus-5",
      promptVersion: "fixture",
      now: at,
    });

    await upsertMastery(db, USER_ID, PACK, state, now);
    return id;
  }

  // Held, and holding: a long half-life means it still clears the bar next week.
  await evidenced(shown!.slug, new Date(now.getTime() - 2 * DAY), {
    ...prior(shown!.slug),
    mastery: 0.96,
    lastSuccessAt: new Date(now.getTime() - 2 * DAY).toISOString(),
  });

  // Held, but a seven-day half-life puts it under the bar within the week.
  await evidenced(fading!.slug, new Date(now.getTime() - 3 * DAY), {
    ...prior(fading!.slug),
    mastery: 0.9,
    decayHalfLifeDays: 7,
    lastSuccessAt: now.toISOString(),
  });

  // Proved a month ago, decayed out of the claim and back onto the path.
  await evidenced(faded!.slug, new Date(now.getTime() - 30 * DAY), {
    ...prior(faded!.slug),
    mastery: 0.95,
    decayHalfLifeDays: 7,
    lastSuccessAt: new Date(now.getTime() - 30 * DAY).toISOString(),
  });

  // The number says yes; nothing handed in says so. The interesting one.
  await upsertMastery(db, USER_ID, PACK, prior(unproven!.slug), now);

  // A session's worth of time, and a skill that moved inside the window.
  await db.insert(learningSession).values({
    userId: USER_ID,
    goalId,
    startedAt: new Date(now.getTime() - 2 * DAY),
    completedAt: new Date(now.getTime() - 2 * DAY),
    blocks: [],
    durationMinutes: 95,
  });
  await recordMasteryUpdate(db, {
    userId: USER_ID,
    packSlug: PACK,
    skillSlug: unproven!.slug,
    prior: 0.6,
    posterior: 0.9,
    observationConfidence: 0.6,
    evidenceTier: 2,
    reason: "Answered a recall question correctly.",
    now: new Date(now.getTime() - DAY),
  });

  const signature = createHmac("sha256", secret).update(TOKEN).digest("base64");
  const cookie = encodeURIComponent(`${TOKEN}.${signature}`);

  console.log(`shown:    ${shown!.slug}`);
  console.log(`fading:   ${fading!.slug}`);
  console.log(`faded:    ${faded!.slug}`);
  console.log(`unproven: ${unproven!.slug}`);
  console.log(`goal:     ${goalId}`);
  console.log(`\nurl:      http://localhost:3000/mastery`);
  console.log(`url:      http://localhost:3000/progress`);
  console.log(`cookie:   better-auth.session_token=${cookie}`);

  await close();
}

void main();
