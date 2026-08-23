import { describe, expect, it } from "vitest";
import { FENCE_IN_FLIGHT, mergeProgress, type ProgressMap } from "./progressMerge.ts";
import type { ProgressEntry } from "./api.ts";

const entry = (itemId: string, qty: number, byHandle = "ana"): ProgressEntry => ({
  itemId,
  qty,
  byHandle,
  updatedAt: "2026-08-23T00:00:00.000Z",
});

const map = (...es: ProgressEntry[]): ProgressMap =>
  Object.fromEntries(es.map((e) => [e.itemId, e]));

describe("mergeProgress", () => {
  it("takes the server's value when nothing is fenced", () => {
    const local = map(entry("iron", 1));
    const merged = mergeProgress([entry("iron", 7)], local, new Map(), 5);
    expect(merged.iron?.qty).toBe(7);
  });

  it("keeps the local value while a write is in flight", () => {
    const local = map(entry("iron", 10));
    const fences = new Map([["iron", FENCE_IN_FLIGHT]]);
    // Even a very recent snapshot loses to an in-flight write.
    const merged = mergeProgress([entry("iron", 0)], local, fences, 9999);
    expect(merged.iron?.qty).toBe(10);
  });

  it("ignores a snapshot issued before the write was acknowledged", () => {
    // The core race: poll issued at seq 4, our write settled at seq 4, so this
    // snapshot cannot have observed it.
    const local = map(entry("iron", 10));
    const fences = new Map([["iron", 4]]);
    const merged = mergeProgress([entry("iron", 0)], local, fences, 4);
    expect(merged.iron?.qty).toBe(10);
  });

  it("accepts a snapshot issued after the write was acknowledged", () => {
    const local = map(entry("iron", 10));
    const fences = new Map([["iron", 4]]);
    const merged = mergeProgress([entry("iron", 25)], local, fences, 5);
    expect(merged.iron?.qty).toBe(25);
  });

  it("lets a collaborator's newer value through once the fence is released", () => {
    // We set 10; Bo then gathered more. A later poll must not be held back just
    // because we were the last local writer.
    const local = map(entry("iron", 10, "ana"));
    const fences = new Map([["iron", 2]]);
    const merged = mergeProgress([entry("iron", 40, "bo")], local, fences, 7);
    expect(merged.iron?.qty).toBe(40);
    expect(merged.iron?.byHandle).toBe("bo");
  });

  it("fences one item without freezing the rest of the map", () => {
    const local = map(entry("iron", 10), entry("wood", 1));
    const fences = new Map([["iron", FENCE_IN_FLIGHT]]);
    const merged = mergeProgress([entry("iron", 0), entry("wood", 99)], local, fences, 3);
    expect(merged.iron?.qty).toBe(10); // protected
    expect(merged.wood?.qty).toBe(99); // updated normally
  });

  it("preserves a fenced item the snapshot has never heard of", () => {
    // First ever write for this item: the server row did not exist when the
    // snapshot was built, so the item is simply absent from it.
    const local = map(entry("iron", 10));
    const fences = new Map([["iron", FENCE_IN_FLIGHT]]);
    const merged = mergeProgress([], local, fences, 3);
    expect(merged.iron?.qty).toBe(10);
  });

  it("drops a local item that is no longer fenced and no longer on the server", () => {
    // Someone cleared it; with the fence released we must accept the removal
    // rather than resurrecting our stale copy forever.
    const local = map(entry("iron", 10));
    const fences = new Map([["iron", 1]]);
    const merged = mergeProgress([], local, fences, 5);
    expect(merged.iron).toBeUndefined();
  });

  it("adds items introduced by other clients", () => {
    const merged = mergeProgress([entry("stone", 3, "bo")], {}, new Map(), 1);
    expect(merged.stone?.qty).toBe(3);
  });

  it("does not mutate the local map it was given", () => {
    const local = map(entry("iron", 10));
    const snapshot = { ...local.iron };
    mergeProgress([entry("iron", 99)], local, new Map(), 2);
    expect(local.iron).toEqual(snapshot);
  });
});
