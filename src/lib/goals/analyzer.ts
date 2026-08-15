import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  callStructured,
  type CallResult,
  type StructuredCall,
} from "@/lib/ai/call";
import {
  MAX_WEEKLY_HOURS,
  MIN_WEEKLY_HOURS,
  OutcomeType,
  PRIOR_DOMAINS,
  PriorDomain,
  StatedLevel,
} from "@/lib/contracts/goal";

/**
 * §8 screen 3 — the Goal Analyzer. "Extract a complete goal spec in ≤6
 * exchanges. **Not a form.**"
 *
 * The form at `/start` has stood in for this since pass 1, and it was honest
 * about it: it collected exactly the fields `GoalSpec` needs and pretended to
 * understand nothing. This is the half that does need a model — turning "I want
 * to switch into data" into those same fields, and telling us whether the
 * catalogue already covers it.
 *
 * The contract it produces is the one `parseGoalForm` already produces, which
 * was the point of writing them in that order: the conversation plugs into a
 * consumer that has worked for eleven passes, rather than being the first thing
 * that ever fed it.
 */

/** §24 E3 — "refuses to ask more than 6 questions — hard cap in application code". */
export const MAX_TURNS = 6;

/** §8 screen 3 — below this the analyzer asks one more question. */
export const CLARITY_THRESHOLD = 0.6;

/**
 * What the analyzer has worked out so far.
 *
 * Every field is optional because the learner may skip any of them — "I don't
 * know" is always a valid answer (§8 screen 3) — and a spec is completed with
 * defaults at the end rather than by refusing to move on.
 */
export const CapturedGoal = z.object({
  /** The subject in the product's terms, e.g. "SQL and data analysis". */
  subject: z.string().min(1).max(120).nullable(),
  /**
   * A catalogue slug the analyzer believes covers this, or null for a subject
   * we do not have. Never trusted — `matchPack` checks it against the real
   * catalogue, because a model naming a pack does not make it exist.
   */
  matchedPack: z.string().max(64).nullable(),
  outcomeType: OutcomeType.nullable(),
  statedLevel: StatedLevel.nullable(),
  weeklyHours: z.number().min(MIN_WEEKLY_HOURS).max(MAX_WEEKLY_HOURS).nullable(),
  deadline: z.iso.date().nullable(),
  motivation: z.string().max(500).nullable(),
  constraints: z.array(z.string().max(200)).max(20),
  existingAssets: z.array(z.string().max(200)).max(20),
  /**
   * The closed reading of `existingAssets`, asked for here because the analyzer
   * is already having this conversation — classifying it later would be a
   * second call to learn something this one was told.
   *
   * `nullish` for the same reason as the three `*Said` fields below: this was
   * added after conversations were already being saved, and a stored row that
   * predates it must still load. Required-nullable, it did not — `safeParse`
   * failed on the one missing key, `loadIntake` turned the whole object into
   * `undefined`, and the sidebar that exists to repeat what we heard went blank
   * on every row. `matchChosen` already reads it as `?? DEFAULT_PRIOR_DOMAIN`.
   */
  priorDomain: PriorDomain.nullish(),

  /*
   * What the learner actually said, for the three fields where our normalised
   * answer can contradict theirs.
   *
   * The planner needs `statedLevel`, `weeklyHours` and `deadline` as an enum, a
   * number and a date. The screen needs none of that — and showing it produced
   * a panel that answered "Complete beginner" with "Dabbled a bit", turned the
   * chip "1-2 hrs" into "1.5 hrs/week", and rendered "before a trip next
   * summer" as `2027-06-01`. One row wrong and two inventing precision, on the
   * one card whose entire claim is that it is repeating what it heard.
   *
   * So the buckets stay, and stay internal, and the panel quotes instead.
   * `nullish` rather than optional-with-default because conversations saved
   * before this existed still have to load.
   */
  levelSaid: z.string().max(60).nullish(),
  weeklyHoursSaid: z.string().max(60).nullish(),
  deadlineSaid: z.string().max(60).nullish(),
});
export type CapturedGoal = z.infer<typeof CapturedGoal>;

