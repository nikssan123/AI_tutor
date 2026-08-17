import { Analytics, analyticsContext } from "@/components/analytics";
import { SiteFooter, SiteHeader } from "@/components/marketing";

/**
 * §13.1 — the marketing segment.
 *
 * There is still no auth *provider* in this tree — nothing here hydrates, and
 * the near-zero JS that §13.3's Core Web Vitals rest on is unchanged. What did
 * change is the rendering mode: `SiteHeader` reads the session, so these routes
 * are rendered per request rather than prerendered at build time and
 * revalidated daily. A header that can say "Sign in" to someone already signed
 * in is a page that has to know who is asking, and that answer arrives with the
 * request.
 *
 * The `revalidate = 86_400` each page still exports is inert while that is
 * true. It is left in place deliberately: it records the policy these routes
 * want, and it is what comes back into effect if the header ever stops reading
 * the session. The comments beside those exports still describe the old mode.
 */
export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-ground text-ink">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
      {/*
       * These pages are recorded as they look — there is nothing on them that
       * is not already public, and the funnel a replay is for lives here. The
       * signed-in tree is the opposite case and marks itself `data-private`.
       */}
      <Analytics context={await analyticsContext()} />
    </div>
  );
}
