import { AppLoading } from "@/components/app-shell";

/**
 * `narrow`: work that is still being marked opens in the same column the
 * marking screen uses while it waits, and only widens once there is a verdict
 * to lay out.
 */
export default function Loading() {
  return <AppLoading width="narrow" bands={1} />;
}
