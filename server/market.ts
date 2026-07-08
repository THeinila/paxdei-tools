/** Market price routes + the market service: a read-only, SQLite-cached view
 * over the upstream market data, plus self-accumulated history.
 *
 * The upstream refreshes hourly, so every zone snapshot has a 60-minute TTL;
 * requests inside the TTL are served straight from SQLite with zero upstream
 * traffic. Refreshes are single-flighted per zone, and when a refresh fails
 * the last good snapshot is served with stale=true instead of erroring.
 *
 * Every successful snapshot also feeds the history tables (the upstream has
 * no history or demand endpoints, so both are built here):
 *  - market_history_hourly: per-item price points, pruned after 72 h.
 *  - market_listings + market_history_daily: each listing has a stable id;
 *    one that vanishes between snapshots while its lifetime was still high
 *    counts as an (estimated) sale, otherwise as expired. Daily rows carry
 *    price aggregates + sold/expired counters, pruned after 60 d.
 *
 * The service object is shared between the HTTP router and the background
 * collector (server/marketCollector.ts) so both go through the same
 * single-flight map and TTL logic. Nothing here writes user data. */
import { Hono } from "hono";
import type { DB } from "./db.ts";
import type {
  ItemHistory,
  ItemStats,
  MarketMode,
  PriceRollup,
  WorldPrices,
  WorldStats,
  ZonePrices,
  ZoneTree,
} from "../shared/marketTypes.ts";
import {
  EXPIRY_EPSILON,
  createUpstream,
  marketMode,
  rollup,
  unitPrice,
  type Upstream,
  type UpstreamListing,
  type ZoneRef,
} from "./marketUpstream.ts";

/** Upstream data updates once per hour — refetching sooner buys nothing. */
export const ZONE_TTL_MS = 60 * 60 * 1000;
/** The zone index (worlds/domains/zones) changes ~never; refresh daily. */
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
/** Cold-loading a whole world touches ~40 zone files; keep it polite. */
const WORLD_CONCURRENCY = 6;
/** Browsers may re-request freely; let them reuse a response for 5 minutes. */
const HTTP_CACHE = "public, max-age=300";

const HOURLY_RETENTION_MS = 72 * 60 * 60 * 1000;
const DAILY_RETENTION_DAYS = 60;
/** Trailing window for ItemStats. */
const STATS_WINDOW_DAYS = 7;

const INDEX_META_KEY = "market_index_fetched_at";

interface ZoneRow {
  world: string;
  domain: string;
  zone: string;
  url: string;
}

interface PriceRow {
  item_id: string;
  min_price: number;
  median_price: number;
  qty_at_min: number;
  total_qty: number;
  listing_count: number;
}

