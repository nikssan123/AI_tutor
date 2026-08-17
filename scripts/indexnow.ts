import sitemap from "@/app/sitemap";
import {
  buildSubmission,
  keyPath,
  refusalReason,
  submit,
} from "@/lib/seo/indexnow";
import { siteUrl } from "@/lib/site";

/**
 * §13.3 — "IndexNow ping to Bing on publish", run after a deploy.
 *
 *   pnpm indexnow          submit every indexable URL
 *   pnpm indexnow --dry    print what would be submitted
 *
 * **Publish is a deploy here.** The pages this site ranks come from files —
 * packs, guides, audience cuts — so there is no per-page publish event to hook,
 * and a page becomes real when the deploy carrying it goes out. That makes the
 * sitemap the right source: it is already the one place that knows what is
 * indexable, and a submission that disagreed with it would be asking a crawler
 * to fetch a URL that tells it to go away.
 *
 * Exits non-zero on anything that is not an acceptance, so a deploy pipeline
 * sees it. Nothing here writes to the database.
 */

async function main() {
  const dry = process.argv.includes("--dry");

  const urls = (await sitemap()).map((entry) => entry.url);
  const request = buildSubmission(urls);

  console.log(`origin: ${siteUrl()}`);
  console.log(`urls:   ${urls.length}\n`);

  if (!request.ok) {
    console.error(`  refused: ${refusalReason(request.refused)}\n`);
    process.exit(1);
  }

  const { payload } = request;
  console.log(`key file: ${payload.keyLocation}`);
  console.log(`           (serve this before submitting, or the key fails)\n`);

  if (dry) {
    for (const url of payload.urlList) console.log(`  ${url}`);
    console.log(`\n  --dry: nothing submitted.\n`);
    return;
  }

  const result = await submit(payload);
  console.log(
    result.accepted
      ? `  submitted ${result.submitted} URLs — ${result.status} accepted.\n`
      : `  ${result.status} from the endpoint. Nothing was accepted.\n`,
  );

  // 403 means the key file did not verify; 422 means a URL is not on the host.
  // Both are silent in a pipeline that ignores the exit code, and both mean the
  // pages were not submitted at all.
  process.exit(result.accepted ? 0 : 1);
}

void main();

/** Exported so the key path is one string. `pnpm indexnow --dry` prints it. */
export { keyPath };
