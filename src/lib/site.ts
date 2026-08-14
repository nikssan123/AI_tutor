import type { EnvLike } from "./env-types";
import { parseMailbox, supportFrom } from "./email/addresses";

/**
 * The canonical site origin.
 *
 * §13.3 requires `alternates.canonical` set explicitly on every page and never
 * left to a default, so the origin has to come from one place — a sitemap
 * pointing at localhost in production is the kind of mistake that is invisible
 * until traffic does not arrive.
 */
export function siteUrl(env: EnvLike = process.env): string {
  const configured = env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");

  // Vercel sets this per deployment, which makes preview URLs self-canonical.
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;

  return "http://localhost:3000";
}

/**
 * The address a stranger can write to, without the display name.
 *
 * Lives beside `siteUrl` because it is the same kind of fact — how to reach
 * this site — and because three surfaces now print it: the footer, the privacy
 * page and the terms page. It is derived from the variable outgoing mail
 * actually sends from, so the site cannot advertise one inbox while the product
 * writes from another.
 */
export function supportAddress(env?: EnvLike): string {
  return parseMailbox(supportFrom(env)).address;
}

export function canonical(path: string, env?: EnvLike): string {
  const normalised = path.startsWith("/") ? path : `/${path}`;
  // §13.2 — no trailing slash, ever. That includes the root: the homepage's
  // canonical is the bare origin, not origin + "/", so the rule has no
  // exception for a reviewer to wonder about.
  const trimmed = normalised.replace(/\/+$/, "");
  return `${siteUrl(env)}${trimmed}`;
}
