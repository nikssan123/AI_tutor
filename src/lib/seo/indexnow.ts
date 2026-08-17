import type { EnvLike } from "@/lib/env-types";
import { siteUrl } from "@/lib/site";

/**
 * §13.3's last unbuilt crawl-budget row — "IndexNow ping to Bing on publish".
 *
 * **This is a Bing feature, and the row is right to name Bing.** Bing, Yandex,
 * Seznam and Naver share one IndexNow endpoint; Google has never joined it and
 * still discovers pages by crawling the sitemap. So this buys nothing on the
 * search engine that decides whether §9's strategy worked, and it is worth
 * building anyway for two reasons: §13.3 asks for Bing Webmaster Tools from day
 * one, and a new domain's first crawl is the slowest one it will ever get.
 *
 * **It no-ops when `INDEXNOW_KEY` is unset**, which is the rule the observability
 * variables already follow — nothing here may block local development, and a
 * deploy that forgot the key must fail loudly in the script rather than silently
 * submit to the wrong host.
 */

/** The most URLs one submission may carry, from the protocol's own limit. */
export const INDEXNOW_MAX_URLS = 10_000;

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/**
 * Where the key file is served from.
 *
 * The protocol wants it at the host root; it also accepts a `keyLocation`
 * anywhere on the host, which is what this uses. A top-level `[key]` route would
 * be a dynamic segment sitting beside `/learn` and `/guides`, and while Next
 * resolves static segments first, a catch-all at the root is a trap for whoever
 * adds the next marketing page. One nested segment costs nothing and cannot
 * shadow anything.
 */
export function keyPath(key: string): string {
  return `/indexnow/${key}.txt`;
}

/**
 * The key, or null when this deployment has none.
 *
 * A key must be 8–128 characters of hex, which the protocol requires and which
 * is also the cheapest guard against the failure that matters: a placeholder
 * left in an env file submits a host you do not own the key for, and the
 * endpoint answers 403 rather than telling you what is wrong.
 */
export function indexNowKey(env: EnvLike = process.env): string | null {
  const key = env.INDEXNOW_KEY;
  if (!key) return null;
  return /^[0-9a-fA-F]{8,128}$/.test(key) ? key : null;
}

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export type IndexNowRefusal =
  | "no-key"
  | "no-urls"
  | "too-many-urls"
  | "foreign-host";

export type IndexNowRequest =
  | { ok: true; payload: IndexNowPayload }
  | { ok: false; refused: IndexNowRefusal };

/**
 * Builds the submission, or says why it will not.
 *
 * Pure, and separate from the fetch, because every rule below is a rule about
 * *our* data rather than about the network — and the one that matters most is
 * the last: **every URL must be on the host the key belongs to.** A submission
 * mixing hosts is rejected whole, so a single preview-deployment URL that leaked
 * into the list takes the entire batch down with it, and the endpoint's 422 says
 * nothing about which one.
 */
export function buildSubmission(
  urls: string[],
  env: EnvLike = process.env,
): IndexNowRequest {
  const key = indexNowKey(env);
  if (!key) return { ok: false, refused: "no-key" };

  if (urls.length === 0) return { ok: false, refused: "no-urls" };
  if (urls.length > INDEXNOW_MAX_URLS) {
    return { ok: false, refused: "too-many-urls" };
  }

  const host = new URL(siteUrl(env)).host;
  if (urls.some((url) => new URL(url).host !== host)) {
    return { ok: false, refused: "foreign-host" };
  }

  return {
    ok: true,
    payload: {
      host,
      key,
      keyLocation: `${siteUrl(env)}${keyPath(key)}`,
      urlList: urls,
    },
  };
}

/** What a refusal means, for the operator running the script. Never a learner. */
export function refusalReason(refused: IndexNowRefusal): string {
  switch (refused) {
    case "no-key":
      return "INDEXNOW_KEY is unset or is not 8-128 hex characters. Generate one with `openssl rand -hex 16`, set it, and serve it at the key path.";
    case "no-urls":
      return "the sitemap produced no indexable URLs, which is a bigger problem than this submission";
    case "too-many-urls":
      return `more than ${INDEXNOW_MAX_URLS} URLs in one submission; split the batch`;
    case "foreign-host":
      return "a URL is on a different host to NEXT_PUBLIC_SITE_URL — the endpoint rejects a mixed batch whole, so this would have failed silently at 422";
  }
}

export interface IndexNowResult {
  submitted: number;
  status: number;
  /** True for 200 and 202: the endpoint accepts and processes asynchronously. */
  accepted: boolean;
}

/**
 * Submits, and reports what happened rather than throwing.
 *
 * `fetch` is injected so the rules above can be tested without a network, which
 * is the same seam every other outbound call in this codebase uses.
 */
export async function submit(
  payload: IndexNowPayload,
  fetcher: typeof fetch = fetch,
): Promise<IndexNowResult> {
  const response = await fetcher(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

  return {
    submitted: payload.urlList.length,
    status: response.status,
    // 200 is "received", 202 is "received, key validation pending" — which is
    // what a first submission from a new domain gets, and it is a success.
    accepted: response.status === 200 || response.status === 202,
  };
}
