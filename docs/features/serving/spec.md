# Serving
Key: SRV · Status: Approved · Owner: — · Updated: 2026-11-03

## Story
As the operator, I want the SPA and the API served from one process with correct caching and
security headers, so that redeploys reach users at once and the site is safe to expose.

## Context
- Architecture: [architecture.md](../../architecture.md) §2, §4 "Security headers", §7
- ADRs: [0005](../../adr/0005-serve-the-spa-and-api-from-one-hono-and-sqlite-process.md) (one process), [0012](../../adr/0012-set-security-headers-in-the-app-with-a-strict-same-origin-cs.md) (headers in the app), [0004](../../adr/0004-lazy-load-the-dataset-as-its-own-hashed-chunk.md)
- Related: [platform epic](../../epics/platform/epic.md) #2. Code: `server/index.ts`,
  `server/securityHeaders.ts`. Capacity: [CAPACITY.md](../../CAPACITY.md) "The three
  ceilings", item 2.

## Scope
In: static file caching, the SPA fallback, unknown API paths, `/healthz`, security headers,
the body limit and the bind address.
Out: TLS, compression and HSTS (Caddy), rate limits and the disk guard (ABU).

## Acceptance criteria

### SRV-1: Hashed assets are cached forever
Given a production build,
When a file under `/assets/` is served,
Then it has `Cache-Control: public, max-age=31536000, immutable`.

### SRV-2: Icons are cached for 30 days
Given a production build,
When a file under `/icons/` is served,
Then it has `Cache-Control: public, max-age=2592000`.

### SRV-3: Everything else is revalidated
Given a production build,
When `index.html` or any other file outside `/assets/` and `/icons/` is served,
Then it has `Cache-Control: no-cache`.

### SRV-4: Deep links serve the app
Given a production build,
When a browser requests a non-API path with no file behind it (for example
`/planner/<token>`),
Then the response is `index.html` with status 200 and `Cache-Control: no-cache`.

### SRV-5: Unknown API paths are a JSON 404
Given any build,
When a client requests a path under `/api/` that no route handles, with any method,
Then the response is 404 with a JSON body `{ "error": "not found" }`, never `index.html`.

### SRV-6: `/healthz` reports health without detail
Given the server is running,
When `GET /healthz` is requested,
Then it answers 200 "ok" when the database answers a query and the disk isn't low, 503
"db unavailable" when the database query fails, and 503 "disk low" when free space is below
the ABU-N2 floor. The body never contains counts, versions or paths.

### SRV-7: Every response carries the security headers
Given any request, for HTML, an asset, an API route or an error,
When it is answered,
Then the response has `Content-Security-Policy` (SRV-8), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` and `X-Frame-Options: DENY`.

### SRV-8: The CSP is same-origin and blocks script injection
Given the `Content-Security-Policy` header,
When it is read,
Then:
- `default-src`, `script-src`, `connect-src` and `font-src` are `'self'` only;
- `script-src` has no `'unsafe-inline'` and no `'unsafe-eval'`;
- `style-src` is `'self' 'unsafe-inline'`, and `img-src` is `'self' data:`;
- `object-src` is `'none'`, `base-uri` and `form-action` are `'self'`, and
  `frame-ancestors` is `'none'`.

### SRV-9: Oversized API bodies are rejected
Given a request to `/api/*` with a body larger than 64 KB,
When it arrives,
Then it is rejected with 413, and nothing is stored.

### SRV-10: /healthz reports a database failure the same way to every client
Given the database stops answering,
When any client requests `GET /healthz`, including one not yet counted as a visitor today,
Then the response is 503 "db unavailable". Usage counting never turns a health check into a
different status or body.

## Non-functional requirements

### SRV-N1: The server listens on loopback by default
With `HOST` unset, the server binds only to `127.0.0.1` (port `PORT`, default 8787), so only
the local proxy can reach it. `HOST` overrides the bind address.

### SRV-N2: A code-only deploy keeps the dataset cached
Two production builds that differ only in application code produce the same file name for
the dataset chunk, so returning users don't download it again
([CAPACITY.md](../../CAPACITY.md) "Cost per request").

## Open questions
None. SRV-2 was settled on 2026-11-03: icons get 30 days rather than `immutable`, so that
artwork replaced under the same name reaches users within a month.


## Changelog
- 2026-11-03 — created (backfilled from the code and `securityHeaders.test.ts`)
- 2026-11-03 — SRV-5 specifies a JSON 404 for unknown API paths (found in the backfill; the code still differs)
- 2026-11-03 — approved
- 2026-11-03 — SRV-10 added, from a failure found while testing SRV-6 (the code still differs); back to Draft for re-approval
- 2026-11-03 — re-approved with SRV-10
- 2026-11-03 — SRV-5 fixed in the code (Phase 5b); discrepancy closed
- 2026-11-03 — SRV-10 fixed in the code (Phase 5b); discrepancy closed
