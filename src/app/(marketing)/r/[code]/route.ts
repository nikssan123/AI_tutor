import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { capture } from "@/lib/observability";
import { isReferralCode, normalizeCode } from "@/lib/referral/code";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_OPTIONS } from "@/lib/referral/cookie";
import { referrerFor } from "@/lib/referral/store";

/**
 * `/r/{code}` — PLAN-MONETIZATION §9.1.
 *
 * A route handler rather than a page, and that is the design decision worth
 * stating. The brief (§11) wants a landing page saying "Nikolay invited you to
 * try his AI learning system", which sounds like a page — but a per-referrer
 * page is a page per user, and §22.2 is explicit that auto-published per-user
 * pages are "precisely the scaled-content-abuse pattern that lost sites 60–90%
 * of traffic". So the code is *consumed* here and the visitor lands on the
 * ordinary home page with the invitation carried in a cookie.
 *
 * `robots.ts` disallows `/r/` and the sitemap never lists it, for the same
 * reason: a referral link is one person's invitation, not a document.
 *
 * An unknown code redirects home rather than 404ing. Somebody who typed a code
 * off a photograph and got one character wrong should meet the product, not an
 * error page — they simply arrive unattributed.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code: raw } = await params;
  const code = normalizeCode(raw);

  if (!isReferralCode(code)) redirect("/");

  const referrer = await referrerFor(getDb(), code);
  if (!referrer) redirect("/");

  const jar = await cookies();
  jar.set(REFERRAL_COOKIE, code, REFERRAL_COOKIE_OPTIONS);

  capture("referral_visit", { code });

  // The invitation is carried in the cookie and spent at signup. The
  // destination is the ordinary home page because that is the page built to
  // explain the product to a stranger.
  redirect("/?invited=1");
}
