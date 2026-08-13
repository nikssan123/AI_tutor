import { getAnthropic } from "@/lib/ai/client";
import {
  MAX_TURNS,
  isComplete,
  mustFinish,
  runAnalyzer,
  shouldFinishNext,
  type Message,
} from "@/lib/goals/analyzer";

/**
 * A whole intake conversation against the real API, with scripted learner
 * replies. Answers the questions a test cannot: does it ask one thing at a
 * time, does it stop, and does it match the catalogue when it should.
 *
 *   pnpm tsx scripts/analyzer-probe.ts
 */

const CATALOGUE = [
  { slug: "sql-data-analysis", name: "SQL & Data Analysis" },
  { slug: "business-writing", name: "Business Writing" },
  { slug: "photography", name: "Photography" },
];

/** What a real person might type, in order. */
const SCRIPT = process.argv[2]
  ? [process.argv[2], "about 4", "never done it", "skip", "yes"]
  : [
      "I want to get into data analysis for a job change by March",
      "about 4 hours a week",
      "I've done a bit of Excel but no SQL",
      "skip",
      "yes",
    ];

async function main() {
  const messages: Message[] = [];
  let cents = 0;
  let pendingFinal = false;

  for (let i = 0; i < MAX_TURNS + 2; i += 1) {
    const finalTurn = pendingFinal || mustFinish(messages);

    const result = await runAnalyzer(getAnthropic(), {
      messages,
      catalogue: CATALOGUE,
      today: "2026-08-13",
      finalTurn,
    });

    if (result.status !== "ok") {
      console.log("FAILED:", result.status, result.detail);
      return;
    }
    cents += result.costCents ?? 0;

    const turn = result.value;
    messages.push({ r: "a", t: turn.reply });

    console.log(`\n── turn ${i + 1}${finalTurn ? " (forced final)" : ""} ──`);
    console.log(`analyzer: ${turn.reply}`);
    if (turn.chips.length > 0) console.log(`   chips: ${turn.chips.join(" | ")}`);
    console.log(
      `   clarity=${turn.clarity} done=${turn.done} match=${turn.captured.matchedPack} subject=${turn.captured.subject}`,
    );
    console.log(
      `   level=${turn.captured.statedLevel} hours=${turn.captured.weeklyHours} outcome=${turn.captured.outcomeType} deadline=${turn.captured.deadline}`,
    );

    // How many question marks: more than one means two questions in a message.
    const questions = (turn.reply.match(/\?/g) ?? []).length;
    if (questions > 1) console.log(`   ⚠ ${questions} questions in one message`);

    if (isComplete(turn, messages)) {
      console.log(
        `\nended after ${i + 1} turns (cap ${MAX_TURNS}), ${cents.toFixed(2)}c`,
      );
      return;
    }

    pendingFinal = shouldFinishNext(turn.clarity, messages);
    const reply = SCRIPT[i] ?? "sure";
    console.log(`learner: ${reply}`);
    messages.push({ r: "l", t: reply });
  }

  console.log("\n⚠ never completed — the cap did not hold");
}

void main();
