/** Metrics tests against an in-memory SQLite DB. Focus: privacy invariants
 * (no raw IP anywhere, stats gated by token) and correct counting (visitor
 * dedup, list_created events). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono, type Context } from "hono";
import { openDb, type DB } from "./db.ts";
import { createListsRouter } from "./lists.ts";
import { bumpMetric, createStatsRouter, visitorTracking } from "./metrics.ts";

let db: DB;
let app: Hono;

const STATS_TOKEN = "test-secret";

beforeEach(() => {
  db = openDb(":memory:");
  app = new Hono();
  app.use("*", visitorTracking(db));
  app.route("/api", createListsRouter(db));
  app.route("/api", createStatsRouter(db, { token: STATS_TOKEN }));
  app.get("/", (c) => c.text("spa"));
});

const asClient = (ip?: string): RequestInit =>
  ip ? { headers: { "x-forwarded-for": ip } } : {};

async function getStats() {
  const res = await app.request("/api/stats", {
    headers: { authorization: `Bearer ${STATS_TOKEN}` },
  });
  expect(res.status).toBe(200);
  return res.json() as Promise<{
    lists: { live: number };
    counters: Record<string, number>;
    visitors: { total: number; activeToday: number; newByDay: { day: string; count: number }[] };
  }>;
}

describe("unique visitors", () => {
  it("MET-1: counts distinct clients once each, however many requests they make", async () => {
    await app.request("/", asClient("1.2.3.4"));
    await app.request("/", asClient("1.2.3.4"));
    await app.request("/api/lists/nope", asClient("1.2.3.4"));
    await app.request("/", asClient("5.6.7.8"));

    const stats = await getStats();
    expect(stats.visitors.total).toBe(2);
    expect(stats.visitors.activeToday).toBe(2);
  });

  it("MET-2: stores a hash, never the raw client IP", async () => {
    await app.request("/", asClient("203.0.113.99"));
    const rows = db.prepare(`SELECT hash FROM visitors`).all() as { hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.hash).not.toContain("203.0.113.99");
  });

  it("MET-3: gives the same client the same hash across restarts (pepper persists)", async () => {
    await app.request("/", asClient("1.2.3.4"));
    // Simulate a restart: a fresh middleware instance on the same DB.
    const app2 = new Hono();
    app2.use("*", visitorTracking(db));
    app2.get("/", (c) => c.text("spa"));
    await app2.request("/", asClient("1.2.3.4"));

    const n = (db.prepare(`SELECT COUNT(*) AS n FROM visitors`).get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it("MET-8: does not count stats polls as visits", async () => {
    await getStats();
    const stats = await getStats();
    expect(stats.visitors.total).toBe(0);
  });
});

describe("event counters", () => {
  it("MET-4: counts list creations", async () => {
    const create = () =>
      app.request("/api/lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: { targets: [], pathChoices: {} } }),
      });
    await create();
    await create();

    const stats = await getStats();
    expect(stats.counters.list_created).toBe(2);
    expect(stats.lists.live).toBe(2);
  });

  it("MET-4: aggregates arbitrary named events by day", async () => {
    bumpMetric(db, "list_deleted");
    bumpMetric(db, "list_deleted");
    const stats = await getStats();
    expect(stats.counters.list_deleted).toBe(2);
  });
});

describe("stats endpoint access", () => {
  it("MET-5: 404s when no token is configured (fail closed)", async () => {
    const bare = new Hono();
    bare.route("/api", createStatsRouter(db));
    const res = await bare.request("/api/stats");
    expect(res.status).toBe(404);
  });

  it("MET-6: 401s a missing or wrong token", async () => {
    expect((await app.request("/api/stats")).status).toBe(401);
    const wrong = await app.request("/api/stats", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(wrong.status).toBe(401);
  });
});

describe("stats contents and cost", () => {
  it("MET-7: stats return aggregates only, with no hashes, tokens or list contents", async () => {
    const created = await app.request("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ state: { name: "Secret plan", targets: [] } }),
    });
    const { token } = (await created.json()) as { token: string };
    const res = await app.request("/api/stats", { headers: { authorization: `Bearer ${STATS_TOKEN}` } });
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["counters", "countersByDay", "generatedAt", "lists", "visitors"]);
    expect(body.lists).toEqual({ live: 1 });
    expect(body.counters).toEqual({ list_created: 1 });
    expect(body.visitors).toMatchObject({ total: 1, activeToday: 1 });

    const text = JSON.stringify(body);
    const hash = (db.prepare("SELECT hash FROM visitors").get() as { hash: string }).hash;
    for (const secret of [hash, token, "Secret plan", "203.0.113.9", STATS_TOKEN]) expect(text).not.toContain(secret);
  });

  it("MET-N1: a client costs at most one database write a day for visitor tracking", async () => {
    const changes = () => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    await app.request("/", asClient("198.51.100.1"));
    const after = changes();
    for (let i = 0; i < 20; i++) await app.request("/", asClient("198.51.100.1"));
    expect(changes()).toBe(after);
  });

  it("MET-N1: the in-memory seen-today record is trimmed above 50,000 clients", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T10:00:00Z"), toFake: ["Date"] });
    try {
      const mw = visitorTracking(db);
      const ctx = (ip: string) => ({ req: { path: "/", header: () => ip }, env: {} }) as unknown as Context;
      const next = async () => {};
      for (let i = 0; i <= 50_000; i++) await mw(ctx(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`), next);
      vi.setSystemTime(new Date("2026-11-04T10:00:00Z")); // a new day: yesterday's entries are stale
      const deleted = vi.spyOn(Map.prototype, "delete");
      await mw(ctx("192.0.2.200"), next);
      expect(deleted.mock.calls.length).toBeGreaterThanOrEqual(50_001);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
