/** Tiny in-memory fixed-window rate limiter — no dependency, single-process.
 *
 * Requests reach us through a tunnel (ngrok/cloudflared) or the local proxy, so
 * the socket address is always loopback; we key on `x-forwarded-for` (the tunnel
 * sets the real client IP there) and fall back to a single shared bucket when the
 * header is absent. That fallback means a missing XFF degrades to a global cap
 * rather than no cap — safe by default. */
import type { Context, MiddlewareHandler } from "hono";

interface Window {
  count: number;
  resetAt: number;
}

function clientKey(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    // XFF is a comma-separated list; the first entry is the original client.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "_shared";
}

/** Fixed-window limiter: at most `limit` requests per `windowMs` per client.
 * `name` namespaces the buckets so independent limiters don't share counters. */
export function rateLimit(opts: {
  name: string;
  limit: number;
  windowMs: number;
}): MiddlewareHandler {
  const buckets = new Map<string, Window>();

  return async (c, next) => {
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
