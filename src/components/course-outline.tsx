import { ChevronIcon } from "@/components/icons";
import { cx, Meta, Status, type StatusTone } from "@/components/ui";
import type {
  Outline,
  OutlineSection,
  OutlineSkill,
  SkillState,
} from "@/lib/goals/outline";

/**
 * The course, as a list you can read.
 *
 * §8.5.5's row list, nested one level: a card per section, rows inside it. The
 * nesting is the one thing here that is not already in the vocabulary, and it
 * earns the exception the same way `Figure` did — a flat list of forty skills
 * with no sections is not a curriculum, it is an inventory, and the shape of
 * the course is exactly what a learner comes to this screen to see.
 *
 * **No JavaScript.** `<details>` is the disclosure, so a section opens with the
 * page's own HTML — no state, no hydration, and it works before React loads.
 * The one that arrives open is the one with work in it.
 *
 * **No percentage, and no bar** (§4.2 law 3, §24 E9). Every course catalogue
 * this borrows its shape from puts "37% complete" at the top; the counts here
 * say the same thing without implying that a course is a container you fill.
 */

const WORD: Record<SkillState, string> = {
  open: "Open now",
  locked: "Locked",
  proved: "Already yours",
  optional: "Optional",
};

/**
 * The accent goes on what is *next*, never on what is finished — the same rule
 * the graph below this list draws by. A screen that shouts loudest about
 * completed work is answering a question nobody asked it.
 */
const TONE: Record<SkillState, StatusTone> = {
  open: "verified",
  locked: "neutral",
  proved: "neutral",
  optional: "neutral",
};

/** Legend order: what you can do, then what is in the way, then the rest. */
const LEGEND: SkillState[] = ["open", "locked", "proved", "optional"];

/** "1 skill", not "1 skills". */
function countOf(n: number): string {
  return `${n} ${n === 1 ? "skill" : "skills"}`;
}

/**
 * A section header says how much is in it and how long it is owed, and stops.
 * Hours are the remaining estimate, so they total to the figure in the page
 * header rather than to a brochure number.
 */
function factsOf(section: OutlineSection): string {
  const count = countOf(section.skills.length);
  return section.hours > 0 ? `${count} · ${section.hours}h to go` : count;
}

/**
 * What the whole list adds up to, in the sanctioned component: a dot and a
 * word, four times. Zero counts are dropped — "0 locked" is a sentence about
 * nothing.
 */
export function OutlineLegend({ counts }: { counts: Outline["counts"] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-3 p-0">
      {LEGEND.filter((state) => counts[state] > 0).map((state) => (
        <li key={state}>
          {/* One string, not three children: a count split across text nodes
              reads the same to a person and differently to everything else. */}
          <Status tone={TONE[state]}>
            {`${counts[state]} ${WORD[state].toLowerCase()}`}
          </Status>
        </li>
      ))}
    </ul>
  );
}

/**
 * Rows line up under the section *title*, not under the card edge — the chevron
 * and the number are the section's furniture, and a row that starts to the left
 * of the thing it belongs to reads as a sibling of it. Full-bleed below `sm`,
 * where 100px of indent would be a quarter of the screen.
 */
const ROW = "border-t border-hairline py-4 pr-5 pl-5 sm:pl-25";

/**
 * One skill.
 *
 * The name dims when the skill is not yours to start, which is the whole visual
 * grammar of a locked list — and the sentence under it says why, because §8.5.5
 * bans an icon that needs explaining and a grey row with no words is worse than
 * that: it is an icon with no tooltip at all.
 */
function SkillRow({ skill }: { skill: OutlineSkill }) {
  const reachable = skill.state === "open" || skill.state === "proved";

  return (
    <li className={cx("flex flex-wrap items-baseline gap-x-4 gap-y-1", ROW)}>
      <span
        className={cx(
          "min-w-0 flex-1 text-[length:var(--text-label-size)] font-[550]",
          reachable ? "text-ink" : "text-ink-muted",
        )}
      >
        {skill.name}
      </span>
      {skill.hours > 0 ? <Meta>{`${skill.hours}h`}</Meta> : null}
      <Status tone={TONE[skill.state]}>{WORD[skill.state]}</Status>
      <Meta className="basis-full">{skill.note}</Meta>
    </li>
  );
}

function Section({ section, index }: { section: OutlineSection; index: number }) {
  return (
    <li>
      <details
        open={section.current}
        className="group overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-raised)]"
      >
        <summary className="flex min-h-[var(--touch-min)] cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <ChevronIcon className="size-4 text-ink-faint transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] group-open:rotate-90" />
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-weak text-[length:var(--text-meta-size)] font-[650] text-accent tabular-nums"
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 text-[length:var(--text-lead-size)] font-[550] text-ink">
            {section.title}
          </span>
          <Meta>{factsOf(section)}</Meta>
          <Status tone={TONE[section.state]}>{WORD[section.state]}</Status>
        </summary>

        <ul className="m-0 list-none p-0">
          {section.skills.map((skill) => (
            <SkillRow key={skill.skillId} skill={skill} />
          ))}
          {section.handIn ? (
            /* The hand-in is the point of the module (§2.2), so it gets a row
               of its own rather than a tag on the section header. */
            <li
              className={cx(
                "flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-accent-weak",
                ROW,
              )}
            >
              <span className="min-w-0 flex-1 text-[length:var(--text-label-size)] font-[550] text-ink">
                {section.handIn}
              </span>
              <Status tone="verified">Graded</Status>
            </li>
          ) : null}
        </ul>
      </details>
    </li>
  );
}

export function CourseOutline({ outline }: { outline: Outline }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {outline.sections.map((section, index) => (
        <Section key={section.key} section={section} index={index} />
      ))}
    </ol>
  );
}