export const AnalyzerTurn = z.object({
  /** What to say next: a question, or the closing line when done. */
  reply: z.string().min(1).max(600),
  captured: CapturedGoal,
  /** 0–1. The analyzer's own read on whether it has enough to build a plan. */
  clarity: z.number().min(0).max(1),
  /** Set when the analyzer believes it has everything it needs. */
  done: z.boolean(),
  /**
   * Up to four one-tap answers to the question just asked, so most replies are
   * a click rather than typing (§8 screen 3's smart chips).
   */
  chips: z.array(z.string().min(1).max(60)).max(4),
});
export type AnalyzerTurn = z.infer<typeof AnalyzerTurn>;

export const ANALYZER_PROMPT = {
  name: "goal_analyzer",
  version: 1,
  text: `You work out what someone wants to learn, so we can build them a plan.

This is a conversation, not a form. Ask one thing at a time, in plain language, and never ask for something you can reasonably infer from what they already said. Someone who says "I want to get into data analysis for a job change by March" has told you the subject, why, and the deadline — do not ask again.

You need enough to build a plan:

- what they want to be able to do
- roughly where they are starting from
- how many hours a week they actually have

Everything else is a bonus. A deadline, what is getting in the way, what they have already made — take them if they are offered, ask only if there is room.

Rules that matter:

- **Never ask more than one question in a message.** Two questions in one line gets one answer and a lost field.
- "I don't know" and "skip" are always fine. Take the answer and move on; do not press.
- Believe what they tell you about their time. If someone says two hours a week, build for two hours a week — do not talk them up to ten.
- Keep it short. One or two sentences.
- The \`*Said\` fields are quotes, not summaries. Copy their level, their time and their deadline back word for word. The screen shows those words next to what they typed, so anything you smooth over there reads as us mishearing them.

You are also told which subjects we already support in depth. If what they want is one of those, put its slug in \`matchedPack\`. If it is not, leave \`matchedPack\` null and put the subject in \`subject\` — we can build it, and it is not your job to talk them into something else.

Set \`done\` when you could hand this to someone and they could start planning. When you set it, your \`reply\` is the last thing they read before their plan appears, so make it a sentence about what they are about to get, not a summary of the form you just filled in.

Offer \`chips\` when the likely answers are short and enumerable — levels, rough hour counts, yes or no. Leave it empty when the honest answer is prose.`,
} as const;

export const ANALYZER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "One question, or the closing line." },
    captured: {
      type: "object",
      properties: {
        subject: { type: ["string", "null"] },
        matchedPack: {
          type: ["string", "null"],
          description: "Slug of a supported subject, or null if we lack it.",
        },
        outcomeType: {
          type: ["string", "null"],
          enum: ["career", "project", "exam", "personal", "curiosity", null],
        },
        statedLevel: {
          type: ["string", "null"],
          enum: ["none", "beginner", "intermediate", "advanced", null],
          /*
           * Spelled out because the values do not say what they mean: a learner
           * who taps "Complete beginner" was recorded as `beginner` — which the
           * product shows as "Dabbled a bit" — because nothing told the model
           * that `none` is the one that means never.
           */
          description:
            "none = has never done it at all. beginner = has dabbled. intermediate = can do the basics unaided. advanced = experienced, filling gaps.",
        },
        weeklyHours: { type: ["number", "null"] },
        deadline: {
          type: ["string", "null"],
          description: "ISO date (YYYY-MM-DD), or null.",
        },
        levelSaid: {
          type: ["string", "null"],
          description:
            "The learner's own words for their level, copied verbatim from what they typed or tapped — e.g. 'Complete beginner'. Never your paraphrase. Null if they have not said.",
        },
        weeklyHoursSaid: {
          type: ["string", "null"],
          description:
            "Their own words for how much time they have, verbatim — e.g. '1-2 hrs', 'a couple of evenings'. Never a number you worked out. Null if they have not said.",
        },
        deadlineSaid: {
          type: ["string", "null"],
          description:
            "Their own words for when they need it by, verbatim — e.g. 'before a trip next summer'. Never the date you resolved it to. Null if they have not said.",
        },
        motivation: { type: ["string", "null"] },
        constraints: { type: "array", items: { type: "string" } },
        existingAssets: { type: "array", items: { type: "string" } },
        priorDomain: {
          type: ["string", "null"],
          enum: [...PRIOR_DOMAINS, null],
          description:
            "Which of these the learner already works with, if any: spreadsheets, programming, statistics. Only when they have actually said so — an interest in a subject is not experience of it, and a wrong guess here puts a strained analogy in front of them. 'none' when they have said they are starting fresh; null when it has not come up.",
        },
      },
      required: [
        "subject",
        "matchedPack",
        "outcomeType",
        "statedLevel",
        "weeklyHours",
        "deadline",
        "motivation",
        "constraints",
        "existingAssets",
        "priorDomain",
        "levelSaid",
        "weeklyHoursSaid",
        "deadlineSaid",
      ],
      additionalProperties: false,
    },
    clarity: { type: "number", description: "0 to 1." },
    done: { type: "boolean" },
    chips: {
      type: "array",
      items: { type: "string" },
      description: "Up to 4 one-tap answers, or empty for a prose question.",
    },
  },
  required: ["reply", "captured", "clarity", "done", "chips"],
  additionalProperties: false,
} as const;

