/**
 * The two bubble shapes, written once.
 *
 * Shared because the conversation is rendered on the server and the turn you
 * have just taken is echoed on the client, and a message that changes shape
 * the moment the server confirms it is the tell that it was never really sent.
 */
export const LEARNER_BUBBLE =
  "self-end max-w-[85%] rounded-[var(--radius-card)] bg-accent-weak px-5 py-3.5";

/**
 * Filled as well as outlined. On the dark ground an outline-only bubble reads
 * as an empty card rather than as something someone said, and the learner's
 * side is filled — one speaker drawn as a message and the other as a container
 * is what made the column look like a form. The border stays because in light
 * `--surface` on `--ground` is a 2% step and the edge is all there is.
 */
export const ANALYZER_BUBBLE =
  "self-start max-w-[90%] rounded-[var(--radius-card)] border border-hairline bg-surface px-5 py-3.5";
