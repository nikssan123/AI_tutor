import { Meta, Title } from "@/components/ui";
import { supportAddress } from "@/lib/site";

/**
 * The two legal pages share a shape so they cannot drift into two documents
 * with two different voices — the usual fate of a terms page and a privacy
 * page written a week apart.
 *
 * They read as prose rather than as clauses on purpose. §8.5.1 asks for plain
 * language everywhere, and a privacy policy is the page where a reader is most
 * entitled to it and least often given it.
 *
 * Deliberately not `SectionHead`. That component numbers its bands — "01 · The
 * skill map" — because a marketing page is walking someone through an argument
 * in order. A legal page is a reference you land in the middle of, and a
 * numbered eyebrow on clause four would be claiming a narrative it does not
 * have.
 */

/** Moves only when the text does. Both pages show it; neither computes it. */
export const LEGAL_UPDATED = "15 August 2026";

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5 border-t border-hairline pt-8">
      <Title>{title}</Title>
      <div
        className={[
          "flex max-w-[var(--measure)] flex-col gap-4",
          "text-[length:var(--text-lead-size)] leading-[var(--text-lead-line)] text-ink",
          // Lists are reset globally, so the two the pages use are styled here
          // rather than each page inventing its own spacing.
          "[&_ul]:m-0 [&_ul]:flex [&_ul]:list-none [&_ul]:flex-col [&_ul]:gap-3 [&_ul]:p-0",
          "[&_li]:border-l-2 [&_li]:border-hairline [&_li]:pl-4",
          "[&_strong]:font-[650]",
        ].join(" ")}
      >
        {children}
      </div>
    </section>
  );
}

export function SupportLine() {
  const address = supportAddress();
  return (
    <Meta>
      <a href={`mailto:${address}`} className="text-accent">
        {address}
      </a>
    </Meta>
  );
}
