import { AppLoading } from "@/components/app-shell";

/** A grid of small cards — identity, email, language, theme, plan, sign out. */
export default function Loading() {
  return <AppLoading title="Account" bands={3} />;
}
