import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { createClient } from "@/db";
import { user as userTable, session as sessionTable } from "@/db/schema";
import { findPack } from "@/lib/content";
import { createGoal } from "@/lib/goals/store";
import { startSession } from "@/lib/session/store";
import { initialMastery } from "@/lib/engine/bkt";
import type { PlannedSession } from "@/lib/engine";

/**
 * Puts a learner in front of an `apply` block, so the browser can drive the
 * half of the loop E8 actually owns.
 *
 * Everything upstream of the textarea — the diagnostic (E4) and the curriculum
 * (E6) — is fixtured rather than run, because both were verified against the
 * real API in earlier passes and re-running them here would cost a few dollars
 * to prove something already proven. What is *not* fixtured is anything from
 * the "Hand it in" button onwards: the server action, the Inngest event, the
 * grader, the transaction and the result screen all run for real.
 *
 * The session cookie is minted here rather than typed into a form. Better Auth
 * signs the token with an HMAC over the shared secret (see
 * `node_modules/better-auth/dist/cookies/index.mjs`), so a row plus a signature
 * is a genuine session — no credential is entered anywhere.
 *
 *   pnpm tsx scripts/submission-loop-fixture.ts
 */

const USER_ID = "loop-probe-user";
const EMAIL = "loop-probe@example.com";
const PACK = "sql-data-analysis";
const TOKEN = "loop-probe-session-token";

async function main() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");

  const { db, close } = createClient(process.env.DATABASE_URL!, 2);
  const now = new Date();

  const pack = findPack(PACK)!;
  const project = pack.projects[0]!;
  const rubric = pack.rubrics.find((r) => r.slug === project.rubric)!;
  const skill = pack.skills.find((s) => project.targetSkills.includes(s.slug))!;

  // Cascades to the session, goal, plan and learning session from last run.
  await db.delete(userTable).where(eq(userTable.id, USER_ID));

  await db.insert(userTable).values({
    id: USER_ID,
    name: "Loop Probe",
    email: EMAIL,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(sessionTable).values({
    id: crypto.randomUUID(),
    userId: USER_ID,
    token: TOKEN,
    expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24),
    createdAt: now,
    updatedAt: now,
  });

  const goalId = await createGoal(db, {
    userId: USER_ID,
    packSlug: PACK,
    spec: {
      rawGoal: "I want to be able to answer revenue questions with SQL myself",
      domain: PACK,
      targetOutcome: "Write correct aggregate queries over a real schema",
      outcomeType: "career",
      statedLevel: "beginner",
      weeklyHours: 3,
      deadline: null,
      motivation: "I keep having to ask the data team for numbers",
      constraints: [],
      existingAssets: [],
      clarity: 0.8,
    },
    mastery: [initialMastery(skill.slug, skill.bktPriors)],
    now,
  });

  // The one block that matters, shaped exactly as the planner composes it.
  const planned: PlannedSession = {
    goalId,
    plannedFor: now.toISOString().slice(0, 10),
    sessionIndex: 1,
    blocks: [
      {
        type: "apply",
        skillId: skill.slug,
        brief: project.brief,
        rubricId: rubric.slug,
        evidenceType: "text",
        estMinutes: 30,
      },
    ],
    totalMinutes: 30,
    targetSkillIds: [skill.slug],
    backingOff: false,
    reason: "Fixtured so the hand-in path can be driven for real.",
    compression: { applied: false, droppedSkillIds: [], message: "" },
    // Empty because the planner never ran: this session was composed by hand.
    ranked: [],
  };

  const learning = await startSession(db, {
    userId: USER_ID,
    goalId,
    planned,
    now,
  });

  /*
   * Standard padded base64, then URL-encoded whole — `signCookieValue` in
   * better-call's `crypto.mjs`. Not `base64urlnopad`: that encoding belongs to
   * the session-data cache payload, and `getSignedCookie` rejects anything that
   * is not 44 characters ending in "=".
   */
  const signature = createHmac("sha256", secret).update(TOKEN).digest("base64");
  const cookie = encodeURIComponent(`${TOKEN}.${signature}`);

  console.log(`brief:   ${project.title}`);
  console.log(`rubric:  ${rubric.slug} (${rubric.criteria.length} criteria)`);
  console.log(`skill:   ${skill.slug} (tier ${skill.evalTier})`);
  console.log(`goal:    ${goalId}`);
  console.log(`\nurl:     http://localhost:3000/session/${learning.id}`);
  console.log(`cookie:  better-auth.session_token=${cookie}`);

  await close();
}

void main();
