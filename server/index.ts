/** Entry point for the sharing backend. Serves the /api routes and, in
 * production, the built SPA from dist/ so the whole app is single-origin. In
 * dev the Vite server (port 5173) proxies /api here. */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { existsSync } from "node:fs";
import { openDb } from "./db.ts";
import { createListsRouter } from "./lists.ts";
import { createMarketRouter, createMarketService } from "./market.ts";
import { createMarketCollector, seedFixtureHistory } from "./marketCollector.ts";
import { createStatsRouter, visitorTracking } from "./metrics.ts";
import { rateLimit } from "./rateLimit.ts";

const db = openDb();
const app = new Hono();

// Anonymous usage metrics (unique visitors + event counters, server-side only;
// see server/metrics.ts). First so even rate-limited requests count as a visit.
app.use("*", visitorTracking(db));

// Hardening for the exposed (tunneled) API. State payloads are small, so cap the
// body well under anything legitimate; rate-limit all writes, and throttle list
// creation harder since it's the one unauthenticated endpoint that grows the DB.
app.use("/api/*", bodyLimit({ maxSize: 64 * 1024 }));
app.use("/api/*", rateLimit({ name: "api", limit: 120, windowMs: 60_000 }));
app.post("/api/lists", rateLimit({ name: "create", limit: 10, windowMs: 60 * 60_000 }));

// The crafting planner's API. As the suite grows, each tool mounts its own
// router under its own namespace (e.g. app.route("/api/<tool>", ...)) so routes
// never collide; these planner routes predate that convention and keep /api/lists.
app.route("/api", createListsRouter(db));

// Cached market prices + self-accumulated history (read-only). Requires
// MARKET_UPSTREAM=fixtures|live; with the default (off) only
// /api/market/status responds and no collection happens.
const market = createMarketService(db);
app.route("/api/market", createMarketRouter(db, { service: market }));
if (market.mode !== "off") {
  // Keep all zones' history warm (hourly upstream cadence, batched ticks).
  createMarketCollector(market).start();
  if (market.mode === "fixtures") {
    // Dev/preview: fabricate history so the analysis UI has data to show.
    void seedFixtureHistory(db, market).catch((e) =>
      console.warn(`market: fixture history seeding failed: ${e}`),
    );
  }
}

// Aggregate stats, only served when STATS_TOKEN is configured:
//   curl -H "Authorization: Bearer $STATS_TOKEN" https://<host>/api/stats
app.route("/api", createStatsRouter(db, { token: process.env.STATS_TOKEN }));

// Serve the production build when present (no-op in dev, where Vite serves it).
// Paths are cwd-relative to match serveStatic; npm scripts and the systemd unit
// (WorkingDirectory=) both run from the repo root.
if (existsSync("./dist")) {
  app.use("/*", serveStatic({ root: "./dist" }));
  // SPA fallback so deep links (e.g. ?list=token) resolve to index.html.
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT ?? 8787);
// Bind to loopback by default so only the local tunnel agent reaches the API,
// never the LAN. Set HOST=0.0.0.0 to deliberately expose it on the network.
const host = process.env.HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`pax-planner API listening on http://${host}:${info.port}`);
});
