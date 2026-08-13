import { SiteFooter, SiteHeader } from "@/components/marketing";

/**
 * §13.1 — the marketing segment.
 *
 * Deliberately has no auth provider anywhere in its React tree: that is what
 * lets these routes render fully at build time with near-zero JS, which is why
 * Core Web Vitals are good "by construction" rather than by optimisation.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-ground text-ink">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
