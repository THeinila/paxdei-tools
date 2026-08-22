/** Retention sweep for shared lists.
 *
 * `POST /api/lists` is unauthenticated and nothing else in the system ever
 * deleted a list, so the database only grew. That is a disk-exhaustion path, and
 * because the SQLite file shares the boot volume with the OS on the production
 * VM, filling it takes down sshd and journald too — not just the app.
 *
 * The sweep deletes lists with no write activity for `LIST_TTL_DAYS` (default
 * 90). Progress rows go with them via ON DELETE CASCADE. Reads deliberately do
 * NOT count as activity: keeping a list alive on GET would mean a write on every
 * poll, which is exactly the load this host cannot afford. A list nobody has
 * edited or ticked an item on in three months is dead. */
import type { DB } from "./db.ts";
import { bumpMetric } from "./metrics.ts";
import { LIST_TTL_DAYS } from "../shared/listTypes.ts";

/** Shared with the client so the UI states the real retention window. */
export const DEFAULT_TTL_DAYS = LIST_TTL_DAYS;

/** Parse LIST_TTL_DAYS. 0 (or a negative/garbage value) disables the sweep. */
export function ttlDaysFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LIST_TTL_DAYS;
  if (raw === undefined || raw === "") return DEFAULT_TTL_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TTL_DAYS;
  return Math.floor(n);
}

/** ISO timestamp `days` before `now`. */
export function cutoffFor(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Delete lists idle for longer than `ttlDays`. Returns how many went.
 * A ttlDays of 0 disables retention and deletes nothing. */
export function sweepLists(db: DB, ttlDays: number, now: Date = new Date()): number {
  if (ttlDays <= 0) return 0;
  const cutoff = cutoffFor(ttlDays, now);
  const info = db.prepare(`DELETE FROM lists WHERE last_activity_at < ?`).run(cutoff);
  const deleted = info.changes;
  if (deleted > 0) bumpMetric(db, "lists_swept", deleted);
  return deleted;
}

/** Run the sweep now, then on an interval. Returns a stop function.
 *
 * Daily is frequent enough for a 90-day window and keeps the cost off a host
 * that has ~125ms of CPU per second to spend. `unref()` so the timer never holds
 * the process open by itself. */
export function startRetention(
  db: DB,
  opts: { ttlDays?: number; intervalMs?: number; log?: (msg: string) => void } = {},
): () => void {
  const ttlDays = opts.ttlDays ?? ttlDaysFromEnv();
  const intervalMs = opts.intervalMs ?? 24 * 60 * 60 * 1000;
  const log = opts.log ?? console.log;

  if (ttlDays <= 0) {
    log("retention: disabled (LIST_TTL_DAYS=0) — lists are kept forever");
    return () => {};
  }

  const run = () => {
    try {
      const n = sweepLists(db, ttlDays);
      if (n > 0) log(`retention: swept ${n} list(s) idle for over ${ttlDays} days`);
    } catch (e) {
      // Never let a sweep failure take the server down; it retries next tick.
      log(`retention: sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
