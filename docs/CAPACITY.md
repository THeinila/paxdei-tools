# Capacity: what the free-tier box can actually carry

Production is an Oracle Always Free **VM.Standard.E2.1.Micro**: 1/8 OCPU (burstable
AMD EPYC), 1 GB RAM, 47 GB boot volume. That works out to roughly **125 ms of
full-core CPU per wall second**, sustained.

Every tuning constant in the serving path is chosen against that budget. This file
records the arithmetic so the next person to change one knows what they are
trading away.

> These are estimates derived from the code paths and measured asset sizes, not
> from load testing the production instance. Treat them as the right order of
> magnitude, not as precise figures.

## Cost per request

| Request | Bytes out | CPU | % of budget |
|---|---:|---:|---:|
| Poll (`GET /api/lists/:token`) | ~1 KB | ~2.5 ms | 2% |
| One icon | 10 KB | ~1.5 ms | 1.2% |
| JS bundle (compressed) | ~182 KB | ~4 ms | 3% |
| JS bundle (uncompressed) | 1.82 MB | ~40 ms | 32% |
| Cold page load | ~250 KB | ~25 ms | 20% |

## The three ceilings

**1. Concurrent open tabs — about 60.**
Each open shared list costs one poll per interval, forever. At `POLL_MS = 10s`
that is 0.1 req/s × 2.5 ms ≈ **0.25 ms/s per tab**. Against a 40% utilization
target (50 ms/s) that is ~200 tabs; derate hard for bursts and call it **60
comfortable**. At the old 3-second interval the same target gave ~60 absolute, so
widening the poll was worth roughly 3× capacity on its own.

**2. Page loads — about 25/min.**
Dominated by first-load asset cost. Two fixes matter here and both are config:

- `encode zstd gzip` in the Caddyfile. The bundle inlines the whole item dataset,
  so it is 1.82 MB raw and ~182 KB gzipped — a 10× saving on the largest thing
  the host serves.
- Icons cached for 30 days (`server/index.ts`). They used to fall into the
  `no-cache` bucket, and `@hono/node-server`'s `serveStatic` sends `Last-Modified`
  but **never answers a conditional request with a 304** — it always streams the
  full body. So every reload re-downloaded every icon on screen. A 50-icon plan is
  ~500 KB and ~75 ms of CPU per page view.

**3. Rate limits — no longer the binding constraint.**
This used to be the first thing real users hit, and it was self-inflicted. A flat
`60 req/min` per client sat *below* what the app itself generated: the limiter
keys on client IP, so everyone behind one NAT counts as a single client, and at a
3-second poll three tabs in one household consumed the entire allowance. Families,
LAN groups and carrier-grade NAT users experienced it as the app randomly
breaking.

Now split by method (`server/index.ts`):

| Limiter | Budget | Rationale |
|---|---|---|
| `read` | 240/min | ~40 concurrent tabs per address at a 10s poll. Reads are cheap and mutate nothing. |
| `write` | 120/min | Comfortably above bulk check-off; still bounds abuse. |
| `create` | 600/hour | The one unauthenticated endpoint that grows the database. |

## So how many users?

Gaming communities run 5–10% concurrency at peak. At ~60 concurrent tabs and 8%
concurrency, the box serves a community of roughly **750 people** — call it 500 to
1,500 depending on how bursty sessions are.

## Memory

Not the runtime constraint. Node + Hono + better-sqlite3 is ~100–150 MB RSS, Caddy
30–50 MB, Ubuntu 150–250 MB — comfortable inside 1 GB. The dataset is bundled into
the *client* JS, so the server never loads it.

Memory is a **deploy-time** constraint. `npm ci` removes `node_modules` before
reinstalling, and `npm start` runs `tsx server/index.ts` — so `tsx`, a
devDependency, is on the production start path. An OOM partway through an on-host
build leaves no `node_modules`, no `tsx`, and a service that will not start, with
no rollback. Build off-host, or at minimum ensure the instance has swap.

Note that `deploy/DEPLOY.md` was written against a much larger A1 shape
(1–2 OCPU / 6–12 GB); its on-host build steps are not safe at 1 GB.

## What is still unbounded

- **Lists and progress are never deleted.** No TTL, no GC. `POST /api/lists` is
  unauthenticated, so this is a disk-exhaustion path — and the database shares the
  boot volume with the OS.
- **`visitors` grows one row per unique IP forever**, and `/api/stats` runs full
  scans plus a `GROUP BY first_seen` with no index on that column.
- **Rate-limit buckets live in process memory**, so every restart resets every
  counter.
