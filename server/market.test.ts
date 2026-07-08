/** Market layer tests against an in-memory DB and the fixture upstream.
 * Focus: rollup semantics (unit prices, mastercraft exclusion, qtyAtMin), the
 * hourly TTL cache (no upstream traffic inside the TTL), single-flight, and
 * stale-snapshot fallback when a refresh fails. */
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "./db.ts";
import { createMarketRouter, createMarketService } from "./market.ts";
import { createMarketCollector, seedFixtureHistory } from "./marketCollector.ts";
import {
  createUpstream,
  rollup,
  type Upstream,
  type UpstreamListing,
  type ZoneRef,
} from "./marketUpstream.ts";
import type { WorldPrices, WorldStats, ZonePrices, ZoneTree } from "../shared/marketTypes.ts";

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

// ---- History & sales inference ----------------------------------------------------

/** An upstream whose zone contents the test mutates between snapshots. */
function syntheticUpstream(zones: Record<string, UpstreamListing[]>): Upstream {
  const refs: ZoneRef[] = Object.keys(zones).map((k) => {
    const [world, domain, zone] = k.split("/") as [string, string, string];
    return { world, domain, zone, url: `https://x.invalid/paxdei/market/${k}.json` };
  });
  return {
    fetchIndex: async () => refs,
    fetchZoneListings: async (ref) => zones[`${ref.world}/${ref.domain}/${ref.zone}`] ?? [],
  };
}

const listing = (
  id: string,
  item_id: string,
  quantity: number,
  price: number,
  extra: Partial<UpstreamListing> = {},
): UpstreamListing => ({ id, item_id, quantity, price, lifetime: 1, ...extra });

describe("history accumulation & sales inference", () => {
  const BASE = Date.parse("2026-07-07T00:00:00Z");

  it("records hourly and daily rows on each snapshot", async () => {
    const zones = { "w/m/z": [listing("a", "charcoal", 100, 50)] };
    const svc = createMarketService(db, { mode: "fixtures", upstream: syntheticUpstream(zones), now: () => BASE });
    await svc.ensureIndex();
    await svc.ensureZone(svc.findZone("w", "m", "z")!);

    const hourly = db.prepare(`SELECT * FROM market_history_hourly`).all() as Record<string, unknown>[];
    expect(hourly).toHaveLength(1);
    expect(hourly[0]).toMatchObject({ item_id: "charcoal", min_price: 0.5 });

    const daily = db.prepare(`SELECT * FROM market_history_daily`).all() as Record<string, unknown>[];
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({
      item_id: "charcoal", day: "2026-07-07", min_min: 0.5, median_min: 0.5, snapshots: 1, sold_qty: 0,
    });
  });

  it("counts a vanished fresh listing as an estimated sale, a run-out one as expired", async () => {
    const zones: Record<string, UpstreamListing[]> = {
      "w/m/z": [
        listing("a", "charcoal", 100, 50), // fresh — will vanish → sold
        listing("b", "charcoal", 50, 100, { lifetime: 0.01 }), // nearly expired — will vanish → expired
        listing("c", "ingot", 20, 60), // stays
      ],
    };
    let clock = BASE;
    const svc = createMarketService(db, { mode: "fixtures", upstream: syntheticUpstream(zones), now: () => clock });
    await svc.ensureIndex();
    const ref = svc.findZone("w", "m", "z")!;
    await svc.ensureZone(ref);

    zones["w/m/z"] = [listing("c", "ingot", 20, 60)];
    clock += 61 * 60 * 1000; // past the TTL, same day
    await svc.ensureZone(ref);

    const charcoal = db
      .prepare(`SELECT sold_qty, sold_value, expired_qty FROM market_history_daily WHERE item_id = 'charcoal'`)
      .get() as { sold_qty: number; sold_value: number; expired_qty: number };
    expect(charcoal.sold_qty).toBe(100);
    expect(charcoal.sold_value).toBeCloseTo(50); // 100 x 0.5g
    expect(charcoal.expired_qty).toBe(50);

    // Resolved listings are gone; the surviving one is still tracked.
    const left = db.prepare(`SELECT id FROM market_listings`).all() as { id: string }[];
    expect(left.map((r) => r.id)).toEqual(["c"]);

    // The ingot saw no sales.
    const ingot = db
      .prepare(`SELECT sold_qty FROM market_history_daily WHERE item_id = 'ingot'`)
      .get() as { sold_qty: number };
    expect(ingot.sold_qty).toBe(0);
  });

  it("excludes mastercraft listings from sales aggregates", async () => {
    const zones: Record<string, UpstreamListing[]> = {
      "w/m/z": [listing("mc", "knife", 1, 50, { mastercraft: 1 }), listing("k", "knife", 1, 2)],
    };
    let clock = BASE;
    const svc = createMarketService(db, { mode: "fixtures", upstream: syntheticUpstream(zones), now: () => clock });
    await svc.ensureIndex();
    const ref = svc.findZone("w", "m", "z")!;
    await svc.ensureZone(ref);

    zones["w/m/z"] = []; // both vanish
    clock += 61 * 60 * 1000;
    await svc.ensureZone(ref);

    const knife = db
      .prepare(`SELECT sold_qty, sold_value FROM market_history_daily WHERE item_id = 'knife'`)
      .get() as { sold_qty: number; sold_value: number };
    expect(knife.sold_qty).toBe(1); // only the ordinary knife
    expect(knife.sold_value).toBeCloseTo(2);
  });

  it("prunes hourly rows past 72 h and daily rows past 60 d", async () => {
    const zones = { "w/m/z": [listing("a", "charcoal", 100, 50)] };
    const svc = createMarketService(db, { mode: "fixtures", upstream: syntheticUpstream(zones), now: () => BASE });
    db.prepare(
      `INSERT INTO market_history_hourly VALUES ('w','m','z','old','2026-07-01T00:00:00.000Z',1,1,1,1)`,
    ).run();
    db.prepare(
      `INSERT INTO market_history_daily (world, domain, zone, item_id, day, min_min, median_min, snapshots)
       VALUES ('w','m','z','old','2026-01-01',1,1,1)`,
    ).run();
    await svc.ensureIndex();
    await svc.ensureZone(svc.findZone("w", "m", "z")!);

    expect(db.prepare(`SELECT * FROM market_history_hourly WHERE item_id = 'old'`).all()).toHaveLength(0);
    expect(db.prepare(`SELECT * FROM market_history_daily WHERE item_id = 'old'`).all()).toHaveLength(0);
  });
});

