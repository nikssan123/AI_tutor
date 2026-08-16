import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { interaction } from "@/db/schema";
import type { CallMeta } from "@/lib/ai/call";
import { TutorTurn } from "@/lib/contracts/session";
import {
  WIDGET_NAMES,
  type Segment,
  type WidgetName,
  type WidgetView,
} from "./widgets";

/**
 * The Assistant's thread, and what it has already cost today.
 *
 * It shares the `interaction` table with the tutor rather than taking one of its
 * own, and the thing that makes that safe is already in the schema: `session_id`
 * is nullable, and **both** tutor queries are keyed on it — `turnsTaken` and
 * `transcriptFor` filter by a session id, so a row with none is invisible to
 * them. An assistant turn therefore cannot move a learner's per-session tutor
 * allowance, which is the one way sharing a table could have gone wrong.
 *
 * A null session is also what makes this one rolling thread per learner, which
 * is `ASSISTANT-PLAN.md` §14 decision 3's default: the assistant is not scoped
 * to anything, so neither is its history.
 */

/**
 * How much of the thread is replayed to the model.
 *
 * The **latest** rows, not the earliest — the opposite of `transcriptFor`, and
 * the difference matters here. The tutor's transcript is bounded by a per-session
 * turn cap, so taking the oldest twenty is taking nearly all of them. A rolling
 * thread has no such cap, and taking the oldest twenty would replay a
 * conversation from March for ever while the last thing they said fell off the
 * end.
 */
export const HISTORY_DEPTH = 20;

