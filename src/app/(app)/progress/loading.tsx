import { AppLoading } from "@/components/app-shell";

/**
 * No title. This screen opens "The last seven days" with a course running and
 * "Your week" without one, and which of those is true is exactly what we are
 * still waiting on — so writing either would mean swapping the heading out from
 * under someone who had already started reading it.
 */
export default function Loading() {
  return <AppLoading bands={3} />;
}
