import { cx } from "@/components/ui";

/**
 * The renderer for prose a *model* wrote — a lesson body, a tutor's answer.
 *
 * `guide-body.tsx` supports two marks and no more, for a stated reason: a full
 * markdown pipeline lets an author put anything inside a section, and at that
 * point the template has stopped imposing a shape. The same wall belongs here.
 * The marks it lets through are different because the writer is.
 *
 * A guide is written by a person who can be told what the template allows. This
 * text is written by a model, into a tool call or a stream, about whatever
 * skill the pack happens to name — and it writes markdown whether or not
 * anything asked it to. The lessons in the database are full of fenced blocks
 * and backticks; the tutor answers with `**bold**` run-ins and numbered steps.
 * None of it was being rendered, so a learner read the asterisks.
 *
 * So the supported set is exactly what these two writers actually produce:
 * fenced and indented code, bullet and numbered lists, and inline `code`,
 * `**strong**` and `*emphasis*`. Headings are deliberately **not** here — a
 * model that can open a heading will nest a document inside a chat bubble, and
 * a standalone bold line already reads as the run-in heading it was meant to
 * be.
 */

/**
 * Undoes a double-escaped tool-call string.
 *
 * A model writing code-heavy text into a JSON tool call sometimes escapes the
 * newlines twice, and what arrives is the two characters `\` and `n` where the
 * break should be. Zod cannot catch it — it is a perfectly valid string — so
 * the lesson caches that way and renders as one 40-line paragraph with `\n`
 * sprinkled through it. That is the state the .NET lessons are in today.
 *
 * **Repaired only when the text has no real line breaks at all.** A lesson
 * about escape sequences is a thing that exists — `\n` inside a C# string is a
 * perfectly good subject — and a blanket replace would rewrite it into
 * nonsense. A body that is genuinely one unbroken line *and* contains `\n` runs
 * is the exact signature of the double-escape, and a correctly formatted lesson
 * never matches it however often it mentions the sequence.
 */
