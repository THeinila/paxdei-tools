/** The HTTP app: middleware, the /api routes, /healthz and, when a build is
 * present, the static SPA. Split out of server/index.ts so tests can drive it
 * through app.request() without opening a port, a real database file or a
 * retention timer; index.ts wires it to those. */
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import type { DB } from "./db.ts";
import type { DiskGuard } from "./diskGuard.ts";
import { createListsRouter } from "./lists.ts";
import { createStatsRouter, visitorTracking } from "./metrics.ts";
import { isRead, rateLimit } from "./rateLimit.ts";
import { securityHeaders } from "./securityHeaders.ts";

export interface AppDeps {
  db: DB;
  diskGuard: DiskGuard;
  /** STATS_TOKEN; unset closes /api/stats. */
  statsToken?: string;
  /** The built SPA. Cwd-relative by default to match the npm scripts and the
   * systemd unit (WorkingDirectory=), which all run from the repo root. */
  distDir?: string;
}

// Cache policy for the static SPA. Vite content-hashes everything under /assets,
// so those filenames change every build and can be cached forever; index.html
// (and any other unhashed file) must be revalidated so a redeploy is picked up
// without a hard refresh — otherwise a stale cached index.html keeps loading an
// old, deleted bundle and deep links mis-route to the landing page.
//
// Icons need their own rule. Their filenames are derived from the game's icon
// path (scripts/fetch-icons.ts and the app both go through localIconName), so a
// given URL keeps serving the same picture and is safe to cache hard. Without
// this they fall into the "no-cache" bucket, and because @hono/node-server's
// serveStatic sends Last-Modified but never answers a conditional request with
// a 304, every reload re-downloads every icon on screen in full. A plan with 50
// icons is ~500 KB and ~75 ms of CPU per page view — on 1/8 of an OCPU that is
// the single largest avoidable cost the host carries. Long max-age rather than
// `immutable` so that if an icon's artwork is ever replaced under the same path,
// the fleet self-heals within a month instead of never.
const ICON_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const cacheHeaders = (path: string, c: Context) => {
  let policy = "no-cache";
  if (path.includes(`${sep}assets${sep}`)) {
    policy = "public, max-age=31536000, immutable";
  } else if (path.includes(`${sep}icons${sep}`)) {
    policy = `public, max-age=${ICON_MAX_AGE}`;
  }
  c.header("Cache-Control", policy);
};

export function createApp({ db, diskGuard, statsToken, distDir = "./dist" }: AppDeps): Hono {
  const app = new Hono();

  // Security headers on every response (see server/securityHeaders.ts). Set here
  // rather than in Caddy because the policy is a property of the app.
  app.use("*", securityHeaders());

  // Anonymous usage metrics (unique visitors + event counters, server-side only;
  // see server/metrics.ts). First so even rate-limited requests count as a visit.
  app.use("*", visitorTracking(db));

  // Hardening for the exposed (tunneled) API. State payloads are small, so cap the
  // body well under anything legitimate, and rate-limit per client. Every list is
  // now created server-side (a new list, a duplicate, a legacy-list migration), so
  // the create cap is generous — abuse is still bounded by the per-minute cap and
  // the tiny per-list payload.
  app.use("/api/*", bodyLimit({ maxSize: 64 * 1024 }));
  // Reads and writes get separate budgets. A single flat 60/min cap used to sit
  // BELOW what the app itself generates once a couple of tabs shared an address:
  // the poll is one request per client per interval, so a handful of tabs behind
  // one NAT exhausted the whole allowance and the app started 429ing people for
  // using it normally. Reads are cheap and non-mutating, so they get room for
  // dozens of concurrent tabs per address; writes stay tight.
  app.use("/api/*", rateLimit({ name: "read", limit: 240, windowMs: 60_000, when: isRead }));
  app.use(
    "/api/*",
    rateLimit({ name: "write", limit: 120, windowMs: 60_000, when: (c) => !isRead(c) }),
  );
  // List creation is the one unauthenticated endpoint that grows the database, so
  // it keeps its own, much slower budget on top of the write cap above, plus a
  // hard stop when the volume is nearly full (see server/diskGuard.ts — a full
  // disk risks SQLite corruption and takes the OS down with it, so we would much
  // rather refuse new lists than reach it).
  app.post("/api/lists", rateLimit({ name: "create", limit: 600, windowMs: 60 * 60_000 }));
  app.post("/api/lists", diskGuard.middleware());

  // The crafting planner's API. As the suite grows, each tool mounts its own
  // router under its own namespace (e.g. app.route("/api/<tool>", ...)) so routes
  // never collide; these planner routes predate that convention and keep /api/lists.
  app.route("/api", createListsRouter(db));

  // Aggregate stats, only served when STATS_TOKEN is configured:
  //   curl -H "Authorization: Bearer $STATS_TOKEN" https://<host>/api/stats
  app.route("/api", createStatsRouter(db, { token: statsToken }));

  // Anything else under /api is an API 404, whatever the method, so a mistyped
  // or retired endpoint never falls through to the SPA's index.html (SRV-5).
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  // Liveness probe for an external uptime checker. Deliberately unauthenticated
  // and free of detail — it touches the database (so a wedged SQLite file shows up
  // as a failure rather than a cheerful 200) but leaks no counts or versions.
  app.get("/healthz", (c) => {
    try {
      db.prepare("SELECT 1").get();
    } catch {
      return c.text("db unavailable", 503);
    }
    // Surface low disk as unhealthy so an uptime check catches it before the
    // volume actually fills. Still a 200 for "ok" so the probe stays trivial.
    if (diskGuard.status().low) return c.text("disk low", 503);
    return c.text("ok");
  });

  // Serve the production build when present (no-op in dev, where Vite serves it).
  if (existsSync(distDir)) {
    app.use("/*", serveStatic({ root: distDir, onFound: cacheHeaders }));
    // SPA fallback so deep links (e.g. /planner/<token>) resolve to index.html.
    app.get("*", serveStatic({ path: join(distDir, "index.html"), onFound: cacheHeaders }));
  }

  return app;
}

/** Where to listen. Loopback by default so only the local proxy (Caddy, or a
 * tunnel agent) reaches the API, never the LAN; HOST=0.0.0.0 exposes it. */
export function listenAddress(env: NodeJS.ProcessEnv = process.env): { port: number; hostname: string } {
  return { port: Number(env.PORT ?? 8787), hostname: env.HOST ?? "127.0.0.1" };
}