interface DailyRow {
  domain: string;
  zone: string;
  item_id: string;
  day: string;
  min_min: number;
  median_min: number;
  sold_qty: number;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface MarketServiceOptions {
  mode?: MarketMode;
  /** Injectable for tests (call counting, failure injection). */
  upstream?: Upstream;
  now?: () => number;
}

export interface MarketService {
  mode: MarketMode;
  now: () => number;
  ensureIndex(): Promise<void>;
  ensureZone(ref: ZoneRow): Promise<void>;
  readZonePrices(ref: ZoneRow): ZonePrices | null;
  allZones(): ZoneRow[];
  zonesOfWorld(world: string): ZoneRow[];
  findZone(world: string, domain: string, zone: string): ZoneRow | undefined;
  /** Zones whose snapshot is older than the TTL (or never fetched), oldest
   * first — the background collector's work queue. */
  zonesDue(limit: number): ZoneRow[];
  zoneStats(ref: ZoneRow): Record<string, ItemStats>;
  worldStats(world: string): WorldStats;
  itemHistory(ref: ZoneRow, itemId: string): ItemHistory;
  indexFetchedAt(): string;
}

export function createMarketService(db: DB, opts: MarketServiceOptions = {}): MarketService {
  const mode = opts.mode ?? marketMode();
  const now = opts.now ?? Date.now;
  const upstream: Upstream | null =
    mode === "off" ? null : (opts.upstream ?? createUpstream(mode));

  const getMeta = db.prepare(`SELECT value FROM meta WHERE key = ?`);
  const setMeta = db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const listZones = db.prepare(
    `SELECT world, domain, zone, url FROM market_zones ORDER BY world, domain, zone`,
  );
  const zonesOfWorldStmt = db.prepare(`SELECT world, domain, zone, url FROM market_zones WHERE world = ?`);
  const findZoneStmt = db.prepare(
    `SELECT world, domain, zone, url FROM market_zones WHERE world = ? AND domain = ? AND zone = ?`,
  );
  const getFetch = db.prepare(
    `SELECT fetched_at FROM market_zone_fetches WHERE world = ? AND domain = ? AND zone = ?`,
  );
  const priceRows = db.prepare(
    `SELECT item_id, min_price, median_price, qty_at_min, total_qty, listing_count
     FROM market_prices WHERE world = ? AND domain = ? AND zone = ?`,
  );
  const zonesDueStmt = db.prepare(
    `SELECT z.world, z.domain, z.zone, z.url
     FROM market_zones z
     LEFT JOIN market_zone_fetches f
       ON f.world = z.world AND f.domain = z.domain AND f.zone = z.zone
     WHERE f.fetched_at IS NULL OR f.fetched_at < ?
     ORDER BY f.fetched_at ASC NULLS FIRST
     LIMIT ?`,
  );

  const ageMs = (iso: string | undefined): number =>
    iso ? now() - Date.parse(iso) : Number.POSITIVE_INFINITY;

  // ---- Index (zone tree) -----------------------------------------------------

  let indexFlight: Promise<void> | null = null;

  async function ensureIndex(): Promise<void> {
    const fetchedAt = (getMeta.get(INDEX_META_KEY) as { value: string } | undefined)?.value;
    const haveZones = (listZones.all() as ZoneRow[]).length > 0;
    if (haveZones && ageMs(fetchedAt) < INDEX_TTL_MS) return;
    indexFlight ??= (async () => {
      try {
        const refs = await upstream!.fetchIndex();
        if (refs.length === 0) throw new Error("upstream index is empty");
        const replace = db.transaction((rows: ZoneRef[]) => {
          db.prepare(`DELETE FROM market_zones`).run();
          const ins = db.prepare(
            `INSERT INTO market_zones (world, domain, zone, url) VALUES (?, ?, ?, ?)`,
          );
          for (const r of rows) ins.run(r.world, r.domain, r.zone, r.url);
          setMeta.run(INDEX_META_KEY, new Date(now()).toISOString());
        });
        replace(refs);
      } catch (e) {
        // A previously cached index keeps working past its TTL.
        if (!haveZones) throw e;
        console.warn(`market: index refresh failed, serving cached index: ${e}`);
      } finally {
        indexFlight = null;
      }
    })();
    return indexFlight;
  }

  // ---- Snapshot processing -----------------------------------------------------

  /** Apply one fresh zone snapshot: replace current rollups, append hourly
   * history, diff listings into estimated sales/expiries, upsert the daily
   * aggregate, stamp the fetch time, and prune old history. One transaction. */
  const applySnapshot = db.transaction((ref: ZoneRow, listings: UpstreamListing[]) => {
    const nowMs = now();
    const nowIso = new Date(nowMs).toISOString();
    const day = nowIso.slice(0, 10);
    const prices = rollup(listings);

    // 1. Current rollups (what /prices serves).
    db.prepare(`DELETE FROM market_prices WHERE world = ? AND domain = ? AND zone = ?`).run(
      ref.world,
      ref.domain,
      ref.zone,
    );
    const insPrice = db.prepare(
      `INSERT INTO market_prices
       (world, domain, zone, item_id, min_price, median_price, qty_at_min, total_qty, listing_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // 2. Hourly history point per item.
    const insHourly = db.prepare(
      `INSERT OR REPLACE INTO market_history_hourly
       (world, domain, zone, item_id, snapshot_at, min_price, median_price, total_qty, listing_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [itemId, p] of Object.entries(prices)) {
      insPrice.run(ref.world, ref.domain, ref.zone, itemId, p.min, p.median, p.qtyAtMin, p.totalQty, p.listings);
      insHourly.run(ref.world, ref.domain, ref.zone, itemId, nowIso, p.min, p.median, p.totalQty, p.listings);
    }

    // 3. Listing diff → estimated sales. A previously-active listing absent
    //    from this snapshot was sold (lifetime still high) or expired.
    const prev = db
      .prepare(
        `SELECT id, item_id, quantity, unit_price, mastercraft, lifetime_last
         FROM market_listings WHERE world = ? AND domain = ? AND zone = ?`,
      )
      .all(ref.world, ref.domain, ref.zone) as {
      id: string;
      item_id: string;
      quantity: number;
      unit_price: number;
      mastercraft: number;
      lifetime_last: number | null;
    }[];

    const upsertListing = db.prepare(
      `INSERT INTO market_listings
       (id, world, domain, zone, item_id, quantity, unit_price, mastercraft, first_seen, last_seen, lifetime_last)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         quantity = excluded.quantity, unit_price = excluded.unit_price,
         last_seen = excluded.last_seen, lifetime_last = excluded.lifetime_last`,
    );
    const currentIds = new Set<string>();
    for (const l of listings) {
      if (typeof l.id !== "string" || l.id.length === 0) continue;
      if (typeof l.item_id !== "string" || l.item_id.length === 0) continue;
      if (!Number.isFinite(l.quantity) || l.quantity <= 0) continue;
      if (!Number.isFinite(l.price) || l.price < 0) continue;
      currentIds.add(l.id);
      upsertListing.run(
        l.id,
        ref.world,
        ref.domain,
        ref.zone,
        l.item_id,
        l.quantity,
        unitPrice(l),
        l.mastercraft ? 1 : 0,
        nowIso,
        nowIso,
        l.lifetime ?? null,
      );
    }

    const sales = new Map<string, { qty: number; value: number; expired: number }>();
    const delListing = db.prepare(`DELETE FROM market_listings WHERE id = ?`);
    for (const p of prev) {
      if (currentIds.has(p.id)) continue;
      delListing.run(p.id);
      if (p.mastercraft) continue; // tracked, but excluded from aggregates
      const acc = sales.get(p.item_id) ?? { qty: 0, value: 0, expired: 0 };
      const sold = p.lifetime_last === null || p.lifetime_last > EXPIRY_EPSILON;
      if (sold) {
        acc.qty += p.quantity;
        acc.value += p.quantity * p.unit_price;
      } else {
        acc.expired += p.quantity;
      }
      sales.set(p.item_id, acc);
    }

    // 4. Daily aggregate. Price stats recomputed from today's hourly rows (the
    //    hourly table always covers the current day); sales are additive.
    const dayMins = db
      .prepare(
        `SELECT item_id, min_price FROM market_history_hourly
         WHERE world = ? AND domain = ? AND zone = ? AND snapshot_at >= ?`,
      )
      .all(ref.world, ref.domain, ref.zone, `${day}T00:00:00`) as { item_id: string; min_price: number }[];
    const byItem = new Map<string, number[]>();
    for (const r of dayMins) (byItem.get(r.item_id) ?? byItem.set(r.item_id, []).get(r.item_id)!).push(r.min_price);

    const upsertDailyPrices = db.prepare(
      `INSERT INTO market_history_daily
       (world, domain, zone, item_id, day, min_min, median_min, snapshots, sold_qty, sold_value, expired_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(world, domain, zone, item_id, day) DO UPDATE SET
         min_min = excluded.min_min, median_min = excluded.median_min, snapshots = excluded.snapshots,
         sold_qty = sold_qty + ?, sold_value = sold_value + ?, expired_qty = expired_qty + ?`,
    );
    for (const [itemId, mins] of byItem) {
      const s = sales.get(itemId) ?? { qty: 0, value: 0, expired: 0 };
      sales.delete(itemId);
      mins.sort((a, b) => a - b);
      upsertDailyPrices.run(
        ref.world, ref.domain, ref.zone, itemId, day,
        mins[0]!, median(mins), mins.length, s.qty, s.value, s.expired,
        s.qty, s.value, s.expired,
      );
    }
    // Items that sold out completely (no hourly row today): record the sale
    // with the vanished listing's price as the day's price estimate.
    const upsertDailySalesOnly = db.prepare(
      `INSERT INTO market_history_daily
       (world, domain, zone, item_id, day, min_min, median_min, snapshots, sold_qty, sold_value, expired_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(world, domain, zone, item_id, day) DO UPDATE SET
         sold_qty = sold_qty + excluded.sold_qty,
         sold_value = sold_value + excluded.sold_value,
         expired_qty = expired_qty + excluded.expired_qty`,
    );
    for (const [itemId, s] of sales) {
      const price = s.qty > 0 ? s.value / s.qty : 0;
      upsertDailySalesOnly.run(ref.world, ref.domain, ref.zone, itemId, day, price, price, s.qty, s.value, s.expired);
    }

    // 5. Fetch stamp.
    db.prepare(
      `INSERT INTO market_zone_fetches (world, domain, zone, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(world, domain, zone) DO UPDATE SET fetched_at = excluded.fetched_at`,
    ).run(ref.world, ref.domain, ref.zone, nowIso);

    // 6. Retention (indexed on snapshot_at / day; cheap when nothing matches).
    db.prepare(`DELETE FROM market_history_hourly WHERE snapshot_at < ?`).run(
      new Date(nowMs - HOURLY_RETENTION_MS).toISOString(),
    );
    db.prepare(`DELETE FROM market_history_daily WHERE day < ?`).run(
      isoDay(nowMs - DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    );
  });

  // ---- Zone snapshots ----------------------------------------------------------

  /** In-flight refreshes keyed world/domain/zone so concurrent requests (and
   * the background collector) trigger exactly one upstream fetch. */
  const zoneFlights = new Map<string, Promise<void>>();

  async function ensureZone(ref: ZoneRow): Promise<void> {
    const key = `${ref.world}/${ref.domain}/${ref.zone}`;
    const fetched = (getFetch.get(ref.world, ref.domain, ref.zone) as { fetched_at: string } | undefined)
      ?.fetched_at;
    if (ageMs(fetched) < ZONE_TTL_MS) return;

    let flight = zoneFlights.get(key);
    if (!flight) {
      flight = (async () => {
        try {
          const listings = await upstream!.fetchZoneListings(ref);
          applySnapshot(ref, listings);
        } catch (e) {
          // Keep the previous snapshot (served with stale=true); rethrow only
          // when there's nothing at all to serve.
          if (fetched === undefined) throw e;
          console.warn(`market: refresh failed for ${key}, serving stale snapshot: ${e}`);
        } finally {
          zoneFlights.delete(key);
        }
      })();
      zoneFlights.set(key, flight);
    }
    return flight;
  }

  function readZonePrices(ref: ZoneRow): ZonePrices | null {
    const fetched = (getFetch.get(ref.world, ref.domain, ref.zone) as { fetched_at: string } | undefined)
      ?.fetched_at;
    if (fetched === undefined) return null;
    const prices: Record<string, PriceRollup> = {};
    for (const r of priceRows.all(ref.world, ref.domain, ref.zone) as PriceRow[]) {
      prices[r.item_id] = {
        min: r.min_price,
        median: r.median_price,
        qtyAtMin: r.qty_at_min,
        totalQty: r.total_qty,
        listings: r.listing_count,
      };
    }
    return {
      world: ref.world,
      domain: ref.domain,
      zone: ref.zone,
      fetchedAt: fetched,
      // ensureZone just ran, so an over-TTL timestamp means the refresh failed.
      stale: ageMs(fetched) >= ZONE_TTL_MS,
      prices,
    };
  }

  // ---- Stats -------------------------------------------------------------------

  function statsSinceDay(): string {
    return isoDay(now() - (STATS_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
  }

  /** Fold daily rows (one zone-item group at a time) into ItemStats. */
  function foldStats(rows: DailyRow[]): ItemStats {
    const medians = rows.map((r) => r.median_min).sort((a, b) => a - b);
    const mins = rows.map((r) => r.min_min);
    const mean = mins.reduce((n, v) => n + v, 0) / mins.length;
    let cv: number | null = null;
    if (mins.length >= 2 && mean > 0) {
      const variance = mins.reduce((n, v) => n + (v - mean) ** 2, 0) / mins.length;
      cv = Math.sqrt(variance) / mean;
    }
    const soldTotal = rows.reduce((n, r) => n + r.sold_qty, 0);
    const saleDays = rows.filter((r) => r.sold_qty > 0).map((r) => r.day);
    return {
      medianMin7d: medians.length ? median(medians) : null,
      cv7d: cv,
      soldPerDay: soldTotal / rows.length,
      lastSaleAt: saleDays.length ? saleDays.sort()[saleDays.length - 1]! : null,
      daysObserved: rows.length,
    };
  }

  function groupStats(rows: DailyRow[]): Record<string, Record<string, ItemStats>> {
    const byZoneItem = new Map<string, Map<string, DailyRow[]>>();
    for (const r of rows) {
      const zk = `${r.domain}/${r.zone}`;
      const items = byZoneItem.get(zk) ?? byZoneItem.set(zk, new Map()).get(zk)!;
      (items.get(r.item_id) ?? items.set(r.item_id, []).get(r.item_id)!).push(r);
    }
    const out: Record<string, Record<string, ItemStats>> = {};
    for (const [zk, items] of byZoneItem) {
      out[zk] = {};
      for (const [itemId, itemRows] of items) out[zk][itemId] = foldStats(itemRows);
    }
    return out;
  }

  function worldStats(world: string): WorldStats {
    const sinceDay = statsSinceDay();
    const rows = db
      .prepare(
        `SELECT domain, zone, item_id, day, min_min, median_min, sold_qty
         FROM market_history_daily WHERE world = ? AND day >= ?`,
      )
      .all(world, sinceDay) as DailyRow[];
    return { world, sinceDay, stats: groupStats(rows) };
  }

  function zoneStats(ref: ZoneRow): Record<string, ItemStats> {
    const rows = db
      .prepare(
        `SELECT domain, zone, item_id, day, min_min, median_min, sold_qty
         FROM market_history_daily
         WHERE world = ? AND domain = ? AND zone = ? AND day >= ?`,
      )
      .all(ref.world, ref.domain, ref.zone, statsSinceDay()) as DailyRow[];
    return groupStats(rows)[`${ref.domain}/${ref.zone}`] ?? {};
  }

  function itemHistory(ref: ZoneRow, itemId: string): ItemHistory {
    const hourly = db
      .prepare(
        `SELECT snapshot_at, min_price, median_price FROM market_history_hourly
         WHERE world = ? AND domain = ? AND zone = ? AND item_id = ?
         ORDER BY snapshot_at ASC`,
      )
      .all(ref.world, ref.domain, ref.zone, itemId) as {
      snapshot_at: string;
      min_price: number;
      median_price: number;
    }[];
    const daily = db
      .prepare(
        `SELECT day, min_min, median_min, sold_qty FROM market_history_daily
         WHERE world = ? AND domain = ? AND zone = ? AND item_id = ?
         ORDER BY day ASC`,
      )
      .all(ref.world, ref.domain, ref.zone, itemId) as {
      day: string;
      min_min: number;
      median_min: number;
      sold_qty: number;
    }[];
    return {
      world: ref.world,
      domain: ref.domain,
      zone: ref.zone,
      itemId,
      hourly: hourly.map((h) => ({ at: h.snapshot_at, min: h.min_price, median: h.median_price })),
      daily: daily.map((d) => ({ day: d.day, minMin: d.min_min, medianMin: d.median_min, soldQty: d.sold_qty })),
    };
  }

  return {
    mode,
    now,
    ensureIndex,
    ensureZone,
    readZonePrices,
    allZones: () => listZones.all() as ZoneRow[],
    zonesOfWorld: (world) => zonesOfWorldStmt.all(world) as ZoneRow[],
    findZone: (world, domain, zone) => findZoneStmt.get(world, domain, zone) as ZoneRow | undefined,
    zonesDue: (limit) =>
      zonesDueStmt.all(new Date(now() - ZONE_TTL_MS).toISOString(), limit) as ZoneRow[],
    zoneStats,
    worldStats,
    itemHistory,
    indexFetchedAt: () =>
      (getMeta.get(INDEX_META_KEY) as { value: string } | undefined)?.value ?? "",
  };
}

// ---- Router ----------------------------------------------------------------------

export interface MarketRouterOptions extends MarketServiceOptions {
  service?: MarketService;
}

export function createMarketRouter(db: DB, opts: MarketRouterOptions = {}) {
  const svc = opts.service ?? createMarketService(db, opts);
  const app = new Hono();

  app.get("/status", (c) => c.json({ enabled: svc.mode !== "off", mode: svc.mode }));

  // Everything below needs an upstream.
  app.use("*", async (c, next) => {
    if (c.req.path.endsWith("/status")) return next();
    if (svc.mode === "off") return c.json({ error: "market data is not enabled" }, 503);
    return next();
  });

  app.get("/zones", async (c) => {
    await svc.ensureIndex();
    const worlds: ZoneTree["worlds"] = {};
    for (const z of svc.allZones()) {
      const domains = (worlds[z.world] ??= {});
      (domains[z.domain] ??= []).push(z.zone);
    }
    c.header("cache-control", HTTP_CACHE);
    return c.json({ fetchedAt: svc.indexFetchedAt(), worlds } satisfies ZoneTree);
  });

  app.get("/prices/:world/:domain/:zone", async (c) => {
    await svc.ensureIndex();
    const ref = svc.findZone(c.req.param("world"), c.req.param("domain"), c.req.param("zone"));
    if (!ref) return c.json({ error: "unknown zone" }, 404);
    try {
      await svc.ensureZone(ref);
    } catch (e) {
      return c.json({ error: `upstream fetch failed: ${e instanceof Error ? e.message : e}` }, 502);
    }
    c.header("cache-control", HTTP_CACHE);
    return c.json({ ...svc.readZonePrices(ref)!, stats: svc.zoneStats(ref) });
  });

  app.get("/history/:world/:domain/:zone/:itemId", async (c) => {
    await svc.ensureIndex();
    const ref = svc.findZone(c.req.param("world"), c.req.param("domain"), c.req.param("zone"));
    if (!ref) return c.json({ error: "unknown zone" }, 404);
    c.header("cache-control", HTTP_CACHE);
    return c.json(svc.itemHistory(ref, c.req.param("itemId")));
  });

  app.get("/world/:world/stats", async (c) => {
    await svc.ensureIndex();
    const world = c.req.param("world");
    if (svc.zonesOfWorld(world).length === 0) return c.json({ error: "unknown world" }, 404);
    c.header("cache-control", HTTP_CACHE);
    return c.json(svc.worldStats(world));
  });

  app.get("/world/:world", async (c) => {
    await svc.ensureIndex();
    const world = c.req.param("world");
    const refs = svc.zonesOfWorld(world);
    if (refs.length === 0) return c.json({ error: "unknown world" }, 404);

    // Refresh stale zones a few at a time; a zone that has never been fetched
    // successfully is reported in `missing` rather than failing the request.
    const queue = [...refs];
    const workers = Array.from({ length: Math.min(WORLD_CONCURRENCY, queue.length) }, async () => {
      for (let ref = queue.shift(); ref; ref = queue.shift()) {
        await svc.ensureZone(ref).catch(() => {});
      }
    });
    await Promise.all(workers);

    const zones: ZonePrices[] = [];
    const missing: WorldPrices["missing"] = [];
    for (const ref of refs) {
      const zp = svc.readZonePrices(ref);
      if (zp) zones.push(zp);
      else missing.push({ domain: ref.domain, zone: ref.zone });
    }
    c.header("cache-control", HTTP_CACHE);
    return c.json({ world, zones, missing } satisfies WorldPrices);
  });

  return app;
}
