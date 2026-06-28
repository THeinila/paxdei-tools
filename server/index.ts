/** Entry point for the sharing backend. Serves the /api routes and, in
 * production, the built SPA from dist/ so the whole app is single-origin. In
 * dev the Vite server (port 5173) proxies /api here. */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "./db.ts";
import { createListsRouter } from "./lists.ts";
import { rateLimit } from "./rateLimit.ts";

const db = openDb();
const app = new Hono();

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

// Serve the production build when present (no-op in dev, where Vite serves it).
const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
if (existsSync(distDir)) {
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
