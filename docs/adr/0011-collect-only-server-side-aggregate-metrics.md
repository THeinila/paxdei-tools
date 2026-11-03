# 0011. Collect only server-side aggregate metrics
Status: Accepted · Date: 2026-11-03
Backfilled from: `server/metrics.ts`, `server/db.ts`, README "Architecture"

## Context
We want to know roughly how many people use the tool and how many lists they create,
without cookies, consent banners, third-party trackers or storing IP addresses. Spec:
usage-metrics (MET).

## Decision
All metrics are collected on the server, in the app's own database.
- **Event counters:** `metrics(day, metric, count)` holds daily aggregates such as
  `list_created`. Nothing is recorded per user.
- **Unique visitors:** `visitors(hash, first_seen, last_seen)`, where hash is
  HMAC-SHA256(pepper, client IP). The pepper is 32 random bytes generated once and kept in
  `meta`. The raw IP is never stored. An in-memory cache limits this to one write per
  client per day.
- The client key is the same as the rate limiter's: the first `X-Forwarded-For` entry, then
  the socket address, then one shared bucket.
- `GET /api/stats` returns aggregates only. It returns 404 unless `STATS_TOKEN` is set, and
  then needs it as a bearer token, compared in constant time. Requests to the stats route
  don't count as visits.

## Consequences
- No client-side tracking code, no cookies, and nothing on the page for the CSP to allow.
- An IP is only an approximation of a user: shared households merge into one, and dynamic IPs
  split one person into several.
- The hashes are only meaningful with the pepper in this database. Anyone who has the
  database file has the pepper too, and could brute-force IPv4 hashes from it.
- The `visitors` table grows by one row per unique IP, forever. Nothing prunes it
  ([CAPACITY.md](../CAPACITY.md), "What is still unbounded").

## Alternatives considered
- A third-party analytics service — rejected for privacy and CSP reasons.
- Cookie or localStorage visitor IDs — rejected because they need consent and client code.
