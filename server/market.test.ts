/** Market layer tests against an in-memory DB and the fixture upstream.
 * Focus: rollup semantics (unit prices, mastercraft exclusion, qtyAtMin), the
 * hourly TTL cache (no upstream traffic inside the TTL), single-flight, and
 * stale-snapshot fallback when a refresh fails. */
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "./db.ts";
import { createMarketRouter } from "./market.ts";
import { createUpstream, rollup, type Upstream } from "./marketUpstream.ts";
import type { WorldPrices, ZonePrices, ZoneTree } from "../shared/marketTypes.ts";

let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
});

/** Wrap the fixture upstream with call counters and an on/off failure switch. */
function countingUpstream() {
  const inner = createUpstream("fixtures");
  const counts = { index: 0, zones: 0 };
  const state = { fail: false };
  const upstream: Upstream = {
    fetchIndex: () => {
      counts.index += 1;
      if (state.fail) return Promise.reject(new Error("injected failure"));
      return inner.fetchIndex();
    },
    fetchZoneListings: (ref) => {
      counts.zones += 1;
      if (state.fail) return Promise.reject(new Error("injected failure"));
      return inner.fetchZoneListings(ref);
    },
  };
  return { upstream, counts, state };
}

describe("rollup", () => {
  it("computes unit prices from listing totals and aggregates volumes", () => {
    const prices = rollup([
      { item_id: "charcoal", quantity: 100, price: 50 }, // 0.5/u
      { item_id: "charcoal", quantity: 100, price: 52 }, // 0.52/u — within 10% of min
      { item_id: "charcoal", quantity: 50, price: 100 }, // 2.0/u — excluded from qtyAtMin
    ]);
    expect(prices.charcoal!.min).toBe(0.5);
    expect(prices.charcoal!.median).toBe(0.52);
    expect(prices.charcoal!.qtyAtMin).toBe(200);
    expect(prices.charcoal!.totalQty).toBe(250);
    expect(prices.charcoal!.listings).toBe(3);
  });

  it("excludes mastercraft listings and tolerates malformed rows", () => {
    const prices = rollup([
      { item_id: "knife", quantity: 1, price: 2 },
      { item_id: "knife", quantity: 1, price: 50, mastercraft: 1 },
      { item_id: "junk", quantity: 0, price: 5 },
      { item_id: "junk2", quantity: 5, price: Number.NaN },
    ]);
    expect(prices.knife).toEqual({ min: 2, median: 2, qtyAtMin: 1, totalQty: 1, listings: 1 });
    expect(prices.junk).toBeUndefined();
    expect(prices.junk2).toBeUndefined();
  });
});

describe("mode: off", () => {
  it("serves status but 503s data endpoints", async () => {
    const app = createMarketRouter(db, { mode: "off" });
    const status = await app.request("/status");
    expect(await status.json()).toEqual({ enabled: false, mode: "off" });
    expect((await app.request("/zones")).status).toBe(503);
    expect((await app.request("/prices/testworld/merrie/shire")).status).toBe(503);
    expect((await app.request("/world/testworld")).status).toBe(503);
  });
});

