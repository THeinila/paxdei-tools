/** The limiter on its own: 429s, window resets, client identity and memory. */
import { Hono, type Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientKey, rateLimit } from "./rateLimit.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function limited(limit: number, windowMs = 60_000) {
  const app = new Hono();
  app.use("*", rateLimit({ name: "t", limit, windowMs }));
  app.get("*", (c) => c.text("ok"));
  return app;
}
const get = (app: Hono, ip = "10.0.0.1") => app.request("/", { headers: { "x-forwarded-for": ip } });

describe("rateLimit", () => {
  it("ABU-1: a client over its budget gets 429 with a whole-second retry-after of at least 1", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    const app = limited(2);
    await get(app);
    await get(app);
    vi.setSystemTime(30_500);
    const over = await get(app);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "rate limit exceeded" });
    expect(over.headers.get("retry-after")).toBe("30"); // ceil(29.5 s)

    vi.setSystemTime(59_990);
    expect((await get(app)).headers.get("retry-after")).toBe("1"); // never 0
  });

  it("ABU-2: the budget comes back when the window resets", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    const app = limited(1);
    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(429);
    vi.setSystemTime(59_999);
    expect((await get(app)).status).toBe(429);
    vi.setSystemTime(60_000);
    expect((await get(app)).status).toBe(200);
  });

  it("ABU-3: falls back to the socket address, then to one shared bucket", () => {
    const ctx = (xff: string | undefined, remoteAddress?: string) =>
      ({
        req: { header: () => xff },
        env: remoteAddress ? { incoming: { socket: { remoteAddress } } } : {},
      }) as unknown as Context;
    expect(clientKey(ctx("203.0.113.5, 10.0.0.1", "127.0.0.1"))).toBe("203.0.113.5");
    expect(clientKey(ctx(undefined, "198.51.100.7"))).toBe("198.51.100.7");
    expect(clientKey(ctx(" , 10.0.0.1", "198.51.100.7"))).toBe("198.51.100.7"); // empty first entry
    expect(clientKey(ctx(undefined))).toBe("_shared");
  });

  it("ABU-N3: expired buckets are dropped once more than 10,000 exist", async () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    const app = limited(5, 1000);
    for (let i = 0; i < 10_001; i++) await get(app, `10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`);
    vi.setSystemTime(2000); // every window has ended
    const deleted = vi.spyOn(Map.prototype, "delete");
    await get(app, "192.0.2.1");
    expect(deleted.mock.calls.length).toBeGreaterThanOrEqual(10_001);
  });
});
