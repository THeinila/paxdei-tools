/** Market price routes: a read-only, SQLite-cached view over the upstream
 * market data. The upstream refreshes hourly, so every zone snapshot has a
 * 60-minute TTL; requests inside the TTL are served straight from SQLite with
 * zero upstream traffic. Refreshes are single-flighted per zone, and when a
 * refresh fails the last good snapshot is served with stale=true instead of
 * erroring. Nothing here writes user data — the tables are a pure cache. */
import { Hono } from "hono";
import type { DB } from "./db.ts";
import type {
  MarketMode,
  PriceRollup,
  WorldPrices,
  ZonePrices,
  ZoneTree,
} from "../shared/marketTypes.ts";
import {
  createUpstream,
  marketMode,
  rollup,
  type Upstream,
  type ZoneRef,
} from "./marketUpstream.ts";

/** Upstream data updates once per hour — refetching sooner buys nothing. */
const ZONE_TTL_MS = 60 * 60 * 1000;
/** The zone index (worlds/domains/zones) changes ~never; refresh daily. */
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
/** Cold-loading a whole world touches ~40 zone files; keep it polite. */
const WORLD_CONCURRENCY = 6;
/** Browsers may re-request freely; let them reuse a response for 5 minutes. */
const HTTP_CACHE = "public, max-age=300";

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

export interface MarketRouterOptions {
  mode?: MarketMode;
  /** Injectable for tests (call counting, failure injection). */
  upstream?: Upstream;
  now?: () => number;
}

export function createMarketRouter(db: DB, opts: MarketRouterOptions = {}) {
  const mode = opts.mode ?? marketMode();
  const now = opts.now ?? Date.now;
  const upstream: Upstream | null =
    mode === "off" ? null : (opts.upstream ?? createUpstream(mode));

  const app = new Hono();

  const getMeta = db.prepare(`SELECT value FROM meta WHERE key = ?`);
  const setMeta = db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const listZones = db.prepare(`SELECT world, domain, zone, url FROM market_zones ORDER BY world, domain, zone`);
  const zonesOfWorld = db.prepare(`SELECT world, domain, zone, url FROM market_zones WHERE world = ?`);
  const findZone = db.prepare(
    `SELECT world, domain, zone, url FROM market_zones WHERE world = ? AND domain = ? AND zone = ?`,
  );
  const getFetch = db.prepare(
    `SELECT fetched_at FROM market_zone_fetches WHERE world = ? AND domain = ? AND zone = ?`,
  );
  const priceRows = db.prepare(
    `SELECT item_id, min_price, median_price, qty_at_min, total_qty, listing_count
     FROM market_prices WHERE world = ? AND domain = ? AND zone = ?`,
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

  // ---- Zone snapshots ----------------------------------------------------------

  /** In-flight refreshes keyed world/domain/zone so concurrent requests for the
   * same zone trigger exactly one upstream fetch. */
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
          const prices = rollup(listings);
          const write = db.transaction(() => {
            db.prepare(`DELETE FROM market_prices WHERE world = ? AND domain = ? AND zone = ?`).run(
              ref.world,
              ref.domain,
              ref.zone,
            );
            const ins = db.prepare(
              `INSERT INTO market_prices
               (world, domain, zone, item_id, min_price, median_price, qty_at_min, total_qty, listing_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            );
            for (const [itemId, p] of Object.entries(prices)) {
              ins.run(ref.world, ref.domain, ref.zone, itemId, p.min, p.median, p.qtyAtMin, p.totalQty, p.listings);
            }
            db.prepare(
              `INSERT INTO market_zone_fetches (world, domain, zone, fetched_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(world, domain, zone) DO UPDATE SET fetched_at = excluded.fetched_at`,
            ).run(ref.world, ref.domain, ref.zone, new Date(now()).toISOString());
          });
          write();
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

  // ---- Routes ------------------------------------------------------------------

  app.get("/status", (c) => c.json({ enabled: mode !== "off", mode }));

  // Everything below needs an upstream.
  app.use("*", async (c, next) => {
    if (c.req.path.endsWith("/status")) return next();
    if (!upstream) return c.json({ error: "market data is not enabled" }, 503);
    return next();
  });

  app.get("/zones", async (c) => {
    await ensureIndex();
    const worlds: ZoneTree["worlds"] = {};
    for (const z of listZones.all() as ZoneRow[]) {
      const domains = (worlds[z.world] ??= {});
      (domains[z.domain] ??= []).push(z.zone);
    }
    const fetchedAt = (getMeta.get(INDEX_META_KEY) as { value: string } | undefined)?.value ?? "";
    c.header("cache-control", HTTP_CACHE);
    return c.json({ fetchedAt, worlds } satisfies ZoneTree);
  });

  app.get("/prices/:world/:domain/:zone", async (c) => {
    await ensureIndex();
    const ref = findZone.get(
      c.req.param("world"),
      c.req.param("domain"),
      c.req.param("zone"),
    ) as ZoneRow | undefined;
    if (!ref) return c.json({ error: "unknown zone" }, 404);
    try {
      await ensureZone(ref);
    } catch (e) {
      return c.json({ error: `upstream fetch failed: ${e instanceof Error ? e.message : e}` }, 502);
    }
    c.header("cache-control", HTTP_CACHE);
    return c.json(readZonePrices(ref)!);
  });

  app.get("/world/:world", async (c) => {
    await ensureIndex();
    const world = c.req.param("world");
    const refs = zonesOfWorld.all(world) as ZoneRow[];
    if (refs.length === 0) return c.json({ error: "unknown world" }, 404);

    // Refresh stale zones a few at a time; a zone that has never been fetched
    // successfully is reported in `missing` rather than failing the request.
    const queue = [...refs];
    const workers = Array.from({ length: Math.min(WORLD_CONCURRENCY, queue.length) }, async () => {
      for (let ref = queue.shift(); ref; ref = queue.shift()) {
        await ensureZone(ref).catch(() => {});
      }
    });
    await Promise.all(workers);

    const zones: ZonePrices[] = [];
    const missing: WorldPrices["missing"] = [];
    for (const ref of refs) {
      const zp = readZonePrices(ref);
      if (zp) zones.push(zp);
      else missing.push({ domain: ref.domain, zone: ref.zone });
    }
    c.header("cache-control", HTTP_CACHE);
    return c.json({ world, zones, missing } satisfies WorldPrices);
  });

  return app;
}
