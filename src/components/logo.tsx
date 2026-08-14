import { cx } from "@/components/ui";

/**
 * The MeritKeep mark and lockup.
 *
 * Separate from `icons.tsx` on purpose. That file's house rules exist to keep a
 * *set* coherent — 24×24, 1.5 stroke, `currentColor` only, never naming a
 * colour. The mark keeps the grid and the stroke, because a logo drawn on a
 * different skeleton to the icons beside it is the thing that makes a header
 * look assembled from two products. It breaks exactly one of those rules, and
 * deliberately: it names the accent.
 *
 * §8.5.3 says the jade accent "carries the product's core semantic: verified".
 * Everywhere else that is a rule the icons inherit rather than state. Here it is
 * the whole idea — so the mark is drawn in two strokes:
 *
 * - The **stem and valley**, in `currentColor`: the M of MeritKeep, inheriting
 *   whatever ink the surface already uses, which is what makes it correct in
 *   both themes without a second definition (§8.5.4).
 * - The **rising arm**, in `--accent`: the same stroke read twice, as the M's
 *   second diagonal and as a tick that overshoots the shoulder it should have
 *   stopped at. The overshoot is the mark's whole argument — a checkbox says
 *   *done*, and §2.3 is explicit that "done" is the claim this product refuses
 *   to sell. A tick that keeps going says *this cleared the bar*.
 *
 * Drawn wider than tall (15.75 × 13.75 on the 24 grid, optically centred) so the
 * M reads as a letter rather than as a chevron. It survives flattening to one
 * colour, which is what `icon.svg` does for the favicon.
 */

type LogoProps = { className?: string };

/** The stem and the valley: the M, minus the arm that verifies it. */
const STEM = "M4.25 19V8.75l7 7.5";

/** The arm, overshooting the shoulder. Starts where `STEM` ends. */
const ARM = "M11.25 16.25 20 5.25";

/**
 * The mark alone. Sized in `em` rather than a fixed class so a lockup can scale
 * it from the type beside it and the two cannot drift apart.
 */
export function LogoMark({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx("size-[1.15em] shrink-0", className)}
    >
      <path d={STEM} stroke="currentColor" />
      <path d={ARM} stroke="var(--accent)" />
    </svg>
  );
}

/**
 * Mark plus name, as one object.
 *
 * The name is real text, not a path: it is the accessible name of the link that
 * wraps it on every page, it is what a screen reader announces, and it is what
 * gets selected and copied. A logo drawn as an image with `alt="MeritKeep"`
 * would satisfy the audit and still hand a copy-paste of nothing to the person
 * trying to quote us.
 *
 * §8.5.3: "Character comes from scale and tracking discipline, not from mixing
 * typefaces." So there is no logotype here — it is Instrument Sans at the label
 * size, 650, with the tracking the scale already specifies.
 */
export function Wordmark({ className }: LogoProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 text-[length:var(--text-label-size)] font-[650] tracking-[-0.02em] text-ink",
        className,
      )}
    >
      <LogoMark />
      MeritKeep
    </span>
  );
}
