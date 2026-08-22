/** Tiny in-memory fixed-window rate limiter — no dependency, single-process.
 *
 * Requests reach us through Caddy (or a tunnel in test deployments), so the
 * socket address is normally loopback; we key on `x-forwarded-for`, which the
 * proxy sets to the real client IP.
 *
 * Sizing note: these limits have to sit comfortably ABOVE what the app itself
 * generates, and the unit that matters is the household, not the person. A
 * shared list polls on a fixed interval, and several people behind one NAT (or
 * one carrier-grade NAT) all count as a single client here — so a limit tuned to
 * one tab turns into "the app randomly breaks for families and LAN groups".
 * Reads are therefore budgeted for many concurrent tabs per address, while
 * writes (which mutate, and which `POST /api/lists` grows the database with)
 * stay tight. See docs/CAPACITY.md for the arithmetic. */
import type { Context, MiddlewareHandler } from "hono";

interface Window {
  count: number;
  resetAt: number;
}

/** Best-effort client identity: the first XFF entry (set by the proxy), else the
 * peer's socket address, else a single shared bucket. The socket fallback only
 * differentiates anything if the app is ever reached directly rather than
 * through Caddy — but in exactly that misconfiguration it is the difference
 * between per-client limits and one global bucket for the whole internet.
 * Also used by server/metrics.ts so rate limiting and visitor counting agree on
 * what "one client" means. */
export function clientKey(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    // XFF is a comma-separated list; the first entry is the original client.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  try {
    const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming
      ?.socket?.remoteAddress;
    if (remote) return remote;
  } catch {
    // c.env shape is runtime-specific; fall through to the shared bucket.
  }
  return "_shared";
}

/** Fixed-window limiter: at most `limit` requests per `windowMs` per client.
 * `name` namespaces the buckets so independent limiters don't share counters.
 * `when` optionally scopes the limiter to a subset of requests (e.g. writes
 * only); requests it rejects pass through untouched. */
export function rateLimit(opts: {
  name: string;
  limit: number;
  windowMs: number;
  when?: (c: Context) => boolean;
}): MiddlewareHandler {
  const buckets = new Map<string, Window>();

  return async (c, next) => {
    if (opts.when && !opts.when(c)) return next();

    const now = Date.now();
    const key = `${opts.name}:${clientKey(c)}`;
    let w = buckets.get(key);
    if (!w || now >= w.resetAt) {
      w = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, w);
    }
    w.count += 1;
    if (w.count > opts.limit) {
      const retryAfter = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
      return c.json({ error: "rate limit exceeded" }, 429, {
        "retry-after": String(retryAfter),
      });
    }

    // Opportunistic cleanup so the map can't grow without bound over a long run.
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }

    await next();
  };
}

/** True for requests that only read. Split out so the read and write limiters
 * can't disagree about which is which. */
export const isRead = (c: Context): boolean =>
  c.req.method === "GET" || c.req.method === "HEAD";
