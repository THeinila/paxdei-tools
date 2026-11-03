# Abuse limits
Key: ABU · Status: Approved · Owner: — · Updated: 2026-11-03

## Story
As the operator, I want per-client rate limits and a disk-space floor, so that one client
can't exhaust the host while households behind one NAT can still use the app normally.

## Context
- Architecture: [architecture.md](../../architecture.md) §4 "Abuse limits", §8
- ADRs: [0013](../../adr/0013-let-the-disk-guard-fail-open.md) (the disk guard fails open), [0005](../../adr/0005-serve-the-spa-and-api-from-one-hono-and-sqlite-process.md) (in-process state), [0006](../../adr/0006-share-lists-by-secret-token-with-no-accounts.md) (unauthenticated creation)
- Related: [platform epic](../../epics/platform/epic.md) #3. Depends on serving (SRV). Code:
  `server/rateLimit.ts`, `server/diskGuard.ts`, the middleware order in `server/index.ts`.
  Capacity: [CAPACITY.md](../../CAPACITY.md) "Rate limits" and "Guard rails".
- Terms:
  - **client**: who a request is counted against (ABU-3).
  - **window**: a fixed period in which a client's requests are counted, starting with its
    first request.
  - **read**: a GET or HEAD request; anything else is a **write**.

## Scope
In: the rate limiters on `/api/*`, the creation budget, client identity, and the disk guard
on list creation.
Out: the body limit (SRV-9), retention (RET), and what the proxy forwards.

## Acceptance criteria

### ABU-1: A client over its budget gets 429
Given a client that has used its whole budget in the current window,
When it sends another request in that window,
Then the response is 429 `{ "error": "rate limit exceeded" }` with `retry-after` set to the
whole seconds until the window resets, and at least 1.

### ABU-2: The budget comes back when the window resets
Given a client that was refused with 429,
When its window has reset,
Then its requests are accepted again.

### ABU-3: A client is its first forwarded address
Given a request,
When it is counted,
Then its client is the first entry of `X-Forwarded-For`, or the socket's remote address
when that header is missing or empty, or one shared bucket when neither is available.

### ABU-4: Reads and writes have separate budgets
Given a client that has used its whole write budget,
When it sends a read,
Then the read is accepted, and the reverse holds too.

### ABU-5: List creation has its own budget on top of the write budget
Given a client that has used its creation budget (ABU-N1),
When it sends `POST /api/lists`,
Then it gets 429, while its other writes (edits and progress) are still accepted.

### ABU-6: Clients don't share budgets
Given two clients with different addresses,
When one of them uses up a budget,
Then the other's requests are still accepted.

### ABU-7: Low disk refuses only new lists
Given free space on the database's volume below the floor (ABU-N2),
When a client sends `POST /api/lists`,
Then the response is 503 `{ "error": "storage full", … }` with `retry-after: 3600`. Reads,
edits and progress writes on existing lists still succeed.

### ABU-8: An unmeasurable disk doesn't block creation
Given free space can't be measured (the check fails, or hasn't run yet),
When a client sends `POST /api/lists`,
Then the list is created ([ADR 0013](../../adr/0013-let-the-disk-guard-fail-open.md)), and
the failure is logged.

### ABU-9: The disk check works before the database exists
Given the database file doesn't exist yet,
When free space is measured,
Then the guard measures the file's directory instead.

### ABU-10: Crossing the floor is logged once each way
Given free space falls below the floor,
When it is measured,
Then one log line says new lists are being refused. Later checks that are still below the
floor log nothing, and one line says so when space recovers.

## Non-functional requirements

### ABU-N1: Budgets fit real use behind one address
Per client: 240 reads a minute, 120 writes a minute, and 600 list creations an hour. 240
reads a minute leaves room for about 40 tabs polling at PRG-N1's interval from one address
([CAPACITY.md](../../CAPACITY.md) "Rate limits").

### ABU-N2: The disk check is cheap
The floor is 256 MB free. Free space is measured at most once a minute, however many
requests arrive ([CAPACITY.md](../../CAPACITY.md) "Guard rails").

### ABU-N3: Limiter memory is bounded
Once more than 10,000 client buckets exist, buckets whose windows have ended are removed.

## Open questions
None. Settled on 2026-11-03:
- Budgets live in process memory and reset on restart. That's a known risk
  ([architecture.md](../../architecture.md) §8), accepted with
  [ADR 0005](../../adr/0005-serve-the-spa-and-api-from-one-hono-and-sqlite-process.md).
- ABU-3 trusts the first `X-Forwarded-For` entry. That's safe only because Caddy, the only
  public listener, sets the header, and the app binds to loopback (SRV-N1).

## Changelog
- 2026-11-03 — created (backfilled from the code and `diskGuard.test.ts`)
- 2026-11-03 — approved
