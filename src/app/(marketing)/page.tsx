import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggleStatic } from "@/components/theme-toggle-static";
import { Button, DisplayTitle, Lead, Meta, Title } from "@/components/ui";
import { canonical } from "@/lib/site";

/**
 * §8 screen 1 — the landing page. One job: convert cold traffic to a free Skill
 * Check in under 60 seconds. Nothing else.
 *
 * §13.1 — statically rendered with no auth provider in the React tree, so Core
 * Web Vitals are excellent by construction and the JS budget stays under 80KB.
 */
export const metadata: Metadata = {
  title: "Don't just learn it. Prove it.",
  description:
    "Tell it your goal. It finds your gaps, sets you real work, grades what you make, and shows you exactly what you can do — and what's left.",
  alternates: { canonical: canonical("/") },
};

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-20">
      <div className="flex flex-col gap-5">
        <DisplayTitle>Don&rsquo;t just learn it. Prove it.</DisplayTitle>
        <Lead>
          Tell it your goal. It finds your gaps, sets you real work, grades what
          you make, and shows you exactly what you can do — and what&rsquo;s left.
        </Lead>
      </div>

      <div className="flex flex-col gap-3">
        <Title>What do you want to get good at?</Title>
        <Meta>
          The goal interview and the free Skill Check land in E3 and E11. For now
          this page exists to hold the route, the metadata and the JS budget.
        </Meta>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Button disabled>Start your free skill check</Button>
        <Link
          href="/design"
          className="text-accent text-[length:var(--text-label-size)]"
        >
          Design reference
        </Link>
      </div>

      <footer className="mt-16 flex items-center justify-between border-t border-hairline pt-8">
        <Meta>ChatGPT can teach you anything. It can&rsquo;t tell you whether you&rsquo;ve learned it.</Meta>
        <ThemeToggleStatic />
      </footer>
    </main>
  );
}
