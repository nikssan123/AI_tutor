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
