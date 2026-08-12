import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // §13.3 — explicit width/height plus modern formats; CLS budget is 0.05.
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // §13.2 — no trailing slash, slugs immutable once indexed.
  trailingSlash: false,
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
