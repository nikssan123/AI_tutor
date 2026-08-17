import type { Metadata } from "next";
import { goalSearchScript } from "@/lib/goal-search-script";
import { siteUrl } from "@/lib/site";
import { themeInitScript, themeToggleScript } from "@/lib/theme-script";
import "@/styles/globals.css";

export const metadata: Metadata = {
  // `siteUrl()` rather than reading the variable with its own `??` fallback:
  // that was a second, untested copy of logic src/lib/site.ts already owns —
  // and CI sets NEXT_PUBLIC_SITE_URL, so the fallback arm was unreachable from
  // the suite and held branch coverage at 99.98%. One origin, one test.
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Don't just learn it. Prove it.",
    template: "%s · MeritKeep",
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

        {/*
         * The marketing footer's theme toggle, here for the same two reasons
         * and one more: rendered inside the component it never ran when the
         * page streamed, and on a client-side navigation React refuses to run
         * it at all — it logs "Scripts inside React components are never
         * executed when rendering on the client" and the toggle stays dead.
         *
         * Inert on routes with no toggle markup, which is every route under
         * (app) — those get the Radix `ThemeToggle`, and the cost here is the
         * bytes, not any behaviour.
         */}
        <script
          dangerouslySetInnerHTML={{ __html: themeToggleScript }}
        />
      </head>
      {/*
       * suppressHydrationWarning, for a different reason than the one on
       * `<html>` above: nothing we render here differs between server and
       * client. Browser extensions do — ColorZilla stamps
       * `cz-shortcut-listen="true"` on the body, Grammarly and the password
       * managers add their own — and they do it after the server HTML lands
       * and before React hydrates, which is precisely the window a mismatch is
       * measured in.
       *
       * It is worth suppressing rather than living with because of what the
       * noise costs: a dev overlay that cries wolf on every page load is an
       * overlay you stop reading, and the next hydration error — a real one —
       * goes past with it.
       *
       * The scope is what makes this safe. The flag covers this element's own
       * attributes and its direct text only; it does not reach `{children}`,
       * so a genuine mismatch anywhere in the tree below still reports.
       */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
