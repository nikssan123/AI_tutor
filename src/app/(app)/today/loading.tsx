import { AppLoading } from "@/components/app-shell";

/**
 * The screen someone opens daily, so the one where a dead click is felt most.
 *
 * "Today" is the heading in both branches — a plan to run and nothing running —
 * so it is written rather than blocked out, and only the plan below it waits.
 */
export default function Loading() {
  return <AppLoading title="Today" bands={2} />;
}
