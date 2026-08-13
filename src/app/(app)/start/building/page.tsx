import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/db";
import { resolvePack } from "@/lib/content/resolve";
import { findBuild } from "@/lib/packs/build";
import { loadIntake } from "@/lib/goals/intake-store";
import {
  Button,
  Card,
  DisplayTitle,
  Lead,
  Meta,
  Status,
  Title,
} from "@/components/ui";
import { adoptBuiltPackAction, requestBuildAction } from "../actions";

/**
 * The wait, while §7.1's Generated tier authors a subject nobody curated.
 *
 * Around three minutes and three model calls, so this page's job is to be
 * honest about that rather than to look busy. It refreshes itself with a plain
 * `<meta>` tag — no polling script, no bundle, consistent with every other
 * screen here working without JavaScript.
 */
export const metadata: Metadata = {
  title: "Building your course",
  robots: { index: false, follow: false },
};

/** Long enough not to hammer the database, short enough to feel attended to. */
const REFRESH_SECONDS = 6;

type Props = { searchParams: Promise<{ subject?: string }> };

export default async function BuildingPage({ searchParams }: Props) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { subject } = await searchParams;
  const slug = (subject ?? "").trim();
  if (slug.length === 0) redirect("/start");

  const db = getDb();

  // The pack existing is the real answer; the build row is only how we got
  // here. Checking the pack first means a build that finished between two
  // refreshes is picked up even if its row was never updated.
  const pack = await resolvePack(db, slug);
  const build = await findBuild(db, slug);
  const intake = await loadIntake(db, session.user.id);

  if (pack) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
        <div className="rise flex flex-col gap-5">
          <DisplayTitle>{pack.name} is ready</DisplayTitle>
          <Lead>
            {pack.skills.length} skills, built for you just now. It has not been
            reviewed by a person yet, so tell us when something looks wrong.
          </Lead>
        </div>
        <Status tone="attention">Experimental — help us improve it</Status>
        <form action={adoptBuiltPackAction}>
          <input type="hidden" name="slug" value={pack.slug} />
          <Button type="submit">See my plan</Button>
        </form>
      </main>
    );
  }

  if (build?.status === "failed") {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
        <div className="rise flex flex-col gap-5">
          <DisplayTitle>We couldn&rsquo;t build this one</DisplayTitle>
          {/* §4.2 law 3 — say what actually happened rather than "try again". */}
          <Lead>{build.detail ?? "Something went wrong while building it."}</Lead>
        </div>
        <Meta>
          Rather than hand you a thin course, we stopped. You can try again, or
          pick a subject we already cover in depth.
        </Meta>
        <div className="flex flex-wrap gap-3">
          <form action={requestBuildAction}>
            <input type="hidden" name="slug" value={slug} />
            <input
              type="hidden"
              name="subject"
              value={intake.captured?.subject ?? slug}
            />
            <Button type="submit">Try again</Button>
          </form>
          <form action={requestBuildAction}>
            <input type="hidden" name="cancel" value="1" />
            <button
              type="submit"
              className="min-h-[var(--touch-min)] rounded-[var(--radius-control)] border border-hairline px-5 text-[length:var(--text-label-size)] hover:border-accent"
            >
              Pick something else
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      {/* No script: the page asks the browser to come back. */}
      <meta httpEquiv="refresh" content={String(REFRESH_SECONDS)} />

      <div className="rise flex flex-col gap-5">
        <DisplayTitle>Building your course</DisplayTitle>
        <Lead>
          Nobody has written {intake.captured?.subject ?? "this subject"} for us
          yet, so we&rsquo;re writing it now — the skills, what depends on what,
          and the questions that work out where you already are.
        </Lead>
      </div>

      <Card className="flex flex-col gap-3">
        <Title className="text-[length:var(--text-label-size)]">
          This takes about three minutes
        </Title>
        <Meta>
          You can leave this page. It keeps building, and it will be here when
          you come back.
        </Meta>
      </Card>

      <Meta tone="muted">
        This page checks again every {REFRESH_SECONDS} seconds.
      </Meta>
    </main>
  );
}
