import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { goalIntake } from "@/db/schema";
import { CapturedGoal, type Message } from "./analyzer";

/**
 * Where §8 screen 3's conversation lives between requests.
 *
 * Every transition on this screen is a form POST, like the Skill Check and the
 * session runner, so the page has to be a pure function of stored state rather
 * than of anything held in a browser. This is that state.
 */

export interface Intake {
  messages: Message[];
  captured: CapturedGoal | undefined;
  chips: string[];
  clarity: number;
  done: boolean;
  /**
   * The course this conversation is already committed to, or null.
   *
   * Set once, on the turn that opens the conversation, from the page the
   * learner pressed a button on — a brief names its pack, a subject page *is*
   * one. Carried by every later turn rather than re-derived, so the analyzer
   * asks about them rather than about the subject, and so the pack that ends up
   * on the goal is the one they chose rather than the one a model recognised.
   */
  packSlug: string | null;
}

export const EMPTY_INTAKE: Intake = {
  messages: [],
  captured: undefined,
  chips: [],
  clarity: 0,
  done: false,
  packSlug: null,
};

/** Anything unparseable is treated as no conversation, so the screen restarts. */
function messagesFrom(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];

  const messages: Message[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { r, t } = entry as { r?: unknown; t?: unknown };
    if ((r === "l" || r === "a") && typeof t === "string") messages.push({ r, t });
  }
  return messages;
}

export async function loadIntake(db: Db, userId: string): Promise<Intake> {
  const [row] = await db
    .select()
    .from(goalIntake)
    .where(eq(goalIntake.userId, userId))
    .limit(1);

  if (!row) return EMPTY_INTAKE;

  const captured = CapturedGoal.safeParse(row.captured);

  return {
    messages: messagesFrom(row.messages),
    captured: captured.success ? captured.data : undefined,
    chips: Array.isArray(row.chips)
      ? row.chips.filter((c): c is string => typeof c === "string")
      : [],
    clarity: row.clarity,
    done: row.done,
    packSlug: row.packSlug,
  };
}

export async function saveIntake(
  db: Db,
  userId: string,
  intake: Intake,
  now: Date = new Date(),
): Promise<void> {
  const row = {
    userId,
    messages: intake.messages,
    captured: intake.captured ?? null,
    chips: intake.chips,
    clarity: intake.clarity,
    done: intake.done,
    packSlug: intake.packSlug,
    updatedAt: now,
  };

  await db
    .insert(goalIntake)
    .values(row)
    .onConflictDoUpdate({ target: goalIntake.userId, set: row });
}

/**
 * Clears the conversation.
 *
 * Called when the learner starts over and when a goal is finally created — an
 * intake that produced a goal has done its job, and leaving it behind would
 * greet them with their old answers the next time they set a goal.
 */
export async function clearIntake(db: Db, userId: string): Promise<void> {
  await db.delete(goalIntake).where(eq(goalIntake.userId, userId));
}
