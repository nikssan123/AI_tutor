import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/indexnow/[key]/route";

/**
 * The IndexNow key file, which is the whole of the protocol's ownership proof.
 *
 * A submission names a `keyLocation`; the endpoint fetches it and checks the
 * body equals the key. So the only property that matters here is that the route
 * serves *our* key and never reflects the segment it was asked for — a route
 * that echoed its own parameter would validate every key anybody invented, and
 * would hand anyone the ability to submit URLs on this domain's behalf.
 */

const KEY = "0123456789abcdef0123456789abcdef";
const params = (key: string) => Promise.resolve({ key });
const request = new Request("https://meritkeep.com/indexnow/anything.txt");

beforeEach(() => {
  process.env.INDEXNOW_KEY = KEY;
});

afterEach(() => {
  delete process.env.INDEXNOW_KEY;
});

describe("the key file", () => {
  it("serves the key, and nothing but the key", async () => {
    const response = await GET(request, { params: params(`${KEY}.txt`) });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(KEY);
    expect(response.headers.get("content-type")).toContain("text/plain");
  });

  it("refuses to reflect a key it was merely asked for", async () => {
    // The attack the whole route is shaped around.
    const response = await GET(request, {
      params: params("deadbeefdeadbeefdeadbeefdeadbeef.txt"),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("deadbeef");
  });

  it("wants the .txt, because that is the path a submission names", async () => {
    const response = await GET(request, { params: params(KEY) });
    expect(response.status).toBe(404);
  });

  it("has no key file at all when the deployment has no key", async () => {
    // More honest than a 200 with an empty body: an environment that cannot
    // prove ownership does not have one of these.
    delete process.env.INDEXNOW_KEY;
    const response = await GET(request, { params: params(`${KEY}.txt`) });
    expect(response.status).toBe(404);
  });

  it("has no key file when the key is a placeholder", async () => {
    process.env.INDEXNOW_KEY = "your-key-here";
    const response = await GET(request, { params: params("your-key-here.txt") });
    expect(response.status).toBe(404);
  });
});
