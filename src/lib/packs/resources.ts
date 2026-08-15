import type { DraftResource } from "@/lib/contracts/pack";
import type { CitedResource } from "@/lib/curriculum/validate";
import type { DomainPack } from "./types";

/**
 * The link checker, and the bridge from a pack's resources to §14.6's check.
 *
 * No model, on purpose. "Does this URL still resolve" is a request and a status
 * code; routing it through a model would cost money to get a worse answer, and
 * `CitedResource.reachable` has said "checked by the caller, not here" since the
 * validator was written. This is that caller.
 */

/** A request that has not answered in this long is treated as unreachable. */
export const LINK_CHECK_TIMEOUT_MS = 8_000;

/**
 * How many links are checked at once.
 *
 * Small deliberately. A pack has a couple of dozen resources and no deadline —
 * this runs during authoring or on a schedule, never on a request path — so
 * there is nothing to buy with concurrency except a chance of looking like a
 * scraper to a host we are trying to cite politely.
 */
export const LINK_CHECK_CONCURRENCY = 4;

/**
 * The statuses that mean the page is *gone*, as opposed to unavailable to us.
 *
 * This is the whole judgement in the checker, so it is a short list on purpose.
 * A 403 usually means a bot filter, a 429 means we asked too fast, and a 500
 * means the server is having a bad afternoon — none of them are evidence that
 * the resource has stopped existing, and marking a live page dead is the
 * expensive mistake: it drops a good citation and, once the freshness check is
 * blocking, fails a pack over someone else's rate limiter.
 *
 * 404 and 410 are the two the web actually uses to say "not here". Everything
 * else leaves the resource where it is.
 */
export const DEAD_STATUSES = new Set([404, 410]);

/** Just enough of `fetch` to check a link, so tests need no network. */
export type LinkFetcher = (
  url: string,
  init: { method: string; redirect: "follow"; signal: AbortSignal },
) => Promise<{ status: number }>;

export interface LinkCheckDeps {
  fetch?: LinkFetcher;
  now?: () => Date;
}

/**
 * Whether one URL still resolves.
 *
 * `HEAD` rather than `GET`: we want the status line, not the page, and pulling
 * a book-length reference to learn that it is still there is rude and slow. A
 * host that rejects HEAD outright answers with a status we do not treat as
 * dead, so the resource survives either way.
 *
 * A throw — DNS failure, connection refused, our own timeout — is unreachable.
 * That is the one case where "we could not tell" and "it is gone" get the same
 * answer, and it is the right way round: a name that no longer resolves is the
 * most common way a citation dies.
 */
export async function checkLink(
  url: string,
  deps: LinkCheckDeps = {},
): Promise<boolean> {
  const request = deps.fetch ?? (globalThis.fetch as unknown as LinkFetcher);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);

  try {
    const response = await request(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    return !DEAD_STATUSES.has(response.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** A researched resource with the checker's finding stamped on it. */
export interface CheckedResource extends DraftResource {
  reachable: boolean;
  /** ISO-8601. When the finding was made, which is what makes it readable. */
  checkedAt: string;
}

/**
 * Every drafted resource, with what the checker found attached.
 *
 * Returns the whole list rather than the survivors. Dropping dead links here
 * would leave assembly unable to say what it lost, and §14.6 wants drops shown;
 * `assemblePack` does the dropping, because that is the one moment a pack is
 * being written rather than inspected.
 *
 * Batched rather than fired all at once — see `LINK_CHECK_CONCURRENCY`.
 */
export async function checkDrafts(
  drafts: DraftResource[],
  deps: LinkCheckDeps = {},
): Promise<CheckedResource[]> {
  const checkedAt = (deps.now ?? (() => new Date()))().toISOString();
  const checked: CheckedResource[] = [];

  for (let i = 0; i < drafts.length; i += LINK_CHECK_CONCURRENCY) {
    const batch = await Promise.all(
      drafts.slice(i, i + LINK_CHECK_CONCURRENCY).map(async (draft) => ({
        ...draft,
        reachable: await checkLink(draft.url, deps),
        checkedAt,
      })),
    );
    checked.push(...batch);
  }

  return checked;
}

/**
 * A pack's resources in the shape §14.6's `resourceFreshness` reads.
 *
 * Three fields out of ten, which is the point: the validator is asked to judge
 * whether the *citations* have rotted, and handing it titles and assessments
 * would invite a check that judges the writing instead.
 */
export function citedResources(pack: DomainPack): CitedResource[] {
  return pack.resources.map((r) => ({
    url: r.url,
    publishedAt: r.publishedAt,
    reachable: r.reachable,
  }));
}
