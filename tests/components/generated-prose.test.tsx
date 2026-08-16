// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  chunk,
  GeneratedProse,
  inlineMarks,
  outdent,
  repairEscapes,
} from "@/components/generated-prose";

/**
 * The renderer that turned a lesson back into a lesson, and a tutor answer into
 * something other than a wall of asterisks.
 *
 * What is asserted here is the shape it reads out of model-written text, not
 * the classes it paints: which runs are prose, which are a listing and which
 * are a list, and that a double-escaped body is repaired without rewriting a
 * lesson that is actually *about* escape sequences.
 */

afterEach(cleanup);

describe("repairEscapes", () => {
  it("turns a double-escaped body back into lines", () => {
    expect(repairEscapes("Step 1.\\n  dotnet build\\nDone.")).toBe(
      "Step 1.\n  dotnet build\nDone.",
    );
  });

  it("repairs escaped tabs and quotes alongside the newlines", () => {
    expect(repairEscapes('a\\n\\tb\\n\\"c\\"')).toBe('a\n\tb\n"c"');
  });

  /**
   * The rule that makes this safe. A body with real line breaks is already
   * formatted, so every `\n` left in it is a `\n` the author meant — the
   * subject, not the separator.
   */
  it("leaves a lesson that is about escape sequences alone", () => {
    const text = 'Write "a\\nb" and C# prints two lines.\n\nTry it.';
    expect(repairEscapes(text)).toBe(text);
  });

  it("leaves text with no escapes at all alone", () => {
    expect(repairEscapes("Nothing to do here.")).toBe("Nothing to do here.");
  });
});

describe("chunk", () => {
  it("splits paragraphs on blank lines", () => {
    expect(chunk("One.\n\nTwo.")).toEqual([
      { kind: "prose", lines: ["One."] },
      { kind: "prose", lines: ["Two."] },
    ]);
  });

  it("collapses a run of blank lines rather than emitting empty paragraphs", () => {
    expect(chunk("One.\n\n\n\nTwo.")).toHaveLength(2);
  });

  /**
   * The rule that matters most, because it is the shape a model actually
   * writes: a sentence, the command under it, and the sentence explaining what
   * the command did — with no blank line anywhere.
   */
  it("ends a paragraph at an indented run without needing a blank line", () => {
    expect(chunk("Step 1.\n  dotnet build\n  dotnet run\nIt printed.")).toEqual([
      { kind: "prose", lines: ["Step 1."] },
      { kind: "code", lines: ["  dotnet build", "  dotnet run"] },
      { kind: "prose", lines: ["It printed."] },
    ]);
  });

  it("reads a fenced block as code and drops the fences", () => {
    expect(chunk("Try:\n```sh\nls -la\n```\nThat lists them.")).toEqual([
      { kind: "prose", lines: ["Try:"] },
      { kind: "code", lines: ["ls -la"] },
      { kind: "prose", lines: ["That lists them."] },
    ]);
  });

  it("runs an unclosed fence to the end of the body", () => {
    expect(chunk("Try:\n```\nls -la\nrm -rf nothing")).toEqual([
      { kind: "prose", lines: ["Try:"] },
      { kind: "code", lines: ["ls -la", "rm -rf nothing"] },
    ]);
  });

  it("keeps blank lines inside a fence", () => {
    expect(chunk("```\na\n\nb\n```")).toEqual([
      { kind: "code", lines: ["a", "", "b"] },
    ]);
  });

  it("drops an empty fenced block rather than rendering an empty box", () => {
    expect(chunk("```\n```")).toEqual([]);
  });

  it("repairs before it splits", () => {
    expect(chunk("Step 1.\\n  dotnet build")).toEqual([
      { kind: "prose", lines: ["Step 1."] },
      { kind: "code", lines: ["  dotnet build"] },
    ]);
  });

  it("finds nothing in an empty body", () => {
    expect(chunk("")).toEqual([]);
  });
});

describe("outdent", () => {
  it("strips the indent the whole listing shares", () => {
    expect(outdent(["  a", "  b"])).toBe("a\nb");
  });

  it("keeps a continuation stepped in under the line it continues", () => {
    expect(outdent(["  a", "    b"])).toBe("a\n  b");
  });

  it("measures tabs as two spaces", () => {
    expect(outdent(["\ta", "\t\tb"])).toBe("a\n  b");
  });

  it("ignores blank lines when measuring, and trims their trailing space", () => {
    expect(outdent(["  a", "   ", "  b"])).toBe("a\n\nb");
  });

  it("has nothing to strip from a listing of only blank lines", () => {
    expect(outdent(["", ""])).toBe("\n");
  });
});

