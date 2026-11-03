/** The assembled app (server/app.ts) through app.request(): static caching, the
 * SPA fallback, /healthz, the body limit, the rate-limit budgets and the bind
 * address. A temporary folder stands in for dist/. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, listenAddress } from "./app.ts";
import { openDb, type DB } from "./db.ts";
import { createDiskGuard } from "./diskGuard.ts";

const dist = mkdtempSync(join(tmpdir(), "pax-dist-"));
mkdirSync(join(dist, "assets"));
mkdirSync(join(dist, "icons"));
writeFileSync(join(dist, "index.html"), "<!doctype html><p>app</p>");
writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log(1)");
writeFileSync(join(dist, "icons", "wood.webp"), "RIFF....WEBP");
writeFileSync(join(dist, "robots.txt"), "User-agent: *");
afterAll(() => rmSync(dist, { recursive: true, force: true }));

// serve() swaps in @hono/node-server's Request/Response globals, and the cache
// headers depend on that: serveStatic calls onFound (which sets Cache-Control)
// after the response is built, and only node-server's Response picks up headers
// set that late. Run on the same globals as production.
getRequestListener(() => new Response());

let db: DB;
const guard = (minFreeBytes = 0) => createDiskGuard({ path: dist, minFreeBytes, log: () => {} });
const appWith = (opts: { minFreeBytes?: number; withDist?: boolean } = {}) =>
  createApp({ db, diskGuard: guard(opts.minFreeBytes), distDir: opts.withDist === false ? join(dist, "missing") : dist });

beforeEach(() => {
  db = openDb(":memory:");
});

const from = (ip: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { "x-forwarded-for": ip, ...(init.headers as Record<string, string>) },
});

describe("static files and the SPA fallback", () => {
  it("SRV-1: hashed assets are cached forever", async () => {
    const res = await appWith().request("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("SRV-2: icons are cached for 30 days", async () => {
    const res = await appWith().request("/icons/wood.webp");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=2592000");
  });

  it("SRV-3: index.html and other files are revalidated", async () => {
    for (const path of ["/", "/robots.txt"]) {
      const res = await appWith().request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
  });

  it("SRV-4: a deep link serves index.html", async () => {
    const res = await appWith().request("/planner/tok_whatever_0000000");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toBe("<!doctype html><p>app</p>");
  });
});

describe("/healthz", () => {
  it("SRV-6: answers 200 ok when the database answers and the disk isn't low", async () => {
    const res = await appWith().request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("SRV-6: answers 503 when free space is below the floor", async () => {
    const g = guard(Number.MAX_SAFE_INTEGER);
    await g.refresh();
    const res = await createApp({ db, diskGuard: g, distDir: dist }).request("/healthz");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("disk low");
  });

  it("SRV-6: answers 503 when the database stops answering", async () => {
    const app = appWith();
    await app.request("/healthz", from("10.0.0.9")); // the probe has been seen today
    db.close();
    const res = await app.request("/healthz", from("10.0.0.9"));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("db unavailable");
  });
});

describe("API bodies", () => {
  it("SRV-9: rejects API bodies over 64 KB, and stores nothing", async () => {
    const app = appWith();
    const big = JSON.stringify({ state: { name: "x".repeat(70 * 1024) } });
    const res = await app.request("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(big.length) },
      body: big,
    });
    expect(res.status).toBe(413);
    expect((db.prepare("SELECT COUNT(*) AS n FROM lists").get() as { n: number }).n).toBe(0);
  });
});

describe("rate-limit budgets", () => {
  const hit = async (app: ReturnType<typeof appWith>, n: number, ip: string, init: RequestInit = {}, path = "/api/lists/nope") => {
    let last: Response | undefined;
    for (let i = 0; i < n; i++) last = await app.request(path, from(ip, init));
    return last!;
  };
  const post = { method: "POST", headers: { "content-type": "application/json" }, body: "{}" };

  it("ABU-N1: 240 reads a minute per client", async () => {
    const app = appWith();
    expect((await hit(app, 240, "10.0.0.1")).status).toBe(404); // within budget: the route answers
    expect((await hit(app, 1, "10.0.0.1")).status).toBe(429);
  });

  it("ABU-N1: 120 writes a minute per client", async () => {
    const app = appWith();
    const write = { ...post, method: "PATCH" };
    expect((await hit(app, 120, "10.0.0.2", write)).status).not.toBe(429);
    expect((await hit(app, 1, "10.0.0.2", write)).status).toBe(429);
  });

  it("ABU-5: list creation has its own 600-an-hour budget on top of the write budget", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T12:00:00Z"), toFake: ["Date"] });
    try {
      const app = appWith();
      // 120 a minute is the write budget, so spread 600 creations over five minutes.
      for (let minute = 0; minute < 5; minute++) {
        expect((await hit(app, 120, "10.0.0.3", post, "/api/lists")).status).toBe(201);
        vi.setSystemTime(Date.now() + 60_000);
      }
      // A fresh write window, but the hourly creation budget is spent...
      expect((await hit(app, 1, "10.0.0.3", post, "/api/lists")).status).toBe(429);
      // ...while other writes from the same client still go through.
      const edit = await hit(app, 1, "10.0.0.3", { ...post, method: "PATCH" }, "/api/lists/nope");
      expect(edit.status).toBe(400); // reached the route: no baseVersion
    } finally {
      vi.useRealTimers();
    }
  });

  it("ABU-4: a spent write budget doesn't block reads", async () => {
    const app = appWith();
    await hit(app, 121, "10.0.0.5", { ...post, method: "PATCH" });
    expect((await hit(app, 1, "10.0.0.5", { ...post, method: "PATCH" })).status).toBe(429);
    expect((await hit(app, 1, "10.0.0.5")).status).toBe(404);
  });

  it("ABU-6: one client's spent budget doesn't affect another", async () => {
    const app = appWith();
    await hit(app, 241, "10.0.0.6");
    expect((await hit(app, 1, "10.0.0.6")).status).toBe(429);
    expect((await hit(app, 1, "10.0.0.7")).status).toBe(404);
  });

  it("ABU-3: a client is the first X-Forwarded-For entry", async () => {
    const app = appWith();
    await hit(app, 241, "10.0.0.8, 172.16.0.1");
    expect((await hit(app, 1, "10.0.0.8")).status).toBe(429); // same client, proxy hop ignored
    expect((await hit(app, 1, "172.16.0.1")).status).toBe(404); // the proxy is not the client
  });
});

describe("bind address", () => {
  it("SRV-N1: listens on loopback port 8787 unless HOST and PORT say otherwise", () => {
    expect(listenAddress({})).toEqual({ hostname: "127.0.0.1", port: 8787 });
    expect(listenAddress({ HOST: "0.0.0.0", PORT: "9000" })).toEqual({ hostname: "0.0.0.0", port: 9000 });
  });
});
