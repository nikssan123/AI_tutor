import { ChevronIcon, TickIcon } from "@/components/icons";
import { Meta, Status, type StatusTone } from "@/components/ui";
import type {
  CheckName,
  ValidatorCheck,
  ValidatorReport,
} from "@/lib/contracts/curriculum";

/**
 * §14.6's validator report, as something a learner can read.
 *
 * The band this replaces printed the report: nine rows, each a `Pass` badge and
 * the check's `detail` string in full. Two things were wrong with that, and
 * only the first is a layout problem.
 *
 * **Nine sentences is not nine facts.** A passing check's detail is a
 * restatement of its own name — "Every targeted skill exists in the pack
 * graph" is what `no_hallucinated_skills` *means* — so the wall of text carried
 * one bit of information per row and made the reader find it. The names are the
 * report; the sentence is only news when a check did not pass.
 *
 * **And the detail is not written for a learner.** These strings are the repair
 * loop's input: they carry skill slugs, similarity floats, module ordinals, and
 * in `factual_spotcheck`'s case a model's entire list of findings joined into
 * one paragraph — the real report on this page ran to three thousand words in a
 * single row. So a flagged check's findings are split back into the list they
 * were before `architect.ts` joined them, and folded behind a `<details>` when
 * there is more than a line of it. Folded, not dropped: the whole point of the
 * band is that a learner can see what was checked and what it found.
 *
 * The disclosure is `<details>`, like the depth dial on the same screen — the
 * findings are in the HTML either way and open with no JavaScript.
 */

/**
 * What each check is, in the learner's terms.
 *
 * Named for what it protects rather than what it tests: `no_already_mastered`
 * is on this screen because "don't make me redo what I can already do" is the
 * promise, not because a threshold was compared.
 */
const CHECK_TITLE: Record<CheckName, string> = {
  prereq_completeness: "Nothing before its prerequisites",
  no_hallucinated_skills: "Every skill is a real one",
  no_redundancy: "Nothing taught twice",
  length_sanity: "It fits the hours you have",
  difficulty_ramp: "It steps up, and never back",
  no_already_mastered: "Nothing you have already proved",
  resource_freshness: "Every source still stands up",
  rubric_coverage: "Graded work has its bar published",
  factual_spotcheck: "The content checks out",
};

/**
 * A report older than the check list it was written against still renders. The
 * stored column is parsed loosely (`parseReport`) precisely so an old shape
 * shows rather than crashing the page it exists to explain, and a name with no
 * title is shown as the name — unlovely, and better than a blank row.
 */
function titleOf(name: CheckName): string {
  return CHECK_TITLE[name] ?? name;
}

/**
 * `architect.ts` joins the spot-check's findings with " · " because the
 * contract stores one string. Splitting it back is the presentation layer
 * doing the only thing it can for reports already in the database — a list of
 * findings reads as a list, and twenty-five of them joined into a paragraph
 * reads as nothing at all.
 */
function findingsOf(detail: string): string[] {
  return detail
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * A single finding this short is shown where it is. Above it — or with a second
 * finding beside it — the row folds, because a flagged check is the exception
 * and a band that changes height by a factor of ten depending on what a model
 * wrote is the thing being fixed here.
 */
const FINDING_INLINE_MAX = 140;

/** The severity, said in a word. A warning is a note; a blocking check is not. */
const FLAG_WORD: Record<ValidatorCheck["severity"], string> = {
  blocking: "Failed",
  warning: "Flagged",
};

const FLAG_TONE: Record<ValidatorCheck["severity"], StatusTone> = {
  blocking: "problem",
  warning: "attention",
};

/** "1 finding", not "1 findings". */
function countFindings(n: number): string {
  return `${n} ${n === 1 ? "finding" : "findings"}`;
}

/**
 * One flagged check.
 *
 * `<details>` in both cases, open when there is a line of it and closed when
 * there are twenty — the same rule, and the same reason, as the depth dial on
 * this screen: the fold is what keeps the band a fixed size whatever a model
 * wrote, and a single short sentence a learner has to click for is a finding
 * made deliberately harder to read.
 */
function FlaggedRow({ check }: { check: ValidatorCheck }) {
  const findings = findingsOf(check.detail);

  return (
    <li className="border-b border-hairline px-5 py-4 last:border-b-0">
      <details
        className="group"
        open={findings.length <= 1 && check.detail.length <= FINDING_INLINE_MAX}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 [&::-webkit-details-marker]:hidden">
          <ChevronIcon className="size-3.5 shrink-0 text-ink-faint transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] group-open:rotate-90" />
          <span className="text-[length:var(--text-label-size)] font-[550] text-ink">
            {titleOf(check.name)}
          </span>
          <Status tone={FLAG_TONE[check.severity]}>
            {FLAG_WORD[check.severity]}
          </Status>
          <Meta className="ml-auto">{countFindings(findings.length)}</Meta>
        </summary>

        {/* `max-w` because these are paragraphs, and a paragraph the full width
            of this column is a paragraph nobody finishes. */}
        <ul className="m-0 mt-3 flex max-w-[68ch] list-none flex-col gap-2 p-0 pl-7">
          {findings.map((finding, index) => (
            <li
              key={index}
              className="border-t border-hairline pt-2 first:border-t-0 first:pt-0"
            >
              <Meta className="block leading-snug">{finding}</Meta>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/**
 * The card's dot takes the worst thing in the report, so it cannot read calmer
 * than the row beneath it.
 */
function verdictTone(flagged: ValidatorCheck[]): StatusTone {
  if (flagged.length === 0) return "verified";
  return flagged.some((check) => check.severity === "blocking")
    ? "problem"
    : "attention";
}

export function CurriculumChecks({ report }: { report: ValidatorReport }) {
  const flagged = report.checks.filter((check) => !check.passed);
  const passed = report.checks.filter((check) => check.passed);
  const total = report.checks.length;

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-raised)]">
      {/* The verdict, before the enumeration. It is the only thing most people
          want from this band, and it used to be something you counted. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-5 py-4">
        <Status tone={verdictTone(flagged)}>
          {flagged.length === 0
            ? `All ${total} checks passed`
            : `${flagged.length} of ${total} flagged`}
        </Status>
      </div>

      {flagged.length > 0 ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {flagged.map((check) => (
            <FlaggedRow key={check.name} check={check} />
          ))}
        </ul>
      ) : null}

      {/* Everything that cleared, as names. The tick is decorative — the word
          above the list is what says these passed (§8.5.5). */}
      {passed.length > 0 ? (
        <div className="flex flex-col gap-3 px-5 py-4">
          {/* Only when something above it did not pass. With a clean report the
              header directly above already says these are the ones that
              passed, and a second word saying it is furniture. */}
          {flagged.length > 0 ? <Meta>Passed</Meta> : null}
          {/* A grid rather than a wrap: nine names of nine different lengths
              packed by `flex-wrap` land in a different place on every screen
              width, and a list you cannot run your eye down a column of is the
              wall this band was. */}
          <ul className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {passed.map((check) => (
              <li key={check.name} className="flex items-center gap-2">
                <TickIcon className="size-3.5 shrink-0 text-accent" />
                <span className="text-[length:var(--text-label-size)] text-ink-muted">
                  {titleOf(check.name)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
