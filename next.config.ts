import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Emit `.next/standalone` — server.js plus only the node_modules reachable
  // from it. The VPS this deploys to has 7.6GB shared with another project, so
  // the difference between shipping that and shipping a full install is the
  // difference between a deploy that fits and one that competes for page cache.
  output: "standalone",
  // §13.3 — explicit width/height plus modern formats; CLS budget is 0.05.
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // §13.2 — no trailing slash, slugs immutable once indexed.
  trailingSlash: false,
  experimental: {
    /*
     * How long the router may reuse a page segment it already has.
     *
     * Everything under `(app)` is dynamic, and the default for a dynamic
     * segment is 0 — "not cached" — so flipping Today → Calendar → Today paid
     * for a full server render of Today the second time, having had the answer
     * in memory a few seconds earlier. Thirty seconds is Next's own pre-15
     * default, and what it can actually serve stale is narrower than it looks:
     *
     *   - what the learner does to their own plan goes through Server Actions
     *     that name the screens they move (`revalidatePath("/today")` when a
     *     session ends), and a revalidated path is dropped from this cache;
     *   - signing in and out set and clear the session cookie, and
     *     `cookies.set` / `cookies.delete` purge the Client Cache outright
     *     (`next/dist/docs/01-app/04-glossary.md`), so no screen survives a
     *     change of account;
     *   - the two screens that wait on background work — marking, and a pack
     *     being built — refresh with a `<meta http-equiv="refresh">`, which is
     *     a document load and empties the cache with it.
     *
     * What is left inside the window is a background change nobody on this
     * device asked for arriving up to half a minute late on a screen they are
     * revisiting — against a server render on every single navigation.
     *
     * `static` is left at its 5-minute default: it governs the prefetched
     * loading shells, which are the same for everyone and never go stale.
     */
    staleTimes: { dynamic: 30 },
    /*
     * §7.3's photograph, uploaded to the Skill Check.
     *
     * Server Actions default to a 1MB body, which every photo off a phone
     * exceeds — the upload would fail before any of our own validation ran, and
     * the learner would see a platform error rather than a sentence. This is
     * `MAX_IMAGE_BYTES` plus room for the multipart wrapper; anything larger is
     * refused by `markPhotoAnswer` with something worth reading.
     */
    serverActions: { bodySizeLimit: "5mb" },
  },
  // §13.2 — `/skills/{skill}` is a permanent redirect to the check page.
  async redirects() {
    return [
      {
        source: "/skills/:skill",
        destination: "/check/:skill",
        permanent: true,
      },
    ];
  },
};

export default config;