/* ── The transcript ───────────────────────────────────────────────────────── */

export interface Message {
  /** "l" learner, "a" analyzer. One character because this rides in a form field. */
  r: "l" | "a";
  t: string;
}

/**
 * The conversation, carried in a hidden form field rather than a session row.
 *
 * The same reasoning as the Skill Check's cookie: this happens before there is
 * anything to attach a row to, and it holds nothing but what the learner just
 * typed. A form field rather than a cookie because it is bounded by the turn cap
 * and because it keeps `/start` a pure function of its POST body — a refresh
 * cannot resubmit an answer that was already counted.
 */
export function encodeTranscript(messages: Message[]): string {
  return Buffer.from(JSON.stringify(messages), "utf8").toString("base64url");
}

/** Never throws: a mangled transcript starts the conversation again. */
export function decodeTranscript(raw: string | undefined): Message[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (!Array.isArray(parsed)) return [];

    const messages: Message[] = [];
    for (const entry of parsed.slice(0, MAX_TURNS * 2)) {
      if (typeof entry !== "object" || entry === null) continue;
      const { r, t } = entry as { r?: unknown; t?: unknown };
      if ((r === "l" || r === "a") && typeof t === "string") {
        messages.push({ r, t: t.slice(0, 2000) });
      }
    }
    return messages;
  } catch {
    return [];
  }
}

/** How many questions the analyzer has already asked. */
export function turnsTaken(messages: Message[]): number {
  return messages.filter((m) => m.r === "a").length;
}

/**
 * Whether the conversation must end now, whatever the model would prefer.
 *
 * §24 E3's acceptance criterion is "≤6 turns, always", and the plan is explicit
 * that the cap is "in application code, not prompt". A model asked to limit
 * itself will, until the one conversation where it does not.
 */
export function mustFinish(messages: Message[]): boolean {
  return turnsTaken(messages) >= MAX_TURNS;
}

/* ── The call ─────────────────────────────────────────────────────────────── */

export interface AnalyzerInput {
  messages: Message[];
  /** Slug and name of every subject supported in depth, for matching. */
  catalogue: Array<{ slug: string; name: string }>;
  /** Today, so a relative deadline ("by March") resolves to a real date. */
  today: string;
  /** True when this is the last turn allowed, so the model stops asking. */
  finalTurn: boolean;
  /**
   * The course the learner already chose, when they arrived from a page that
   * names one. Null when they arrived with a sentence and the subject is
   * genuinely still open.
   */
  committed?: { slug: string; name: string } | null;
}

