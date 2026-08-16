import { AppLoading } from "@/components/app-shell";

/**
 * The boundary that makes this route prefetchable at all.
 *
 * Next skips prefetching a dynamic route without one, and this is a rail
 * destination — the kind that is hovered before it is clicked, and the kind
 * where a couple of hundred milliseconds of nothing reads as a broken link.
 *
 * Two bands and a heading: this route either hands over to the path screen,
 * whose own boundary takes it from there, or draws the "nothing running" card
 * under the same title. Both start with the heading below.
 */
export default function Loading() {
  return <AppLoading title="Your path" bands={2} />;
}