describe("fixtures mode", () => {
  it("builds the zone tree from the index", async () => {
    const app = createMarketRouter(db, { mode: "fixtures" });
    const res = await app.request("/zones");
    expect(res.status).toBe(200);
    const tree = (await res.json()) as ZoneTree;
    expect(tree.worlds.testworld!.merrie).toEqual(["shire", "yarborn"]);
    expect(tree.worlds.testworld!.ancien).toEqual(["libornes"]);
    expect(tree.worlds.otherworld!.merrie).toEqual(["shire"]);
  });

  it("serves per-zone rollups with the documented semantics", async () => {
    const app = createMarketRouter(db, { mode: "fixtures" });
    const res = await app.request("/prices/testworld/merrie/shire");
    expect(res.status).toBe(200);
    const zp = (await res.json()) as ZonePrices;
    expect(zp.stale).toBe(false);
    // Iron ingot: 20@60 (3/u) + 100@320 (3.2/u, within 10%) + 500@5000 (10/u).
    expect(zp.prices.item_material_ingot_iron).toEqual({
      min: 3,
      median: 3.2,
      qtyAtMin: 120,
      totalQty: 620,
      listings: 3,
    });
    // Mastercraft knife (1@50) must not drag the ordinary knife's stats.
    expect(zp.prices.wieldable_tool_skinning_knife_t1_uncommon!.min).toBe(2);
    expect(zp.prices.wieldable_tool_skinning_knife_t1_uncommon!.listings).toBe(1);
  });

  it("404s unknown zones and worlds", async () => {
    const app = createMarketRouter(db, { mode: "fixtures" });
    expect((await app.request("/prices/testworld/merrie/nowhere")).status).toBe(404);
    expect((await app.request("/world/nowhere")).status).toBe(404);
  });

  it("serves a whole world's zones", async () => {
    const app = createMarketRouter(db, { mode: "fixtures" });
    const res = await app.request("/world/testworld");
    const wp = (await res.json()) as WorldPrices;
    expect(wp.zones.map((z) => `${z.domain}/${z.zone}`).sort()).toEqual([
      "ancien/libornes",
      "merrie/shire",
      "merrie/yarborn",
    ]);
    expect(wp.missing).toEqual([]);
    const yarborn = wp.zones.find((z) => z.zone === "yarborn")!;
    expect(yarborn.prices.item_material_ingot_iron!.min).toBe(8);
  });
});

describe("caching", () => {
  it("does not refetch inside the hourly TTL, refetches after it", async () => {
    let clock = Date.parse("2026-07-07T00:00:00Z");
    const { upstream, counts } = countingUpstream();
    const app = createMarketRouter(db, { mode: "fixtures", upstream, now: () => clock });

    await app.request("/prices/testworld/merrie/shire");
    await app.request("/prices/testworld/merrie/shire");
    await app.request("/prices/testworld/merrie/shire");
    expect(counts.zones).toBe(1);
    expect(counts.index).toBe(1);

    clock += 59 * 60 * 1000; // still within the hour
    await app.request("/prices/testworld/merrie/shire");
    expect(counts.zones).toBe(1);

    clock += 2 * 60 * 1000; // 61 min — upstream has a new hourly snapshot
    const res = await app.request("/prices/testworld/merrie/shire");
    expect(counts.zones).toBe(2);
    expect(((await res.json()) as ZonePrices).stale).toBe(false);
  });

  it("single-flights concurrent requests for the same zone", async () => {
    const { upstream, counts } = countingUpstream();
    const app = createMarketRouter(db, { mode: "fixtures", upstream });
    await Promise.all([
      app.request("/prices/testworld/merrie/shire"),
      app.request("/prices/testworld/merrie/shire"),
      app.request("/prices/testworld/merrie/shire"),
    ]);
    expect(counts.zones).toBe(1);
  });

  it("serves the last good snapshot as stale when a refresh fails", async () => {
    let clock = Date.parse("2026-07-07T00:00:00Z");
    const { upstream, counts, state } = countingUpstream();
    const app = createMarketRouter(db, { mode: "fixtures", upstream, now: () => clock });

    await app.request("/prices/testworld/merrie/shire");
    expect(counts.zones).toBe(1);

    clock += 2 * 60 * 60 * 1000; // TTL well past
    state.fail = true;
    const res = await app.request("/prices/testworld/merrie/shire");
    expect(res.status).toBe(200);
    const zp = (await res.json()) as ZonePrices;
    expect(zp.stale).toBe(true);
    expect(zp.prices.item_material_ingot_iron!.min).toBe(3); // old snapshot intact
  });

  it("502s when a zone has never been fetched and upstream is down", async () => {
    const { upstream, state } = countingUpstream();
    const app = createMarketRouter(db, { mode: "fixtures", upstream });
    await app.request("/zones"); // cache the index first
    state.fail = true;
    expect((await app.request("/prices/testworld/merrie/shire")).status).toBe(502);
  });
});