export function buildAnalyzerContext(input: AnalyzerInput): string {
  const catalogue = input.catalogue
    .map((c) => `- ${c.slug}: ${c.name}`)
    .join("\n");

  const conversation = input.messages
    .map((m) => `${m.r === "l" ? "Them" : "You"}: ${m.t}`)
    .join("\n");

  return [
    `Today is ${input.today}.`,
    "",
    "Subjects we support in depth:",
    catalogue.length > 0 ? catalogue : "- none yet",
    "",
    /*
     * The one instruction that overrides the matching job above.
     *
     * They pressed a button on a page that names exactly one course, so asking
     * what they want to learn is asking a question they have already answered
     * with a click — and offering an alternative is arguing with it. What is
     * still unknown is everything about *them*, which is what the remaining
     * turns are for.
     *
     * `matchedPack` is pinned here as well as decided in application code
     * (`matchChosen`). Belt and braces on purpose: the code is what actually
     * binds the goal, and this only keeps the model's own summary from
     * contradicting the screen the learner is looking at.
     */
    input.committed
      ? `They have already chosen a course: ${input.committed.name} (slug ${input.committed.slug}). The subject is settled. Do not ask what they want to learn, do not offer a different subject, and put ${input.committed.slug} in matchedPack every turn. Ask only about them — what they want to do with it, where they are starting from, how many hours a week they have.`
      : "",
    "",
    input.finalTurn
      ? "This is your last turn. Do not ask anything else — set done and say what they are about to get."
      : "",
    "",
    "Conversation so far:",
    conversation.length > 0 ? conversation : "(nothing yet — open it)",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * The call itself, separated from making it.
 *
 * `analyzer-stream.ts` runs this same call with `stream: true` so the reply can
 * be read as it is typed. Both paths therefore ask for one thing described in
 * one place — a streamed turn that quietly used a different prompt, tool or
 * model tier from the blocking one would be a difference nothing tests.
 */
export function analyzerCall(
  input: AnalyzerInput,
  options: { degraded?: boolean } = {},
): StructuredCall<AnalyzerTurn> {
  return {
    step: "goalAnalyzer",
    prompt: ANALYZER_PROMPT,
    system: ANALYZER_PROMPT.text,
    user: buildAnalyzerContext(input),
    tool: {
      name: "submit_turn",
      description: "Reply to the learner and record what you have worked out.",
      inputSchema: ANALYZER_TOOL_SCHEMA as unknown as Record<string, unknown>,
    },
    parse: (raw) => {
      const result = AnalyzerTurn.safeParse(raw);
      return result.success
        ? { ok: true, value: result.data }
        : {
            ok: false,
            error: result.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          };
    },
    degraded: options.degraded ?? false,
  };
}

export async function runAnalyzer(
  client: Anthropic,
  input: AnalyzerInput,
  options: { degraded?: boolean } = {},
): Promise<CallResult<AnalyzerTurn>> {
  return callStructured(client, analyzerCall(input, options));
}

/**
 * Whether the conversation is over.
 *
 * Only two things end it: the analyzer saying so, or the cap. Clarity
 * deliberately does *not* — it decides whether to keep asking, not whether to
 * stop mid-sentence. Ending on a high clarity score while the model's `reply`
 * is still a question means the learner is asked "is anything getting in the
 * way?" and then watches their plan appear without ever answering. §8 screen 3
 * puts it the other way round: below 0.6 the analyzer asks *one more question*.
 */
export function isComplete(turn: AnalyzerTurn, messages: Message[]): boolean {
  return turn.done || mustFinish(messages);
}

/**
 * Whether the next turn must be the closing one.
 *
 * Passed back in as `finalTurn`, which tells the model to stop asking and say
 * what the learner is about to get. That is what turns "enough information" into
 * a sentence a person can read, rather than a question left hanging.
 */
export function shouldFinishNext(
  clarity: number,
  messages: Message[],
): boolean {
  return clarity >= CLARITY_THRESHOLD || turnsTaken(messages) >= MAX_TURNS - 1;
}
