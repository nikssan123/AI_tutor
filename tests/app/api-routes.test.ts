import { beforeAll, describe, expect, it } from "vitest";

/**
 * Adapter-level checks. They cannot prove Inngest or Better Auth work — that is
 * the libraries' job — but they do prove the wiring exists and exports the verbs
 * Next.js will look for, which is the failure mode that otherwise only shows up
 * as a 404 in production.
 */

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:1/none";
  process.env.BETTER_AUTH_SECRET ??= "test-secret-value-at-least-32-chars-long";
});

describe("/api/inngest", () => {
  it("serves the three verbs Inngest's handshake needs", async () => {
    // PUT is the one people forget; without it, function registration fails
    // silently and jobs simply never run.
    const route = await import("@/app/api/inngest/route");
    expect(typeof route.GET).toBe("function");
    expect(typeof route.POST).toBe("function");
    expect(typeof route.PUT).toBe("function");
  });
});

describe("/api/auth/[...all]", () => {
  it("exports GET and POST handlers", async () => {
    const route = await import("@/app/api/auth/[...all]/route");
    expect(typeof route.GET).toBe("function");
    expect(typeof route.POST).toBe("function");
  });
});
