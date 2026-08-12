import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { Card, DisplayTitle, EmptyState, Lead, Meta } from "@/components/ui";

/**
 * §8 screen 6 — the daily dashboard, and the retention surface. It must answer
 * "what do I do now" in under two seconds, with one primary card and nothing
 * else: no feed, no browse.
 *
 * Empty for now by design. The session it will show is produced by the planner
 * (already built, §16.1) once E3/E4 give a learner a goal and a diagnostic.
 */
export const metadata: Metadata = {
  title: "Today",
  robots: { index: false, follow: false },
};

export default async function TodayPage() {
  const session = await getAuth().api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/sign-in");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <DisplayTitle>Today</DisplayTitle>
      <Card>
        <EmptyState message="You don't have a goal yet. Once you do, this is where the one thing worth doing today will be." />
      </Card>
      <Meta>Signed in as {session.user.email}</Meta>
      <Lead>
        The planner that fills this card is built and tested; it needs a goal and
        a diagnostic to plan against.
      </Lead>
    </main>
  );
}