describe("stats & history endpoints", () => {
  const NOW = Date.parse("2026-07-07T12:00:00Z");

  it("folds daily rows into 7-day stats", async () => {
    const app = createMarketRouter(db, { mode: "fixtures", now: () => NOW });
    await app.request("/zones"); // populate the index from fixtures
    const insDaily = db.prepare(
      `INSERT INTO market_history_daily (world, domain, zone, item_id, day, min_min, median_min, snapshots, sold_qty, sold_value)
       VALUES ('testworld','merrie','shire','ingot', ?, ?, ?, 24, ?, 0)`,
    );
    for (const [day, medianV, minV, sold] of [
      ["2026-07-05", 4, 3.6, 10],
      ["2026-07-06", 5, 4.5, 0],
      ["2026-07-07", 6, 5.4, 20],
      ["2026-06-01", 99, 99, 99], // outside the window — ignored
    ] as [string, number, number, number][]) {
      insDaily.run(day, minV, medianV, sold);
    }

    const res = await app.request("/world/testworld/stats");
    expect(res.status).toBe(200);
    const ws = (await res.json()) as WorldStats;
    const s = ws.stats["merrie/shire"]!.ingot!;
    expect(s.medianMin7d).toBe(5);
    expect(s.daysObserved).toBe(3);
    expect(s.soldPerDay).toBe(10); // (10+0+20)/3
    expect(s.lastSaleAt).toBe("2026-07-07");
    expect(s.cv7d).toBeGreaterThan(0.1);
  });

  it("includes zone stats in the prices payload and serves item history", async () => {
    const app = createMarketRouter(db, { mode: "fixtures", now: () => NOW });
    await app.request("/zones");
    db.prepare(
      `INSERT INTO market_history_daily (world, domain, zone, item_id, day, min_min, median_min, snapshots, sold_qty, sold_value)
       VALUES ('testworld','merrie','shire','item_material_charcoal','2026-07-06',0.4,0.5,24,80,40)`,
    ).run();

    const prices = (await (await app.request("/prices/testworld/merrie/shire")).json()) as ZonePrices;
    // 80 sold yesterday, 0 today (the /prices snapshot opened today's row) → 40/day.
    expect(prices.stats!.item_material_charcoal!.soldPerDay).toBe(40);

    const hist = (await (
      await app.request("/history/testworld/merrie/shire/item_material_charcoal")
    ).json()) as { hourly: unknown[]; daily: { day: string; soldQty: number }[] };
    expect(hist.daily.some((d) => d.day === "2026-07-06" && d.soldQty === 80)).toBe(true);
    expect(hist.hourly.length).toBeGreaterThan(0); // from the /prices snapshot above
  });
});

describe("collector & seeder", () => {
  it("collects due zones in batches and goes idle when everything is fresh", async () => {
    const { upstream, counts } = countingUpstream();
    const svc = createMarketService(db, { mode: "fixtures", upstream });
    const collector = createMarketCollector(svc);
    expect(await collector.tick()).toBe(4); // all fixture zones due
    expect(counts.zones).toBe(4);
    expect(await collector.tick()).toBe(0); // everything fresh now
    expect(counts.zones).toBe(4);
  });

  it("seeds fixture history idempotently, with the engineered cases", async () => {
    const svc = createMarketService(db, { mode: "fixtures" });
    await seedFixtureHistory(db, svc);
    const n1 = (db.prepare(`SELECT COUNT(*) AS n FROM market_history_daily`).get() as { n: number }).n;
    expect(n1).toBeGreaterThan(0);
    await seedFixtureHistory(db, svc);
    const n2 = (db.prepare(`SELECT COUNT(*) AS n FROM market_history_daily`).get() as { n: number }).n;
    expect(n2).toBe(n1);

    // Buy anomaly: libornes ingot history sits well above its current price of 2.
    const stats = svc.worldStats("testworld").stats["ancien/libornes"]!;
    expect(stats.item_material_ingot_iron!.medianMin7d!).toBeGreaterThan(4);
    // The zero-sales trap.
    const shire = svc.worldStats("testworld").stats["merrie/shire"]!;
    expect(shire.item_material_ingot_wrought_iron!.soldPerDay).toBe(0);
    // The volatile item.
    expect(stats.activatable_foodraw_berry_grape_red_staminaregen_21!.cv7d!).toBeGreaterThan(0.5);
  });
});
