# Usage metrics
Key: MET · Status: Approved · Owner: — · Updated: 2026-11-03

## Story
As the operator, I want aggregate usage numbers without cookies or stored IPs, so that I know
how the tool is used without tracking anyone.

## Context
- Architecture: [architecture.md](../../architecture.md) §4 "Logging and observability"
- ADRs: [0011](../../adr/0011-collect-only-server-side-aggregate-metrics.md)
- Related: [platform epic](../../epics/platform/epic.md) #4. Depends on serving (SRV). Uses
  ABU-3's client identity. Code: `server/metrics.ts`, the `metrics`, `visitors` and `meta`
  tables in `server/db.ts`.
- Terms:
  - **visitor**: a client (ABU-3) seen on a day, identified by HMAC-SHA256 of its address
    with a server-held key (the **pepper**).
  - **event counter**: a daily count of a named event.

## Scope
In: counting visitors, event counters, and the `/api/stats` endpoint.
Out: client-side analytics (there are none, by
[ADR 0011](../../adr/0011-collect-only-server-side-aggregate-metrics.md)), and pruning the
visitors table.

## Acceptance criteria

### MET-1: Each client is counted once a day
Given one client making many requests on one UTC day,
When the visitors are counted,
Then that client appears once for that day. Two different clients are two visitors.

### MET-2: Raw addresses are never stored
Given any request,
When it is counted,
Then nothing in the database contains the client's address. Only its HMAC is stored.

### MET-3: The same client hashes the same after a restart
Given a client counted before a server restart,
When it is seen again after the restart,
Then it has the same hash, because the pepper is generated once and kept in the database.

### MET-4: Events are counted per day
Given a named event such as a list being created,
When it happens n times on one UTC day,
Then that day's counter for it is n. Counts of 0 or less, and counts that aren't numbers, are
ignored.

### MET-5: Stats are closed unless a token is configured
Given no `STATS_TOKEN` is set,
When `GET /api/stats` is requested, with or without credentials,
Then the response is 404.

### MET-6: Stats need the exact bearer token
Given `STATS_TOKEN` is set,
When `GET /api/stats` is requested with a missing, malformed or wrong `Authorization:
Bearer` token,
Then the response is 401, and no figures are returned.

### MET-7: Stats return aggregates only
Given `STATS_TOKEN` is set,
When `GET /api/stats` is requested with the right token,
Then the response has:
- `generatedAt` and `lists.live` (lists currently stored);
- total and per-day event counters;
- `visitors.total`, `visitors.activeToday` and new visitors per day.

It contains no hashes, tokens or list contents.

### MET-8: Stats requests aren't visits
Given any request to `/api/stats`,
When it is handled,
Then it isn't counted as a visit.

## Non-functional requirements

### MET-N1: Counting visitors is cheap
A client causes at most one database write per UTC day for visitor tracking, however many
requests it makes. The in-memory record of who has been seen is trimmed above 50,000
entries.

### MET-N2: The token check is constant-time
Comparing the bearer token takes the same time whatever the token's length or content, so
response timing doesn't reveal it.

## Open questions
None. Settled on 2026-11-03: the `visitors` table isn't pruned, as a known risk
([architecture.md](../../architecture.md) §8, [CAPACITY.md](../../CAPACITY.md) "What is still
unbounded"). Pruning would change what `visitors.total` means, so it needs its own decision.

## Changelog
- 2026-11-03 — created (backfilled from the code and `metrics.test.ts`)
- 2026-11-03 — approved
