import Link from "next/link";
import { Meta, revealAt } from "@/components/ui";
import type { GuideSection, GuideSource } from "@/lib/guides/types";

/**
 * The prose renderer for §10 D.
 *
 * It supports two marks and no more: `[^id]` for a citation and `*word*` for
 * emphasis. That is not laziness about markdown — it is the same wall §7.3
 * rule 3 puts around editors. A full markdown pipeline in a guide invites
 * headings, tables and images inside a section, and at that point the template
 * has stopped imposing a structure and the pages drift into fifty different
 * shapes, which is the state §12.1 rule 3 exists to prevent.
 *
 * Paragraphs are blank-line separated, which is how the YAML already reads.
 */

const MARKS = /(\[\^[a-z0-9-]+\]|\*[^*\n]+\*)/g;

function inline(text: string, sources: GuideSource[]): React.ReactNode[] {
  return text.split(MARKS).map((part, i) => {
    const citation = /^\[\^([a-z0-9-]+)\]$/.exec(part);
    if (citation) {
      const index = sources.findIndex((s) => s.id === citation[1]);
      // A citation with no source is blocked before a guide can be published,
      // so this only renders while one is being drafted. Showing the raw marker
      // is the right failure: it is visibly wrong, where a silently dropped
      // citation would read as an uncited claim.
      if (index === -1) return part;
      return (
        <sup key={i}>
          <Link
            href={`#source-${citation[1]}`}
            className="px-0.5 font-[650] text-accent no-underline"
            aria-label={`Source ${index + 1}`}
          >
            {index + 1}
          </Link>
        </sup>
      );
    }

    const emphasis = /^\*([^*\n]+)\*$/.exec(part);
    if (emphasis) return <em key={i}>{emphasis[1]}</em>;

    return part;
  });
}

export function Prose({
  text,
  sources,
}: {
  text: string;
  sources: GuideSource[];
}) {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  return (
    <div className="flex max-w-[var(--measure)] flex-col gap-5">
      {paragraphs.map((paragraph, i) => (
        <p
          key={i}
          className="text-[length:var(--text-lead-size)] leading-[var(--text-lead-line)] text-ink"
        >
          {inline(paragraph.trim(), sources)}
        </p>
      ))}
    </div>
  );
}

/**
 * §13.3's internal links, rendered where they were authored.
 *
 * They sit at the end of the section that earned them rather than in a strip at
 * the foot of the page, which is the whole of what "contextually, not as a
 * footer link dump" asks for. The link type is not shown: it is there so the
 * *author* has to say what kind of relationship this is, and a reader who needs
 * the label "next_step" to understand a sentence has been failed by the
 * sentence.
 */
export function SectionLinks({ section }: { section: GuideSection }) {
  if (section.links.length === 0) return null;

  return (
    <ul className="flex list-none flex-col gap-2 p-0 m-0">
      {section.links.map((link, i) => (
        <li key={link.to} className="reveal" style={revealAt(i)}>
          <Link
            href={link.to}
            className="text-[length:var(--text-label-size)] font-[550] text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
          >
            {link.anchor}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * §11 item 10 — "genuinely curated, external, with honest one-line
 * assessments". The assessment is the reason this is a section rather than a
 * list of superscripts: a link with a sentence about what it is worth is the
 * thing a reader can act on, and it is also the thing an AI summary can quote.
 */
export function Sources({ sources }: { sources: GuideSource[] }) {
  return (
    <ol className="flex list-none flex-col gap-6 p-0 m-0">
      {sources.map((source, i) => (
        <li
          key={source.id}
          id={`source-${source.id}`}
          className="flex max-w-[var(--measure)] flex-col gap-2 scroll-mt-24"
        >
          <a
            href={source.url}
            rel="noopener"
            className="text-[length:var(--text-label-size)] font-[650] text-ink underline decoration-hairline underline-offset-4 hover:decoration-accent"
          >
            {i + 1}. {source.title}
          </a>
          <Meta tone="muted">{source.note}</Meta>
        </li>
      ))}
    </ol>
  );
}
