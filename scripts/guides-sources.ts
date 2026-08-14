import { loadAllGuides, GUIDES_DIR } from "../src/lib/guides/loader";

/**
 * §24 E12's last acceptance criterion: "every external link returns 200".
 *
 * Deliberately *not* part of `pnpm verify`. Verify has to give the same answer
 * offline as it does in CI, and a gate that fails on a train is a gate people
 * learn to skip. This is the online half, run before publishing and on a
 * schedule after — link rot is the thing that quietly turns a cited page into
 * an uncited one.
 *
 * Two judgements worth knowing about:
 *
 *   - **Any 2xx passes, not only 200.** PubMed answers 203 to a non-browser
 *     client. The page is there; the status is a statement about the proxy.
 *   - **A 403 is reported as what it is** — a publisher refusing a script, not
 *     necessarily a dead link. It still fails, because a source a reader might
 *     not be able to open is a source worth reconsidering, but the output says
 *     which kind of failure it is so nobody deletes a good citation over a bot
 *     wall.
 *
 * Usage: pnpm guides:sources [dir]
 */
const root = process.argv[2] ?? GUIDES_DIR;
const guides = loadAllGuides(root);

interface Check {
  guide: string;
  id: string;
  url: string;
  status: number | string;
  ok: boolean;
}

const checks: Check[] = [];

async function head(url: string): Promise<number | string> {
  // Some hosts refuse HEAD and answer GET; asking for GET and abandoning the
  // body is more reliable than a HEAD that 405s on half the web.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "MeritKeep link checker (+https://meritkeep.com)" },
    });
    await response.body?.cancel();
    return response.status;
  } catch (error) {
    return error instanceof Error ? error.name : "failed";
  } finally {
    clearTimeout(timer);
  }
}

for (const guide of guides) {
  for (const source of guide.sources) {
    const status = await head(source.url);
    const ok = typeof status === "number" && status >= 200 && status < 300;
    checks.push({ guide: guide.slug, id: source.id, url: source.url, status, ok });
  }
}

if (checks.length === 0) {
  console.log(`No sources to check under "${root}".`);
  process.exit(0);
}

for (const check of checks) {
  const note =
    check.status === 403
      ? " (publisher refuses scripted requests — check it in a browser)"
      : "";
  console.log(
    `${check.ok ? "✓" : "✗"} ${String(check.status).padEnd(7)} ${check.guide} [^${check.id}] ${check.url}${note}`,
  );
}

const broken = checks.filter((c) => !c.ok).length;
console.log(
  `\n${checks.length - broken}/${checks.length} sources reachable across ${guides.length} guides.`,
);
process.exit(broken > 0 ? 1 : 0);
