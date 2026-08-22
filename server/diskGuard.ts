/** Refuse to grow the database when the volume is nearly full.
 *
 * The retention sweep bounds growth over time, but it runs daily and only
 * removes lists past their TTL — it cannot save us from a burst. On the
 * production host the SQLite file shares the 47 GB boot volume with the OS, and
 * a genuinely full disk is worse than an outage: SQLite in WAL mode can be left
 * corrupt, and journald and sshd start failing too, so you may not be able to
 * log in to fix it.
 *
 * So we stop early and deliberately. Below `minFreeBytes` the one endpoint that
 * creates rows out of thin air (`POST /api/lists`) returns 503 while everything
 * else — reading, editing and ticking off existing lists — keeps working. Losing
 * the ability to start a new list is a far better failure than losing the
 * database.
 *
 * The check is cached: statfs is a syscall and this host has ~125 ms of CPU per
 * second to spend, so it runs at most once per `checkIntervalMs`. */
import { statfs } from "node:fs/promises";
import { dirname } from "node:path";
import type { MiddlewareHandler } from "hono";

export interface DiskStatus {
  /** Bytes available to an unprivileged writer, or null if unknown. */
  freeBytes: number | null;
  /** True when we positively know we are below the threshold. */
  low: boolean;
  checkedAt: number;
}

/** Default floor. Generous relative to the data (a list is a few KB) because the
 * point is to stop well before the OS itself is in trouble. */
export const DEFAULT_MIN_FREE_BYTES = 256 * 1024 * 1024; // 256 MB

export interface DiskGuard {
  /** Current cached view; triggers a refresh if the cache is stale. */
  status(): DiskStatus;
  /** Force a check now (used at boot and by tests). */
  refresh(): Promise<DiskStatus>;
  /** Middleware that 503s when space is low. */
  middleware(): MiddlewareHandler;
}

export function createDiskGuard(opts: {
  /** A path on the volume to watch — the database file is the obvious one. */
  path: string;
  minFreeBytes?: number;
  checkIntervalMs?: number;
  log?: (msg: string) => void;
}): DiskGuard {
  const minFree = opts.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES;
  const interval = opts.checkIntervalMs ?? 60_000;
  const log = opts.log ?? console.log;

  // Unknown until the first successful check. Fail OPEN: if we cannot measure
  // the disk we must not block writes on a guess.
  let cached: DiskStatus = { freeBytes: null, low: false, checkedAt: 0 };
  let inFlight: Promise<DiskStatus> | null = null;
  let warned = false;

  const check = async (): Promise<DiskStatus> => {
    try {
      // statfs wants a path that exists; the database file may not yet, so fall
      // back to its directory.
      let target = opts.path;
      let stats;
      try {
        stats = await statfs(target);
      } catch {
        target = dirname(opts.path);
        stats = await statfs(target);
      }
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const low = freeBytes < minFree;
      if (low && !warned) {
        log(
          `disk guard: only ${(freeBytes / 1e6).toFixed(0)} MB free on ${target} ` +
            `(floor ${(minFree / 1e6).toFixed(0)} MB) — refusing new lists`,
        );
        warned = true;
      } else if (!low && warned) {
        log(`disk guard: space recovered (${(freeBytes / 1e6).toFixed(0)} MB free)`);
        warned = false;
      }
      cached = { freeBytes, low, checkedAt: Date.now() };
    } catch (e) {
      // Never let a failed measurement take the server down, and never let it
      // start rejecting writes either.
      cached = { freeBytes: null, low: false, checkedAt: Date.now() };
      log(`disk guard: check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      inFlight = null;
    }
    return cached;
  };

  const refresh = (): Promise<DiskStatus> => (inFlight ??= check());

  const status = (): DiskStatus => {
    if (Date.now() - cached.checkedAt > interval) void refresh();
    return cached;
  };

  return {
    status,
    refresh,
    middleware(): MiddlewareHandler {
      return async (c, next) => {
        const s = status();
        if (s.low) {
          return c.json(
            {
              error: "storage full",
              detail: "The server is low on disk space and cannot create new lists right now.",
            },
            503,
            { "retry-after": "3600" },
          );
        }
        await next();
      };
    },
  };
}
