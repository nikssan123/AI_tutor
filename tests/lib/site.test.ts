import { describe, expect, it } from "vitest";
import { canonical, siteUrl } from "@/lib/site";

describe("siteUrl", () => {
  it("prefers the explicitly configured origin", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.com" })).toBe(
      "https://example.com",
    );
  });

  it("strips a trailing slash so canonicals never double up", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.com/" })).toBe(
      "https://example.com",
    );
  });

  it("falls back to the Vercel deployment URL, making previews self-canonical", () => {
    expect(siteUrl({ VERCEL_URL: "preview-abc.vercel.app" })).toBe(
      "https://preview-abc.vercel.app",
    );
  });

  it("prefers the explicit origin over the Vercel one", () => {
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: "https://online.uni",
        VERCEL_URL: "preview.vercel.app",
      }),
    ).toBe("https://online.uni");
  });

  it("falls back to localhost in development", () => {
    expect(siteUrl({})).toBe("http://localhost:3000");
  });

  it("reads the ambient environment by default", () => {
    expect(siteUrl()).toMatch(/^https?:\/\//);
  });
});

describe("canonical", () => {
  const env = { NEXT_PUBLIC_SITE_URL: "https://example.com" };

  it("builds an absolute URL", () => {
    expect(canonical("/check/sql", env)).toBe("https://example.com/check/sql");
  });

  it("tolerates a path without a leading slash", () => {
    expect(canonical("check/sql", env)).toBe("https://example.com/check/sql");
  });

  it("removes a trailing slash — §13.2 says never one", () => {
    expect(canonical("/check/sql/", env)).toBe("https://example.com/check/sql");
  });

  it("keeps the root as a bare origin", () => {
    expect(canonical("/", env)).toBe("https://example.com");
  });

  it("reads the ambient environment by default", () => {
    expect(canonical("/x")).toContain("/x");
  });
});
