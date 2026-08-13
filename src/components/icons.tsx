import { cx } from "@/components/ui";

/**
 * The icon set.
 *
 * Hand-drawn rather than imported, because §8.5.8 caps marketing routes at zero
 * component-library JavaScript and every icon package — lucide, heroicons,
 * phosphor — ships a React component per glyph and drags the client runtime
 * into a route that currently has none. Six inline paths cost nothing.
 *
 * House rules, so a later addition cannot quietly break the set:
 *
 * - 24×24 viewBox, 1.5 stroke, round caps and joins.
 * - `currentColor` only. An icon never names a colour; it inherits, which is
 *   what makes it work in both themes without a second definition (§8.5.4).
 * - Decorative. Every icon here sits beside a text label that already says the
 *   same thing, so they are `aria-hidden` and add nothing to the a11y tree.
 */

type IconProps = { className?: string };

function Svg({
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx("size-5 shrink-0", className)}
    >
      {children}
    </svg>
  );
}

/* ── Section icons ──────────────────────────────────────────────────────── */

/** An ordered list: the five steps. */
export function StepsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="5" cy="6" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="5" cy="18" r="1.25" fill="currentColor" stroke="none" />
      <path d="M10 6h9M10 12h9M10 18h5" />
    </Svg>
  );
}

/** A clipboard with a tick: the marking checklist. */
export function ChecklistIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 4.5h6a1 1 0 0 1 1 1V7H8V5.5a1 1 0 0 1 1-1Z" />
      <path d="M8 6.5H6.5A1.5 1.5 0 0 0 5 8v11a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8a1.5 1.5 0 0 0-1.5-1.5H16" />
      <path d="m9.25 13.25 2.25 2.25 4.25-4.25" />
    </Svg>
  );
}

/** A grid: the subject catalogue. */
export function GridIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

/* ── Subject icons ──────────────────────────────────────────────────────── */

/** Writing and communication. */
export function PenIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m16.5 4.5 3 3" />
      <path d="M14.4 6.6 5 16v3h3l9.4-9.4a1.7 1.7 0 0 0 0-2.4l-.6-.6a1.7 1.7 0 0 0-2.4 0Z" />
    </Svg>
  );
}

/** Photography and the visual domains. */
export function CameraIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h1.8l1.2-2h7l1.2 2h1.8A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="13" r="3.25" />
    </Svg>
  );
}

/** Data and query work. */
export function DatabaseIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <ellipse cx="12" cy="6" rx="7" ry="2.75" />
      <path d="M5 6v6c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75V6" />
      <path d="M5 12v6c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75v-6" />
    </Svg>
  );
}

/**
 * §7.1's taxonomy decides the icon, so adding a Domain Pack stays a data change
 * (§7.3 rule 1) — a new subject picks up the right mark without touching a
 * component. Anything unrecognised falls back to the neutral grid rather than
 * guessing at a metaphor.
 */
export function SubjectIcon({
  taxonomyParent,
  className,
}: IconProps & { taxonomyParent: string | null }) {
  const byTaxonomy: Record<string, (p: IconProps) => React.ReactElement> = {
    "professional-business": PenIcon,
    creative: CameraIcon,
    "technical-entry": DatabaseIcon,
  };
  const Chosen = byTaxonomy[taxonomyParent ?? ""] ?? GridIcon;
  return <Chosen className={className} />;
}
