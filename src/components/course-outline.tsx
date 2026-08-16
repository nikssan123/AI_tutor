import {
  ArrowIcon,
  ChecklistIcon,
  ChevronIcon,
  LockIcon,
  MasteryIcon,
  PlusIcon,
} from "@/components/icons";
import { cx, Meta, Status, type StatusTone } from "@/components/ui";
import {
  SKILL_STATE_WORD,
  SKILL_STATES,
  type Outline,
  type OutlineSection,
  type OutlineSkill,
  type SkillState,
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
 *
 * **Every row leads with a mark**, and that is the change this file exists
 * for. The list previously said all four states the same way — a `Status` dot
 * and a word, in the middle of a row, at the same weight as the hours beside
 * it — so a locked skill and an open one had identical silhouettes and the
 * list could only be read a line at a time. A mark in the gutter is what makes
 * it scannable: a lock is a lock from across the room.
 *
 * It does not reopen §8.5.5's ban on icons. That rule is *"no tooltips that
 * explain an icon"* and *"colour is never the sole carrier of meaning"*, and
 * both still hold — every mark sits beside its own word **and** the sentence
 * saying why the row reads that way, so the glyph is the third statement of the
 * same fact rather than the only one.
 */

/**
 * The mark, the tile it sits in, and nothing else — the word comes from
 * `SKILL_STATE_WORD`, so the list, the legend and the graph's key cannot drift
 * into three vocabularies for four states.
 *
 * The accent goes on what is *next*, never on what is finished. `open` is the
 * one solid tile in the list, because "what can I actually start" is the
 * question a learner opens this screen with; `proved` gets the weak field,
 * because a screen that shouts loudest about completed work is answering a
 * question nobody asked it.
 */
const MARK: Record<
  SkillState,
  { Icon: (props: { className?: string }) => React.ReactElement; tile: string }
> = {
  open: { Icon: ArrowIcon, tile: "bg-accent text-on-accent" },
  locked: {
    Icon: LockIcon,
    tile: "border border-hairline bg-ground text-ink-faint",
  },
  proved: { Icon: MasteryIcon, tile: "bg-accent-weak text-accent" },
  optional: {
    Icon: PlusIcon,
    // Dashed, so the two quiet states are still told apart with the colour
    // ignored: a lock is waiting on something, an outline is waiting on you.
    tile: "border border-dashed border-hairline text-ink-faint",
  },
};

/** The section header keeps `Status`, because the mark column is its number. */
const TONE: Record<SkillState, StatusTone> = {
  open: "verified",
  locked: "neutral",
  proved: "neutral",
  optional: "neutral",
};

/** The shared tile. `size` is the only thing the legend does differently. */
function Marker({
  state,
  className,
  iconClassName,
}: {
  state: SkillState;
  className: string;
  iconClassName: string;
}) {
  const { Icon, tile } = MARK[state];
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex shrink-0 items-center justify-center rounded-[var(--radius-control)]",
        className,
        tile,
      )}
    >
      <Icon className={iconClassName} />
    </span>
  );
}

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
 * What the whole list adds up to: the mark, the count and the word, four
 * times. Zero counts are dropped — "0 locked" is a sentence about nothing.
 *
 * It draws the same tiles the rows do, which is the only reason a key above a
 * list is worth the space it takes: a legend whose swatches do not match the
 * thing they explain is a second thing to learn.
 */
export function OutlineLegend({ counts }: { counts: Outline["counts"] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-3 p-0">
      {SKILL_STATES.filter((state) => counts[state] > 0).map((state) => (
        <li key={state} className="flex items-center gap-2">
          <Marker state={state} className="size-6" iconClassName="size-3.5" />
          {/* One string, not three children: a count split across text nodes
              reads the same to a person and differently to everything else. */}
          <span className="text-[length:var(--text-label-size)] text-ink">
            {`${counts[state]} ${SKILL_STATE_WORD[state].toLowerCase()}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The mark sits in the column the section's number chip occupies, so a row's
 * *name* lands under the section *title* rather than under its furniture. Rows
 * go full-bleed below `sm`, where 52px of indent would be an eighth of the
 * screen before the mark has been drawn.
 */
const ROW = "flex items-start gap-4 border-t border-hairline py-4 pr-5 pl-5 sm:pl-13";

/** Matches the mark's tile, so the first line and the glyph share a centre. */
const ROW_HEAD = "flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1";

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
    <li className={ROW}>
      <Marker state={skill.state} className="size-8" iconClassName="size-4" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className={ROW_HEAD}>
          <span
            className={cx(
              // `break-words` for the same reason the section title carries it:
              // a name with no space in it cannot wrap, and a flex item that
              // cannot wrap and cannot shrink paints over its neighbour.
              "min-w-0 flex-1 text-[length:var(--text-label-size)] font-[550] break-words",
              reachable ? "text-ink" : "text-ink-muted",
            )}
          >
            {skill.name}
          </span>
          {skill.hours > 0 ? <Meta>{`${skill.hours}h`}</Meta> : null}
          <Meta>{SKILL_STATE_WORD[skill.state]}</Meta>
        </div>
        <Meta className="leading-snug">{skill.note}</Meta>
      </div>
    </li>
  );
}

/**
 * The hand-in is the point of the module (§2.2), so it gets a row of its own
 * rather than a tag on the section header — and it keeps the mark column,
 * because a row that starts 32px left of every other row in the card reads as
 * a footnote rather than as the thing the module was for.
 */
function HandInRow({ handIn }: { handIn: string }) {
  return (
    <li className={cx(ROW, "bg-accent-weak")}>
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent text-on-accent"
      >
        <ChecklistIcon className="size-4" />
      </span>

      <div className={cx(ROW_HEAD, "min-w-0 flex-1")}>
        <span className="min-w-0 flex-1 text-[length:var(--text-label-size)] font-[550] text-ink">
          {handIn}
        </span>
        <Status tone="verified">Graded</Status>
      </div>
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
          {/*
            `basis-40` is load-bearing, and the bug it fixes is worth naming.

            With `flex-1` alone the title's hypothetical size is zero, so the
            row never wrapped on its account — it simply handed the title
            whatever was left after the facts and the status had taken theirs.
            At a 390px viewport that was ten pixels, and "Exposure" painted
            straight over "3 skills · 4h to go". (At 360 the status wrapped for
            its own reasons and it looked fine, which is how it survived.)

            A real basis puts the title into the line-breaking sum, so a narrow
            screen drops the facts to a second line instead of crushing the one
            word the row is actually about. `min-w-0` stays for after the wrap;
            `break-words` is the backstop for a single word longer than the card.
          */}
          <span className="min-w-0 flex-1 basis-40 text-[length:var(--text-lead-size)] font-[550] break-words text-ink">
            {section.title}
          </span>
          <Meta>{factsOf(section)}</Meta>
          <Status tone={TONE[section.state]}>
            {SKILL_STATE_WORD[section.state]}
          </Status>
        </summary>

        <ul className="m-0 list-none p-0">
          {section.skills.map((skill) => (
            <SkillRow key={skill.skillId} skill={skill} />
          ))}
          {section.handIn ? <HandInRow handIn={section.handIn} /> : null}
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