export function repairEscapes(text: string): string {
  if (text.includes("\n") || !text.includes("\\n")) return text;

  return text
    .replace(/\\r\\n|\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"');
}

/** A run of lines that belong together. */
export interface Chunk {
  kind: "prose" | "code" | "bullets" | "numbers";
  lines: string[];
}

const FENCE = /^\s*```/;
/** Two spaces or a tab — how a model sets a command apart from its sentence. */
const INDENTED = /^(?: {2,}|\t)\s*\S/;
const BULLET = /^\s*[-*+]\s+\S/;
const NUMBERED = /^\s*\d+[.)]\s+\S/;
/** The marker itself, stripped once a line is known to be a list item. */
const MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * Groups one body into paragraphs, listings and lists.
 *
 * Blank lines separate paragraphs, and an indented run ends the paragraph above
 * it without needing one. That second rule is the one that matters: the shape a
 * model actually writes is a sentence, the command underneath it, and then the
 * sentence explaining what the command did — with no blank line anywhere.
 *
 * List markers are read **before** the indent rule, so an indented sub-bullet
 * stays a bullet rather than becoming a code listing.
 */
export function chunk(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let open: Chunk | undefined;
  let fenced = false;

  const start = (kind: Chunk["kind"], line?: string) => {
    open = { kind, lines: line === undefined ? [] : [line] };
    chunks.push(open);
  };

  for (const line of repairEscapes(text).split("\n")) {
    if (FENCE.test(line)) {
      // The fence itself is never rendered. An unclosed one runs to the end of
      // the body, which is the right reading of a half-written fence: whatever
      // followed it was meant to be code.
      fenced = !fenced;
      if (fenced) start("code");
      else open = undefined;
      continue;
    }

    if (fenced) {
      // A fence always opens a chunk, so there is always one to append to.
      open?.lines.push(line);
      continue;
    }

    // A blank line closes what is open and opens nothing, so a run of them
    // collapses instead of producing empty paragraphs.
    if (line.trim() === "") {
      open = undefined;
      continue;
    }

    const kind: Chunk["kind"] = BULLET.test(line)
      ? "bullets"
      : NUMBERED.test(line)
        ? "numbers"
        : INDENTED.test(line)
          ? "code"
          : "prose";

    // A list stores its items with the marker stripped; everything else keeps
    // the line as written, because the indent is load-bearing for `outdent`.
    const content =
      kind === "bullets" || kind === "numbers"
        ? line.replace(MARKER, "")
        : line;

    if (open && open.kind === kind) open.lines.push(content);
    else start(kind, content);
  }

  return chunks.filter((c) => c.lines.length > 0);
}

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;

const CODE_TONE = "font-mono text-[0.9em] text-ink";

/**
 * The inline marks: `code`, `**strong**`, `*emphasis*`.
 *
 * `**` is listed before `*` in the pattern so a strong span is claimed whole
 * rather than read as two empty emphases.
 */
export function inlineMarks(text: string, codeClass: string): React.ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (/^`[^`\n]+`$/.test(part)) {
      return (
        <code key={i} className={cx(CODE_TONE, codeClass)}>
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^\*\*[^*\n]+\*\*$/.test(part)) {
      return (
        <strong key={i} className="font-[650] text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (/^\*[^*\n]+\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

/**
 * Strips the indent a whole listing shares.
 *
 * The indent is what marked these lines as code in the first place; keeping it
 * would set every command two spaces in from the left edge of its own box for
 * no reason. Only the *shared* indent goes, so a continuation line stays
 * stepped in under the line it continues.
 */
export function outdent(lines: string[]): string {
  const tabbed = lines.map((line) => line.replace(/\t/g, "  "));
  // Measured by subtraction rather than by matching `/^[ \t]*/`, which can
  // never fail and so would leave a null branch nothing can reach.
  const widths = tabbed
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);
  const shared = widths.length === 0 ? 0 : Math.min(...widths);

  return tabbed.map((line) => line.slice(shared).trimEnd()).join("\n");
}

/**
 * The two settings this text is read in, as one prop rather than four.
 *
 * `reading` is a lesson: it sits on the page itself, at the size and leading a
 * document is set in. `compact` is a tutor answer: it sits on a surface, inside
 * a panel, and is read a few lines at a time.
 *
 * They are bundled because the pairing is not a coincidence — the code panel's
 * fill has to be the *opposite* of whatever the prose is sitting on, and in
 * light mode `--surface` and `--raised` are both `#FFFFFF`, so getting it wrong
 * makes every listing vanish. Two independent props would let a caller choose
 * the one combination that cannot be seen.
 */
export type ProseVariant = "reading" | "compact";

const VARIANT: Record<
  ProseVariant,
  { root: string; block: string; panel: string; inline: string }
> = {
  reading: {
    /*
     * `gap-7` — 28px between paragraphs, against a 32px line.
     *
     * This is the fix for "hard to follow". It was `gap-4`: 16px of paragraph
     * separation under a 25.6px line, so the space *between* paragraphs was
     * smaller than the space between lines and the whole lesson fused into one
     * grey block. A paragraph break has to be the biggest gap in the column or
     * it is not a break.
     */
    root: "gap-7 text-[length:var(--text-lead-size)] leading-[1.7]",
    block: "max-w-[var(--measure)]",
    // On the page ground, so the listing steps *up* to the card colour.
    panel: "bg-surface",
    inline: "bg-surface",
  },
  compact: {
    root: "gap-5 text-[length:var(--text-body-size)] leading-[1.65]",
    block: "max-w-[var(--measure)]",
    // On a surface, so the listing steps *down* to the page colour.
    panel: "bg-ground",
    inline: "bg-ground",
  },
};

export function GeneratedProse({
  text,
  variant = "compact",
  className,
}: {
  text: string;
  variant?: ProseVariant;
  className?: string;
}) {
  const tone = VARIANT[variant];
  const inline = cx("rounded-[4px] border border-hairline px-1.5 py-0.5", tone.inline);

  return (
    <div className={cx("flex flex-col", tone.root, className)}>
      {chunk(text).map((c, i) => {
        if (c.kind === "code") {
          return (
            /* `overflow-x-auto` on the block itself rather than on a wrapper: a
               long command must be able to scroll sideways without the page
               doing it too, and on a phone every command is a long command. */
            <pre
              key={i}
              className={cx(
                "overflow-x-auto rounded-[var(--radius-control)] border border-hairline px-4 py-3.5",
                tone.panel,
              )}
            >
              <code
                className={cx(
                  "font-mono text-[length:var(--text-meta-size)] leading-[1.75] text-ink",
                )}
              >
                {outdent(c.lines)}
              </code>
            </pre>
          );
        }

        if (c.kind === "prose") {
          return (
            /*
             * `whitespace-pre-line`, so a single newline stays a line break and
             * a blank line stays a paragraph gap.
             *
             * The first cut joined the lines of a paragraph with a space, on
             * the theory that a newline inside one is a soft wrap. It is not —
             * these bodies arrive as one long unwrapped line per paragraph, so
             * every break a model writes is one it meant. Joining them ran the
             * printed output of a command into the sentence explaining it:
             * "This prints: Hello Ada You pass --project because…".
             */
            <p key={i} className={cx(tone.block, "whitespace-pre-line")}>
              {inlineMarks(c.lines.join("\n"), inline)}
            </p>
          );
        }

        const List = c.kind === "bullets" ? "ul" : "ol";
        return (
          <List
            key={i}
            className={cx(
              tone.block,
              "flex flex-col gap-2 ps-6",
              c.kind === "bullets" ? "list-disc" : "list-decimal",
            )}
          >
            {c.lines.map((item, j) => (
              <li key={j} className="ps-1">
                {inlineMarks(item, inline)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
