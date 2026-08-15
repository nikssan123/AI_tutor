import { AppLoading } from "@/components/app-shell";

/**
 * `narrow`, because the session itself is — one block at a time, read at a
 * measure. A `wide` placeholder would collapse to a narrow column the moment
 * the real screen arrived.
 *
 * The heading is the skill being worked on, which is what we are fetching.
 */
export default function Loading() {
  return <AppLoading width="narrow" bands={2} />;
}
