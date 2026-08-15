import { AppLoading } from "@/components/app-shell";

/** Three bands: what is due, what is coming, and the milestones under it. */
export default function Loading() {
  return <AppLoading title="Your calendar" bands={3} />;
}
