# 0005. Serve the SPA and API from one Hono and SQLite process
Status: Proposed · Date: 2026-11-03
Backfilled from: `server/index.ts`, `server/db.ts`, `deploy/DEPLOY.md`, CHANGELOG 1.0.0

## Context
Sharing needs a small amount of durable state: list definitions, per-item progress, and a
few metrics tables. The production host is one Oracle Always Free VM with 1/8 OCPU and
1 GB RAM, for $0 a month. There is no managed database. Specs: serving (SRV), share-link
(SHR).

## Decision
One Node process runs Hono on `@hono/node-server`. It serves `/api/*`, `/healthz` and, in
production, the built SPA from `dist/` with an `index.html` fallback for deep links, so the
whole app is same-origin. State is one better-sqlite3 file.
- One synchronous connection per process, with WAL (pollers read without blocking the
  writer), `busy_timeout = 5000` and `foreign_keys = ON`.
- `migrate()` is idempotent and runs on every boot.
- The database path is `DB_PATH`, or `server/data.sqlite` relative to the working directory.
- The process binds to `127.0.0.1` by default. Caddy terminates TLS, compresses responses
  and proxies to it.
- Cache policy: `/assets/*` is immutable for a year, `/icons/*` is cached for 30 days, and
  everything else (including `index.html`) is `no-cache`.
- In development, Vite serves the SPA and proxies `/api` to port 8787.

## Consequences
- One deployable, one origin (no CORS) and one file to back up (`deploy/backup.sh`).
- Single writer by construction. The progress delta in
  [0009](0009-use-additive-deltas-for-progress-and-version-guards-for-defi.md) relies on it.
- No horizontal scaling. Rate-limit buckets and the metrics cache live in process memory and
  reset on restart.
- `serveStatic` never answers conditional requests with 304, which is why icons need a
  long `max-age`.

## Alternatives considered
- A managed database or a separate API service — rejected because the free-tier VM is the
  budget, and the data fits in one SQLite file.
- Serving static files from Caddy — not chosen. Keeping the cache policy in the app keeps it
  next to the code that depends on it (inferred from the code comments).
