/**
 * The one link to "we do not have that subject, so we will build it".
 *
 * It lives here rather than beside the search box because three places now
 * build it — the dropdown's last row, `/learn`'s empty result, and `/start`
 * itself when it has to bounce a signed-out visitor through sign-in — and a
 * subject that survives two of those three is worse than one that survives
 * none: it works right up until the moment someone signs up.
 */
export const CUSTOM_PATH_HREF = "/start";

export function customPathHref(topic: string): string {
  const subject = topic.trim();
  return subject.length === 0
    ? CUSTOM_PATH_HREF
    : `${CUSTOM_PATH_HREF}?topic=${encodeURIComponent(subject)}`;
}
