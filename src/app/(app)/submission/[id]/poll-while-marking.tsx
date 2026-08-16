"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Looks again while the work is being marked, without reloading the page.
 *
 * This screen used to poll with `<meta http-equiv="refresh">`, which is a full
 * document reload every few seconds: the page blanks, the shell is rebuilt, the
 * scroll position resets, and the whole thing visibly pops — repeatedly, for
 * the minute or so that marking takes. A learner watching their own work being
 * marked was shown a page that looked like it was crashing and recovering.
 *
 * `router.refresh()` re-runs the server component and swaps in what changed.
 * Same polling, same interval, no reload — and when the evaluation lands, the
 * marked screen replaces the skeleton in place.
 *
 * The meta tag stays on the page inside a `<noscript>`, so a browser without
 * JavaScript still arrives at the result the old way. That is why this is a
 * component and not a `setInterval` in the page: only the enhancement is
 * client-side, and the fallback does not depend on it.
 */
export function PollWhileMarking({ seconds }: { seconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1_000);
    return () => clearInterval(id);
  }, [router, seconds]);

  return null;
}
