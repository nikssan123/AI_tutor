import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireUser } from "@/lib/account/session";
import { AppFrame, AppHeader } from "@/components/app-shell";
import { Card, Figure, Meta, Row, RowList, Title } from "@/components/ui";
import { canonical } from "@/lib/site";
import { codeFor, REWARD_DAYS, summaryFor } from "@/lib/referral/store";

/**
 * `/account/referrals` — PLAN-MONETIZATION §9.
 *
 * Two things this page deliberately does not do.
 *
 * **No share buttons to seven networks.** The brief (§10) lists WhatsApp,
 * Messenger, Telegram, X, LinkedIn and email. Each one is a third-party URL
 * scheme to keep working and a tracking surface to explain, and every one of
 * them is reachable by pasting a link. So the page gives one link, selectable,
 * and gets out of the way — which is also what the brief says technical users
 * actually want.
 *
 * **No list of who was invited.** The referrer already knows; showing the
 * addresses back turns a share page into a contact export and answers a
 * question nobody asked. What is shown is whether it worked.
 */
export const metadata: Metadata = {
  title: "Invite a friend",
  robots: { index: false, follow: false },
};

const STATUS_COPY: Record<string, string> = {
  pending: "Signed up",
  qualified: "Subscribed",
  rewarded: `Subscribed · your ${REWARD_DAYS} days are on`,
};

export default async function ReferralsPage() {
  const user = await requireUser();
  const db = getDb();

  const [code, summary] = await Promise.all([
    codeFor(db, user.id),
    summaryFor(db, user.id),
  ]);

  const link = canonical(`/r/${code}`);

  return (
    <AppFrame width="narrow">
      <AppHeader
        title="Learn together"
        lead={`Give a friend ${REWARD_DAYS} days of Pro. When they subscribe, you get ${REWARD_DAYS} days too.`}
      />

      <Card className="flex flex-col gap-4">
        <Title>Your link</Title>
        <Meta>
          Anyone who signs up through this gets {REWARD_DAYS} days of Pro
          straight away — no card. Your {REWARD_DAYS} days arrive when they
          become a paying member.
        </Meta>
        {/*
          A read-only input rather than a copy button: selectable with a
          keyboard, works with no JavaScript, and does not need clipboard
          permission on the phone where most of these get shared.
        */}
        <input
          readOnly
          value={link}
          aria-label="Your referral link"
          className="min-h-[var(--touch-min)] w-full rounded-[var(--radius-control)] border border-hairline bg-ground px-4 font-[550] text-ink"
        />
      </Card>

      <Card className="flex flex-col gap-5">
        <Title>How it is going</Title>
        <div className="flex flex-wrap gap-8">
          <Figure value={summary.invited} caption="signed up" />
          <Figure value={summary.paying} caption="subscribed" />
          <Figure
            value={summary.rewardedDays}
            unit="days"
            caption="of Pro earned"
          />
        </div>

        {summary.recent.length === 0 ? (
          <Meta>
            Nobody yet. The link works from the moment you send it.
          </Meta>
        ) : (
          <RowList>
            {summary.recent.map((entry) => (
              <Row key={`${entry.name}-${entry.signupAt.toISOString()}`}>
                <span className="text-[length:var(--text-body-size)]">
                  {entry.name}
                </span>
                <Meta>{STATUS_COPY[entry.status] ?? entry.status}</Meta>
              </Row>
            ))}
          </RowList>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <Title>The rules, in full</Title>
        <ul className="flex flex-col gap-2 list-none m-0 p-0 text-[length:var(--text-body-size)] leading-[var(--text-body-line)]">
          <li>Your friend gets {REWARD_DAYS} days of Pro when they sign up.</li>
          <li>
            You get {REWARD_DAYS} days when their first payment goes through —
            not when they sign up.
          </li>
          <li>
            If they get a refund, both sets of days come back. That is the only
            way it is taken away.
          </li>
          <li>
            Inviting yourself does not work, and we can tell. There is no limit
            on inviting other people.
          </li>
        </ul>
      </Card>
    </AppFrame>
  );
}
