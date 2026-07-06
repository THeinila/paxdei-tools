/** Privacy-preserving usage metrics, entirely server-side — no cookies, no
 * client-side tracking code, no third-party service.
 *
 *  - Event counters (metrics table): daily aggregate counts of named events
 *    such as list_created. Nothing per-user is recorded.
 *  - Unique visitors (visitors table): each client is reduced to
 *    HMAC-SHA256(pepper, client IP). The raw IP is never stored, and the pepper
 *    is a server-side random secret, so the hashes are meaningless outside this
 *    database. IPs are an approximation of "users" (shared households and
 *    dynamic IPs blur it), but they're the only signal that needs no cookie.
 *
 * Aggregates are exposed on GET /api/stats, which is disabled unless the
 * STATS_TOKEN env var is set and presented as a bearer token. */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DB } from "./db.ts";
import { clientKey } from "./rateLimit.ts";

/** UTC calendar day, the granularity for all metrics. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Count one occurrence of a named event for today. */
export function bumpMetric(db: DB, metric: string): void {
  db.prepare(
    `INSERT INTO metrics (day, metric, count) VALUES (?, ?, 1)
     ON CONFLICT(day, metric) DO UPDATE SET count = count + 1`,
  ).run(today(), metric);
}

/** The HMAC key for visitor hashes: random, generated once, kept in the DB so
 * hashes stay stable across restarts without any manual secret management. */
function visitorPepper(db: DB): Buffer {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'visitor_pepper'`).get() as
    | { value: string }
    | undefined;
  if (row) return Buffer.from(row.value, "hex");
  const pepper = randomBytes(32);
  db.prepare(`INSERT INTO meta (key, value) VALUES ('visitor_pepper', ?)`).run(
    pepper.toString("hex"),
  );
  return pepper;
}

/** Middleware that marks the requesting client as seen today. An in-memory
 * cache keeps it to at most one DB write per client per day, so static asset
 * bursts don't hammer SQLite. Without an XFF header every client collapses
 * into one shared bucket (same trade-off as the rate limiter), so dev traffic
 * counts as a single visitor. */
export function visitorTracking(db: DB): MiddlewareHandler {
  const pepper = visitorPepper(db);
  const seen = new Map<string, string>(); // visitor hash -> day already recorded
  const upsert = db.prepare(
    `INSERT INTO visitors (hash, first_seen, last_seen) VALUES (?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET last_seen = excluded.last_seen`,
  );

  return async (c, next) => {
    // Don't let the monitoring observe itself (stats polls aren't visits).
    if (c.req.path !== "/api/stats") {
      const hash = createHmac("sha256", pepper).update(clientKey(c)).digest("hex");
      const day = today();
      if (seen.get(hash) !== day) {
        upsert.run(hash, day, day);
        seen.set(hash, day);
        // Drop stale entries so the cache can't grow without bound.
        if (seen.size > 50_000) {
          for (const [k, v] of seen) if (v !== day) seen.delete(k);
        }
      }
    }
    await next();
  };
}

/** Constant-time token comparison (hash both sides to equalize lengths). */
function tokenMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** GET /stats — aggregate counters only, guarded by a bearer token. With no
 * token configured the route 404s, so the default deployment exposes nothing. */
export function createStatsRouter(db: DB, opts: { token?: string } = {}) {
  const app = new Hono();

  app.get("/stats", (c) => {
    if (!opts.token) return c.json({ error: "not found" }, 404);
    const auth = c.req.header("authorization") ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!tokenMatches(given, opts.token)) return c.json({ error: "unauthorized" }, 401);

    const counters = db
      .prepare(`SELECT metric, SUM(count) AS total FROM metrics GROUP BY metric ORDER BY metric`)
      .all() as { metric: string; total: number }[];
    const countersByDay = db
      .prepare(`SELECT day, metric, count FROM metrics ORDER BY day, metric`)
      .all() as { day: string; metric: string; count: number }[];
    const listsLive = (db.prepare(`SELECT COUNT(*) AS n FROM lists`).get() as { n: number }).n;
    const visitorsTotal = (db.prepare(`SELECT COUNT(*) AS n FROM visitors`).get() as { n: number })
      .n;
    const visitorsToday = (
      db.prepare(`SELECT COUNT(*) AS n FROM visitors WHERE last_seen = ?`).get(today()) as {
        n: number;
      }
    ).n;
    const newVisitorsByDay = db
      .prepare(`SELECT first_seen AS day, COUNT(*) AS count FROM visitors GROUP BY first_seen ORDER BY day`)
      .all() as { day: string; count: number }[];

    return c.json({
      generatedAt: new Date().toISOString(),
      lists: { live: listsLive },
      counters: Object.fromEntries(counters.map((r) => [r.metric, r.total])),
      countersByDay,
      visitors: { total: visitorsTotal, activeToday: visitorsToday, newByDay: newVisitorsByDay },
    });
  });

  return app;
}
