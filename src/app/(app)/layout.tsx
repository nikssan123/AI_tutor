import type { Metadata } from "next";

/**
 * §13.1 — the authenticated segment.
 *
 * `noindex` is set at the *layout* level rather than per page, which is what
 * makes §13.3's guarantee structural: no authenticated route can leak into the
 * index by accident, including ones nobody remembers to annotate.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Dynamic by construction — nothing under (app) is ever statically cached. */
export const dynamic = "force-dynamic";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-ground text-ink">{children}</div>;
}
