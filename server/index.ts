/** Entry point for the sharing backend. Serves the /api routes and, in
 * production, the built SPA from dist/ so the whole app is single-origin. In
 * dev the Vite server (port 5173) proxies /api here. The app itself is built
 * in server/app.ts; this file opens the database, starts the retention sweep
 * and listens. */
import { serve } from "@hono/node-server";
import { createApp, listenAddress } from "./app.ts";
import { dbPathFor, openDb } from "./db.ts";
import { createDiskGuard } from "./diskGuard.ts";
import { startRetention, ttlDaysFromEnv } from "./retention.ts";

const db = openDb();
const diskGuard = createDiskGuard({ path: dbPathFor() });
void diskGuard.refresh();
const app = createApp({ db, diskGuard, statsToken: process.env.STATS_TOKEN });

// Retention sweep. Runs once at boot and then daily; see server/retention.ts for
// why reads don't count as activity. LIST_TTL_DAYS=0 disables it.
startRetention(db, { ttlDays: ttlDaysFromEnv() });

const { port, hostname } = listenAddress();
serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`pax-planner API listening on http://${hostname}:${info.port}`);
});
