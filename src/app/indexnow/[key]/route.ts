import { indexNowKey } from "@/lib/seo/indexnow";

/**
 * The IndexNow key file — the whole of the protocol's ownership proof.
 *
 * A submission names a `keyLocation`; the endpoint fetches it and checks the
 * body equals the key it was given. That is the only thing standing between
 * anyone and submitting URLs on your behalf, so the two rules here are that the
 * route serves the key **and nothing else**, and that it 404s rather than
 * reflecting whatever segment was asked for. A route that echoed its own path
 * parameter would validate every key anybody invented.
 *
 * 404 when the deployment has no key, which is the same shape as being asked for
 * the wrong one: an environment that cannot prove ownership does not have a key
 * file, and saying so is more honest than a 200 with an empty body.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const key = indexNowKey();
  const { key: requested } = await params;

  if (!key || requested !== `${key}.txt`) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(key, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // The key changes only when somebody rotates it, and the endpoint fetches
      // this on every submission.
      "cache-control": "public, max-age=86400",
    },
  });
}