describe("lists", () => {
  it("reads a run of dashes as a bullet list, marker stripped", () => {
    expect(chunk("Two things:\n- first\n- second")).toEqual([
      { kind: "prose", lines: ["Two things:"] },
      { kind: "bullets", lines: ["first", "second"] },
    ]);
  });

  it("reads a numbered run as an ordered list", () => {
    expect(chunk("1. first\n2) second")).toEqual([
      { kind: "numbers", lines: ["first", "second"] },
    ]);
  });

  /**
   * List markers are read before the indent rule, so a sub-bullet stays a
   * bullet. Without that ordering an indented list item becomes a code listing
   * and the model's outline turns into a terminal.
   */
  it("keeps an indented sub-bullet a bullet rather than a listing", () => {
    expect(chunk("  - nested")).toEqual([
      { kind: "bullets", lines: ["nested"] },
    ]);
  });

  it("does not mistake a multiplication line for a bullet", () => {
    expect(chunk("*emphasis* leads the line")).toEqual([
      { kind: "prose", lines: ["*emphasis* leads the line"] },
    ]);
  });

  it("renders the two list kinds as the two list elements", () => {
    const { container } = render(
      <GeneratedProse text={"- a\n- b\n\n1. c"} />,
    );

    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(1);
  });
});

describe("inlineMarks", () => {
  it("marks a backticked span and leaves the rest as text", () => {
    render(<p>{inlineMarks("Run `dotnet build` first.", "chip")}</p>);

    expect(screen.getByText("dotnet build").tagName).toBe("CODE");
    expect(screen.getByText(/Run/)).toBeDefined();
  });

  /** The tutor's habit: a `**run-in heading**` on a line of its own. */
  it("marks a strong span", () => {
    render(<p>{inlineMarks("**Step 1: one project**", "chip")}</p>);

    expect(screen.getByText("Step 1: one project").tagName).toBe("STRONG");
  });

  it("marks an emphasis span", () => {
    render(<p>{inlineMarks("only *one* project", "chip")}</p>);

    expect(screen.getByText("one").tagName).toBe("EM");
  });

  /** `**` is claimed whole, or a strong span reads as two empty emphases. */
  it("does not read a strong span as two emphases", () => {
    render(<p>{inlineMarks("**both words**", "chip")}</p>);

    expect(document.querySelectorAll("em")).toHaveLength(0);
  });

  it("leaves an unpaired backtick as the character it is", () => {
    render(<p>{inlineMarks("A ` on its own.", "chip")}</p>);

    expect(document.querySelector("code")).toBeNull();
  });

  it("leaves an empty pair alone rather than marking nothing", () => {
    render(<p>{inlineMarks("An empty `` pair.", "chip")}</p>);

    expect(document.querySelector("code")).toBeNull();
  });
});

describe("GeneratedProse", () => {
  it("renders a listing as a scrollable code block", () => {
    const { container } = render(
      <GeneratedProse text={"Step 1.\\n  dotnet new sln -n Greeter"} />,
    );

    const pre = container.querySelector("pre");
    expect(pre?.textContent).toBe("dotnet new sln -n Greeter");
    expect(pre?.className).toContain("overflow-x-auto");
  });

  /**
   * A newline inside a paragraph is a break the model meant, not a soft wrap —
   * these bodies arrive as one long unwrapped line per paragraph. Joining them
   * with a space ran a command's printed output into the sentence explaining
   * it: "This prints: Hello Ada You pass --project because…".
   */
  it("keeps a line break inside a paragraph as a line break", () => {
    const { container } = render(
      <GeneratedProse text={"This prints: Hello Ada\nYou pass --project because…"} />,
    );

    const p = container.querySelector("p")!;
    expect(p.textContent).toBe("This prints: Hello Ada\nYou pass --project because…");
    expect(p.className).toContain("whitespace-pre-line");
  });

  /**
   * The code panel's fill has to be the opposite of whatever the prose sits on,
   * and in light `--surface` and `--raised` are both `#FFFFFF` — get it the
   * wrong way round and every listing disappears.
   */
  it("steps the listing up off the page when reading, down off a panel when compact", () => {
    const { container: reading } = render(
      <GeneratedProse variant="reading" text={"  ls"} />,
    );
    const { container: compact } = render(
      <GeneratedProse variant="compact" text={"  ls"} />,
    );

    expect(reading.querySelector("pre")!.className).toContain("bg-surface");
    expect(compact.querySelector("pre")!.className).toContain("bg-ground");
  });

  /** The fix for "hard to follow": the paragraph gap must beat the line gap. */
  it("sets a reading paragraph gap larger than its line height", () => {
    const { container } = render(<GeneratedProse variant="reading" text="Hi." />);

    expect(container.firstElementChild?.className).toContain("gap-7");
  });

  it("takes a className for the caller's own spacing", () => {
    const { container } = render(<GeneratedProse text="Hi." className="mt-4" />);

    expect(container.firstElementChild?.className).toContain("mt-4");
  });
});
