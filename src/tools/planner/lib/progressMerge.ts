/** Merging a polled progress snapshot into what the client already has.
 *
 * The poll returns the whole progress map, so applying it naively overwrites
 * local writes that the server had not yet committed when it built the snapshot:
 *
 *   t=0.00  user sets qty 10   -> optimistic 10 on screen, POST in flight
 *   t=0.05  poll issued        -> server still reads 0, POST not committed
 *   t=0.10  POST returns 10    -> 10 on screen (correct)
 *   t=0.15  poll returns 0     -> 0 on screen, and it stays wrong until the
 *                                 next tick — a full poll interval of showing
 *                                 the user a number they know they changed.
 *
 * The fix is a per-item fence keyed on a monotonic poll sequence number. Each
 * poll is tagged with a seq when it is ISSUED. A local write sets that item's
 * fence to Infinity while in flight, then to the latest issued seq once the
 * server has acknowledged it. A snapshot may only replace an item's value if it
 * was issued strictly after that fence — such a poll provably started after the
 * server knew our value, so anything it reports is either ours or someone
 * else's newer write, and both are wanted. Earlier snapshots keep the local
 * value for fenced items and apply normally to everything else.
 *
 * Kept pure and separate from the hook so the ordering rules can be tested
 * directly rather than through React timing. */
import type { ProgressEntry } from "./api.ts";

export type ProgressMap = Record<string, ProgressEntry>;

/** Fence value meaning "a write is in flight; no snapshot may replace this". */
export const FENCE_IN_FLIGHT = Number.POSITIVE_INFINITY;

/**
 * @param entries  progress rows from the polled snapshot
 * @param local    what the client currently shows
 * @param fences   itemId -> minimum poll seq allowed to overwrite it
 * @param seq      sequence number this snapshot's poll was issued with
 */
export function mergeProgress(
  entries: ProgressEntry[],
  local: ProgressMap,
  fences: Map<string, number>,
  seq: number,
): ProgressMap {
  const merged: ProgressMap = {};
  for (const e of entries) {
    const fence = fences.get(e.itemId) ?? -1;
    // Fenced: this snapshot predates our write, so keep what we have.
    merged[e.itemId] = seq > fence ? e : (local[e.itemId] ?? e);
  }
  // Items we have written but the snapshot doesn't mention (the row did not
  // exist server-side when it was taken) must survive too — otherwise a brand
  // new count vanishes the moment an older poll lands.
  for (const [itemId, entry] of Object.entries(local)) {
    if (merged[itemId]) continue;
    if (seq <= (fences.get(itemId) ?? -1)) merged[itemId] = entry;
  }
  return merged;
}
