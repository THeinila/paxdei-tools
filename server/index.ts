/** Entry point for the sharing backend. Serves the /api routes and, in
 * production, the built SPA from dist/ so the whole app is single-origin. In
 * dev the Vite server (port 5173) proxies /api here. */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "./db.ts";
import { createListsRouter } from "./lists.ts";

const db = openDb();
const app = new Hono();

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
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`pax-planner API listening on http://localhost:${info.port}`);
});
