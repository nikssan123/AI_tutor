import type { Metadata } from "next";
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
    "Tell it your goal. It finds your gaps, sets you real work, grades what you make, and shows you exactly what you can do — and what's left.",
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
         * §8.5.4 — blocking, inline, before any stylesheet. Every marketing page
         * is statically generated, so the server cannot know the visitor's
         * theme; without this there is a flash of the wrong one on every cold
         * load.
         */}
        <script
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
