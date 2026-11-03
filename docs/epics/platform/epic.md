# Epic: Suite shell and serving platform
Status: Draft · Updated: 2026-11-03

## Goal
The suite is reachable at one origin, survives its tiny host, and tells its operator how it
is used without tracking anyone. It worked if the site stays up on a 1/8-OCPU VM with about
60 concurrent tabs ([CAPACITY.md](../../CAPACITY.md)), a redeploy reaches users without a
hard refresh, and abuse is bounded without blocking normal use.

**Backfill.** Every feature here is already built (Toolkit 1.5.1). The order records
dependencies, not delivery. Draft ACs come from `server/*.test.ts`, `Home.test.tsx` and
the code. The capacity constants become `-N` NFRs that cite the CAPACITY.md section that
justifies them.

## Features

### 1. tool-suite-shell · Key: SHL
Story: As a player, I want one site with a landing page and navigation across every tool, so that I can find and switch between Pax Dei tools.
Depends on: —
Draft ACs:
- SHL-1: The landing page shows a card for every registered tool, linking to its path, with its name, description and version.
- SHL-2: The header names the site, links home, links each tool and What's New, and marks the current page.
- SHL-3: The footer shows the toolkit version, which links to What's New.
- SHL-4: What's New lists releases newest first, each with its version, title, date, and changes grouped by tool and labelled New, Improved or Fixed.
- SHL-5: An unknown path redirects to the landing page.
- SHL-6: While a tool's code and data are loading, the page shows "Loading…".

### 2. serving · Key: SRV
Story: As the operator, I want the SPA and the API served from one process with correct caching and security headers, so that redeploys reach users at once and the site is safe to expose.
Depends on: —
Draft ACs:
- SRV-1: Content-hashed files under `/assets/` are served with `public, max-age=31536000, immutable`, icons with `public, max-age=2592000`, and everything else, including `index.html`, with `no-cache`.
- SRV-2: A deep link such as `/planner/<token>` serves `index.html`.
- SRV-3: `GET /healthz` returns 200 "ok" when the database answers and the disk isn't low, and 503 otherwise, with no counts or versions.
- SRV-4: Every response, HTML and API alike, carries the CSP, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `X-Frame-Options: DENY`.
- SRV-5: The CSP allows scripts, connections and fonts from the same origin only, allows inline styles but not inline or eval'd scripts, and blocks framing, plugins and `<base>` injection.
- SRV-6: API request bodies over 64 KB are rejected.
- SRV-N1: The server binds to `127.0.0.1` unless `HOST` says otherwise.

### 3. abuse-limits · Key: ABU
Story: As the operator, I want per-client rate limits and a disk-space floor, so that one client can't exhaust the host while households behind one NAT can still use the app normally.
Depends on: serving
Draft ACs:
- ABU-1: A client over a limit gets 429 with a `retry-after` in whole seconds (at least 1), and its requests pass again once the window resets.
- ABU-2: Reads (GET and HEAD) and writes are counted against separate budgets, and `POST /api/lists` also has its own creation budget.
- ABU-3: A client is identified by the first `X-Forwarded-For` entry, then the socket address, then one shared bucket.
- ABU-4: Below the free-space floor, `POST /api/lists` returns 503 with `retry-after: 3600`. Reads, edits and progress writes keep working.
- ABU-5: If disk space can't be measured, list creation is allowed (fail open). The check also works before the database file exists.
- ABU-N1: The budgets are 240 reads per minute, 120 writes per minute and 600 creations per hour per client ([CAPACITY.md](../../CAPACITY.md), "Rate limits").
- ABU-N2: The disk floor is 256 MB, and free space is measured at most once a minute however many requests arrive ([CAPACITY.md](../../CAPACITY.md), "Guard rails").

### 4. usage-metrics · Key: MET
Story: As the operator, I want aggregate usage numbers without cookies or stored IPs, so that I know how the tool is used without tracking anyone.
Depends on: serving
Draft ACs:
- MET-1: Each distinct client is counted once per day however many requests it makes, as an HMAC of its IP. The raw IP is never stored.
- MET-2: The same client gets the same hash after a restart.
- MET-3: List creations, and other named events, are counted per day.
- MET-4: `GET /api/stats` returns 404 when no `STATS_TOKEN` is set, and 401 for a missing or wrong bearer token.
- MET-5: Requests to `/api/stats` aren't counted as visits.

## Out of scope
- CI and the deploy runbook (`deploy/`): operations, not app behaviour. CI is on the roadmap.
- Pruning the `visitors` table, and rate-limit state that survives a restart: recorded as risks in [architecture.md](../../architecture.md) §8.

## Open questions
None. All four specs were approved on 2026-11-03.
- Kept as they are, with the reasoning in each spec: in-memory rate-limit budgets (ABU),
  the unpruned `visitors` table (MET), 30-day icon caching (SRV-2), and redirecting unknown
  paths home (SHL-6).
- One behaviour, found during the backfill, is specified differently from the code. It will
  be fixed later:

| AC | Spec says | Code does |
|---|---|---|
| [SRV-5](../../features/serving/spec.md) | An unknown `/api/*` path returns a JSON 404 | `GET` falls through to the SPA fallback and returns `index.html` with 200 |
| [SRV-10](../../features/serving/spec.md) | /healthz gives 503 "db unavailable" to every client when the database is down | The day's first probe from each address gets 500 (found in Phase 5) |
