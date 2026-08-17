import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSubmission,
  indexNowKey,
  INDEXNOW_ENDPOINT,
  INDEXNOW_MAX_URLS,
  keyPath,
  refusalReason,
  submit,
} from "@/lib/seo/indexnow";

/**
 * §13.3 — "IndexNow ping to Bing on publish".
 *
 * The rules worth defending here are all about not submitting the wrong thing:
 * the endpoint answers a mixed-host batch with a 422 that names nothing, and a
 * missing key with a 403 that names nothing either. Both are silent in a deploy
 * pipeline, so the refusals below happen before the request rather than after.
 */

const ENV = {
  NEXT_PUBLIC_SITE_URL: "https://meritkeep.com",
  INDEXNOW_KEY: "0123456789abcdef0123456789abcdef",
};

const URLS = [
  "https://meritkeep.com/check/sql-data-analysis",
  "https://meritkeep.com/guides/why-do-i-forget-what-i-learn",
];

/** Narrows the built request, so the tests below are about `submit` alone. */
function payloadFor(urls: string[]) {
  const request = buildSubmission(urls, ENV);
  if (!request.ok) throw new Error(`unexpectedly refused: ${request.refused}`);
  return request.payload;
}

afterEach(() => vi.restoreAllMocks());

describe("indexNowKey", () => {
  it("reads a hex key", () => {
    expect(indexNowKey(ENV)).toBe(ENV.INDEXNOW_KEY);
  });

  it("is absent when unset, which is a no-op everywhere else", () => {
    expect(indexNowKey({})).toBeNull();
    expect(indexNowKey({ INDEXNOW_KEY: "" })).toBeNull();
  });

  it("refuses a key that is not hex, which is how a placeholder gets caught", () => {
    // A placeholder left in an env file submits a host you cannot prove you own,
    // and the endpoint's answer to that is a 403 that explains nothing.
    expect(indexNowKey({ INDEXNOW_KEY: "your-key-here" })).toBeNull();
    expect(indexNowKey({ INDEXNOW_KEY: "abc" })).toBeNull();
    expect(indexNowKey({ INDEXNOW_KEY: "a".repeat(129) })).toBeNull();
  });
});

describe("keyPath", () => {
  it("serves the key under a nested segment, not at the root", () => {
    // A top-level `[key]` route is a dynamic segment sitting beside /learn and
    // /guides. The protocol takes a `keyLocation`, so nothing is lost.
    expect(keyPath("abc123")).toBe("/indexnow/abc123.txt");
  });
});

describe("buildSubmission", () => {
  it("builds a payload the endpoint will accept", () => {
    const result = buildSubmission(URLS, ENV);

    expect(result).toEqual({
      ok: true,
      payload: {
        host: "meritkeep.com",
        key: ENV.INDEXNOW_KEY,
        keyLocation: `https://meritkeep.com/indexnow/${ENV.INDEXNOW_KEY}.txt`,
        urlList: URLS,
      },
    });
  });

  it("refuses without a key rather than submitting an unprovable host", () => {
    expect(buildSubmission(URLS, { NEXT_PUBLIC_SITE_URL: ENV.NEXT_PUBLIC_SITE_URL }))
      .toEqual({ ok: false, refused: "no-key" });
  });

  it("refuses an empty list", () => {
    expect(buildSubmission([], ENV)).toEqual({ ok: false, refused: "no-urls" });
  });

  it("refuses more than the protocol's own limit", () => {
    const many = Array.from(
      { length: INDEXNOW_MAX_URLS + 1 },
      (_, i) => `https://meritkeep.com/p/${i}`,
    );
    expect(buildSubmission(many, ENV)).toEqual({
      ok: false,
      refused: "too-many-urls",
    });
  });

  it("refuses a batch with a foreign host in it", () => {
    /*
     * The failure this check exists for. One preview-deployment URL that leaked
     * into the sitemap takes the whole batch down — the endpoint rejects a mixed
     * submission entirely — and its 422 does not say which URL did it.
     */
    const result = buildSubmission(
      [...URLS, "https://meritkeep-preview.vercel.app/learn"],
      ENV,
    );
    expect(result).toEqual({ ok: false, refused: "foreign-host" });
  });

  it("explains every refusal to whoever is running the deploy", () => {
    for (const refused of [
      "no-key",
      "no-urls",
      "too-many-urls",
      "foreign-host",
    ] as const) {
      expect(refusalReason(refused).length).toBeGreaterThan(20);
    }
    expect(refusalReason("no-key")).toContain("openssl rand -hex 16");
  });
});

describe("submit", () => {
  const ok = (status: number) =>
    vi.fn(async () => new Response(null, { status }));

  it("posts the payload as JSON to the shared endpoint", async () => {
    const fetcher = ok(200);
    const payload = payloadFor(URLS);

    const result = await submit(payload, fetcher as unknown as typeof fetch);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(INDEXNOW_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).urlList).toEqual(URLS);

    expect(result).toEqual({ submitted: 2, status: 200, accepted: true });
  });

  it("treats 202 as accepted, which is what a new domain gets", async () => {
    // "Received, key validation pending" — the first submission from a domain
    // with no history, and reading it as a failure would fail every launch.
    const payload = payloadFor(URLS);
    const result = await submit(payload, ok(202) as unknown as typeof fetch);
    expect(result.accepted).toBe(true);
  });

  it("reports a rejection rather than throwing", async () => {
    // 403 is an unverified key file, 422 a URL off-host. Both mean nothing was
    // submitted, and both are invisible to a pipeline that ignores exit codes.
    const payload = payloadFor(URLS);
    const result = await submit(payload, ok(403) as unknown as typeof fetch);
    expect(result).toEqual({ submitted: 2, status: 403, accepted: false });
  });
});