export async function assistantHistory(
  db: Db,
  userId: string,
  depth = HISTORY_DEPTH,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const rows = await db
    .select({ role: interaction.role, content: interaction.content })
    .from(interaction)
    .where(and(eq(interaction.userId, userId), isNull(interaction.sessionId)))
    .orderBy(desc(interaction.createdAt))
    .limit(depth);

  // Read newest-first for the limit, handed back oldest-first for the model.
  return rows
    .reverse()
    .flatMap((row) => {
      const parsed = TutorTurn.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
}

/** One turn as the panel redraws it. */
export interface StoredTurn {
  role: "user" | "assistant";
  segments: Segment[];
}

/**
 * The thread as a screen, rather than as model history.
 *
 * A different projection of the same rows from `assistantHistory`, and worth
 * being two functions: that one feeds a model and must be prose, this one
 * redraws a panel and must carry the views. Deriving either from the other
 * would tie the model's transcript to the panel's layout.
 *
 * A row whose `segments` are missing or unreadable falls back to its prose,
 * which is what every row written before the column existed looks like. That is
 * a turn that reads correctly and shows nothing, rather than a thread with a
 * hole in it.
 */
export async function assistantThread(
  db: Db,
  userId: string,
  depth = HISTORY_DEPTH,
): Promise<StoredTurn[]> {
  const rows = await db
    .select({
      role: interaction.role,
      content: interaction.content,
      segments: interaction.segments,
    })
    .from(interaction)
    .where(and(eq(interaction.userId, userId), isNull(interaction.sessionId)))
    .orderBy(desc(interaction.createdAt))
    .limit(depth);

  return rows.reverse().flatMap((row) => {
    const parsed = TutorTurn.safeParse(row);
    if (!parsed.success) return [];

    return [
      {
        role: parsed.data.role,
        segments: readSegments(row.segments) ?? [
          { kind: "text", text: parsed.data.content },
        ],
      },
    ];
  });
}

/**
 * A stored layout, checked before it is handed to a screen.
 *
 * Written by a build that may be older than this one, so it is read the way the
 * panel reads a frame off the wire: anything unrecognised is dropped rather
 * than rendered. A `view` whose widget this build no longer has is dropped
 * segment by segment, so the prose around it survives.
 */
export function readSegments(value: unknown): Segment[] | null {
  if (!Array.isArray(value)) return null;

  const segments = value.flatMap((entry): Segment[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const segment = entry as Record<string, unknown>;

    if (segment.kind === "text" && typeof segment.text === "string") {
      return [{ kind: "text", text: segment.text }];
    }
    if (segment.kind === "view" && isWidgetView(segment.view)) {
      return [{ kind: "view", view: segment.view }];
    }
    return [];
  });

  // An empty array means "stored, and nothing in it survived", which is not the
  // same as "never stored" — but both redraw as the prose fallback, so they are
  // reported the same way rather than given two paths nothing distinguishes.
  return segments.length > 0 ? segments : null;
}

function isWidgetView(value: unknown): value is WidgetView {
  if (typeof value !== "object" || value === null) return false;
  const view = value as Record<string, unknown>;
  return (
    WIDGET_NAMES.includes(view.widget as WidgetName) &&
    typeof view.payload === "object" &&
    view.payload !== null
  );
}

/**
 * The start of the day the cap is counted over, in UTC.
 *
 * UTC rather than the learner's zone, for the same reason `periodOf` slices the
 * spend ledger by an ISO month: the number has to mean one thing in the
 * database, and a per-learner midnight makes the same row count against two
 * different days depending on who is asking.
 */
export function dayStart(now: Date): Date {
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * How many questions this learner has asked the assistant today.
 *
 * Questions, not model requests: one message may cost up to `MAX_AGENT_STEPS`
 * of those, and a learner told they have three left has to be told about the
 * thing they can count.
 */
export async function messagesToday(
  db: Db,
  userId: string,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(interaction)
    .where(
      and(
        eq(interaction.userId, userId),
        isNull(interaction.sessionId),
        eq(interaction.role, "user"),
        gte(interaction.createdAt, dayStart(now)),
      ),
    );

  // `count(*)` with no `group by` always returns exactly one row.
  return row!.n;
}

/**
 * The whole turn's cost, from one row per model request.
 *
 * Null only when *nothing* had a published rate — never silently zero, which is
 * the same rule `costCentsFor` follows one level down. A turn where one step
 * priced and another did not is under-reported rather than dropped, and that is
 * the right direction: the ledger's job is to notice spend, so the failure that
 * costs least is the one that still shows some.
 */
export function totalCents(steps: CallMeta[]): number | null {
  const priced = steps.flatMap((step) =>
    step.costCents === null ? [] : [step.costCents],
  );
  return priced.length === 0
    ? null
    : priced.reduce((total, cents) => total + cents, 0);
}

export interface AssistantTurn {
  userId: string;
  question: string;
  answer: string;
  /** One per model request the turn spent. */
  steps: CallMeta[];
  /** How the answer was laid out, so a reopened thread redraws it. */
  segments: Segment[];
  now: Date;
}

/**
 * Both halves of the turn, in one write.
 *
 * The cost columns hang off the assistant row because that is the row the calls
 * produced; the question is logged as free. Splitting one turn's cost across two
 * rows would double-count it the moment anyone sums the column — the same shape
 * `logTurn` uses for the tutor, and for the same reason.
 */
export async function logAssistantTurn(
  db: Db,
  record: AssistantTurn,
): Promise<void> {
  const { steps } = record;

  await db.insert(interaction).values([
    {
      userId: record.userId,
      sessionId: null,
      role: "user",
      content: record.question,
      createdAt: record.now,
    },
    {
      userId: record.userId,
      sessionId: null,
      role: "assistant",
      content: record.answer,
      // Null rather than an empty array for a turn that showed nothing, so a
      // row with no views is indistinguishable from one written before the
      // column existed — both redraw from their prose.
      segments: record.segments.length > 0 ? record.segments : null,
      tokensIn: steps.reduce((n, step) => n + step.usage.inputTokens, 0),
      tokensOut: steps.reduce((n, step) => n + step.usage.outputTokens, 0),
      cacheReadTokens: steps.reduce(
        (n, step) => n + step.usage.cacheReadInputTokens,
        0,
      ),
      // Every step of one turn runs on the same model, so the first is the
      // turn's. A turn with no steps at all never reaches here.
      model: steps[0]?.model ?? null,
      costCents: totalCents(steps),
      latencyMs: steps.reduce((n, step) => n + step.latencyMs, 0),
      // One millisecond after the question, so `order by created_at` cannot
      // interleave a question and its answer when both land in the same tick.
      createdAt: new Date(record.now.getTime() + 1),
    },
  ]);
}
