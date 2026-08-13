import type { Metadata } from "next";
import { goalSearchScript } from "@/lib/goal-search-script";
import { themeInitScript } from "@/lib/theme-script";
import "@/styles/globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "Don't just learn it. Prove it.",
    template: "%s · online_uni",
  },
  description:
    "Name any subject — if nobody has written it, we write it for you. Then it finds your gaps, sets you real work, and grades what you make against a public checklist.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the inline script below sets data-theme before
    // React hydrates, so the server and client markup legitimately differ here.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
         * §13.3's LCP budget names the preloaded font, and without this line the
         * font is not preloaded: it is referenced from `globals.css`, so the
         * browser cannot discover it until the stylesheet has downloaded and
         * parsed. That is one full round-trip after the HTML, which lands right
         * on the text the LCP element is made of.
         *
         * `crossOrigin` is required even same-origin — fonts are fetched in CORS
         * mode, and a preload without it is fetched a second time rather than
         * reused, which is slower than not preloading at all.
         */}
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href="/fonts/instrument-sans-variable.woff2"
          crossOrigin="anonymous"
        />

        {/*
         * §8.5.4 — blocking, inline, before any stylesheet. Every marketing page
         * is statically generated, so the server cannot know the visitor's
         * theme; without this there is a flash of the wrong one on every cold
         * load.
         */}
        <script
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />

        {/*
         * The subject dropdown on `/` and `/learn`.
         *
         * Here rather than beside its own markup, and for a reason worth
         * keeping: Next streams the page, so body content that arrives in a
         * later chunk is *inserted* into the document rather than parsed into
         * it — and an inserted `<script>` does not run. React re-creates it at
         * hydration, so the control stayed dead until then and every press in
         * between was dropped. In `<head>` it runs before the body exists,
         * which is safe because it only delegates from `document` and touches
         * nothing until the visitor does.
         *
         * It is inert on routes with no search box, which is every route under
         * (app) — the cost there is the bytes, not any behaviour.
         */}
        <script
          dangerouslySetInnerHTML={{ __html: goalSearchScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
