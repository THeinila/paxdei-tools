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

Memory is a **deploy-time** constraint, and used to be a dangerous one. The old
flow built in the live directory, `npm ci` removes `node_modules` before
reinstalling, and `npm start` was `tsx server/index.ts` — putting a devDependency
on the production start path. An OOM partway through left no `node_modules`, no
`tsx`, and a service that could not start, with no rollback.

Both halves are fixed:

- **The server is compiled ahead of time.** `npm run build:server` bundles it to
  `dist-server/index.js` with esbuild (native and runtime packages stay
  external), and `npm start` is plain `node dist-server/index.js`. Production
  needs only `dependencies`; `deploy.sh` runs `npm prune --omit=dev` after
  building.
- **Deploys are atomic.** `deploy/deploy.sh` builds a new release directory as a
  git worktree and only swaps the `current` symlink once the build *and* a
  `/healthz` check have passed, rolling back automatically if the new release
  does not come up. A failed build cannot touch the running service.

Give the instance swap anyway — a 1 GB box running `npm ci` and Vite has very
little margin.

## Retention

Lists used to accumulate forever, which made `POST /api/lists` — unauthenticated
— a disk-exhaustion path. Because the database shares the boot volume with the
OS, filling it takes down sshd and journald too, not just the app.

`server/retention.ts` now sweeps lists with no **write** activity for
`LIST_TTL_DAYS` (default 90, `0` disables). Progress rows cascade away with the
list. The sweep runs at boot and then daily.

Two details that matter:

- **Reads do not count as activity.** Keeping a list alive on `GET` would mean a
  database write on every poll — precisely the load this host cannot afford, and
  a forgotten open tab would keep a dead list alive indefinitely.
- **`updated_at` was the wrong clock**, so there is a separate
  `last_activity_at`. `updated_at` moves with `version`, i.e. only on definition
  edits — a group that has settled its targets and is only ticking items off
  would look untouched and get swept while actively in use. Progress writes bump
  `last_activity_at` and deliberately leave `updated_at` alone.

The window is stated in the UI (`LIST_TTL_DAYS` in `shared/listTypes.ts`, shown
in the planner footer). If an operator overrides the env var, that constant needs
changing too or the app misstates its own policy.

## What is still unbounded

- **`visitors` grows one row per unique IP forever.** Indexed now
  (`first_seen`, `last_seen`), so `/api/stats` no longer full-scans, but nothing
  prunes it.
- **Rate-limit buckets live in process memory**, so every restart resets every
  counter. A crash loop therefore bypasses rate limiting.
