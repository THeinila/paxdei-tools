/** Entry point for the sharing backend. Serves the /api routes and, in
 * production, the built SPA from dist/ so the whole app is single-origin. In
 * dev the Vite server (port 5173) proxies /api here. */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { existsSync } from "node:fs";
import { sep } from "node:path";
import { openDb } from "./db.ts";
import { createListsRouter } from "./lists.ts";
import { createStatsRouter, visitorTracking } from "./metrics.ts";
import { rateLimit } from "./rateLimit.ts";

const db = openDb();
const app = new Hono();

// Cache policy for the static SPA. Vite content-hashes everything under /assets,
// so those filenames change every build and can be cached forever; index.html
// (and any other unhashed file) must be revalidated so a redeploy is picked up
// without a hard refresh — otherwise a stale cached index.html keeps loading an
// old, deleted bundle and deep links mis-route to the landing page.
const cacheHeaders = (path: string, c: Context) => {
  c.header(
    "Cache-Control",
    path.includes(`${sep}assets${sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  );
};

// Anonymous usage metrics (unique visitors + event counters, server-side only;
// see server/metrics.ts). First so even rate-limited requests count as a visit.
app.use("*", visitorTracking(db));

// Hardening for the exposed (tunneled) API. State payloads are small, so cap the
// body well under anything legitimate, and rate-limit per client. Every list is
// now created server-side (a new list, a duplicate, a legacy-list migration), so
// the create cap is generous — abuse is still bounded by the per-minute cap and
// the tiny per-list payload.
app.use("/api/*", bodyLimit({ maxSize: 64 * 1024 }));
app.use("/api/*", rateLimit({ name: "api", limit: 60, windowMs: 60_000 }));
app.post("/api/lists", rateLimit({ name: "create", limit: 600, windowMs: 60 * 60_000 }));

// The crafting planner's API. As the suite grows, each tool mounts its own
// router under its own namespace (e.g. app.route("/api/<tool>", ...)) so routes
// never collide; these planner routes predate that convention and keep /api/lists.
app.route("/api", createListsRouter(db));

// Aggregate stats, only served when STATS_TOKEN is configured:
//   curl -H "Authorization: Bearer $STATS_TOKEN" https://<host>/api/stats
app.route("/api", createStatsRouter(db, { token: process.env.STATS_TOKEN }));

// Serve the production build when present (no-op in dev, where Vite serves it).
// Paths are cwd-relative to match serveStatic; npm scripts and the systemd unit
// (WorkingDirectory=) both run from the repo root.
if (existsSync("./dist")) {
  app.use("/*", serveStatic({ root: "./dist", onFound: cacheHeaders }));
  // SPA fallback so deep links (e.g. /planner/<token>) resolve to index.html.
  app.get("*", serveStatic({ path: "./dist/index.html", onFound: cacheHeaders }));
}

const port = Number(process.env.PORT ?? 8787);
// Bind to loopback by default so only the local tunnel agent reaches the API,
// never the LAN. Set HOST=0.0.0.0 to deliberately expose it on the network.
const host = process.env.HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`pax-planner API listening on http://${host}:${info.port}`);
});
