/** Background market collector: keeps every zone's snapshot within the hourly
 * TTL so price/sales history accumulates continuously (the analysis features
 * are only as good as the history behind them). Each tick refreshes a batch
 * of due zones through the shared MarketService — same single-flight and TTL
 * as user requests, so the two never double-fetch. ~280 zones / hourly TTL
 * works out to a few dozen small CDN fetches per 5-minute tick.
 *
 * Also home to the fixtures-mode history seeder: the fixture upstream is
 * static, so dev/preview fabricates a deterministic 14-day history instead
 * (including the engineered anomaly / zero-sales / volatility cases the UI
 * walkthrough checks). */
import type { DB } from "./db.ts";
import type { MarketService } from "./market.ts";

const DEFAULT_BATCH = 30;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export interface MarketCollector {
  /** Refresh up to `batch` due zones; returns how many were due. */
  tick(): Promise<number>;
  start(): void;
  stop(): void;
}

export function createMarketCollector(
  svc: MarketService,
  opts: { batch?: number; intervalMs?: number } = {},
): MarketCollector {
  const batch = opts.batch ?? DEFAULT_BATCH;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<number> {
    await svc.ensureIndex();
    const due = svc.zonesDue(batch);
    // Small concurrency, same politeness as world requests.
    const queue = [...due];
    const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let ref = queue.shift(); ref; ref = queue.shift()) {
        await svc.ensureZone(ref).catch((e) => {
          console.warn(`market collector: ${ref.world}/${ref.domain}/${ref.zone}: ${e}`);
        });
      }
    });
    await Promise.all(workers);
    return due.length;
  }

  return {
    tick,
    start() {
      if (svc.mode === "off" || timer) return;
      void tick().catch((e) => console.warn(`market collector: initial tick failed: ${e}`));
      timer = setInterval(() => {
        void tick().catch((e) => console.warn(`market collector: tick failed: ${e}`));
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

// ---- Fixtures-mode history seeder ------------------------------------------------

/** Deterministic PRNG so the seeded history is stable across restarts. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Engineered cases exercised by tests and the preview walkthrough. Keyed
 * "domain/zone:itemId". `median` overrides the seeded 7-day price level
 * (creating anomalies vs. the current fixture price); `soldPerDay` overrides
 * liquidity; `volatile` makes daily mins swing hard. */
const SEED_OVERRIDES: Record<
  string,
  { median?: number; soldPerDay?: number; volatile?: boolean }
> = {
  // Current fixture min is 2 → far below its usual 5: buy-side anomaly.
  "ancien/libornes:item_material_ingot_iron": { median: 5, soldPerDay: 25 },
  // Current fixture min is 8 → far above its usual 4: sell-side anomaly.
  "merrie/yarborn:item_material_ingot_iron": { median: 4, soldPerDay: 30 },
  // Juicy margin but nothing ever sells: the illiquidity trap.
  "merrie/shire:item_material_ingot_wrought_iron": { soldPerDay: 0 },
  // Wildly swinging price.
  "ancien/libornes:activatable_foodraw_berry_grape_red_staminaregen_21": { volatile: true },
};

const SEED_DAYS = 14;
const SEED_HOURS = 48;

/** Fabricate history from the current fixture prices. Idempotent: no-op when
 * any daily history already exists. Fetches all fixture zones first so the
 * current rollups exist to seed from. */
export async function seedFixtureHistory(db: DB, svc: MarketService): Promise<void> {
  if (svc.mode !== "fixtures") return;
  const have = db.prepare(`SELECT COUNT(*) AS n FROM market_history_daily`).get() as { n: number };
  if (have.n > 0) return;

  await svc.ensureIndex();
  for (const ref of svc.allZones()) await svc.ensureZone(ref);

  const nowMs = svc.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const insDaily = db.prepare(
    `INSERT OR REPLACE INTO market_history_daily
     (world, domain, zone, item_id, day, min_min, median_min, snapshots, sold_qty, sold_value, expired_qty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insHourly = db.prepare(
    `INSERT OR REPLACE INTO market_history_hourly
     (world, domain, zone, item_id, snapshot_at, min_price, median_price, total_qty, listing_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const seed = db.transaction(() => {
    for (const ref of svc.allZones()) {
      const zp = svc.readZonePrices(ref);
      if (!zp) continue;
      for (const [itemId, p] of Object.entries(zp.prices)) {
        const ov = SEED_OVERRIDES[`${ref.domain}/${ref.zone}:${itemId}`] ?? {};
        const level = ov.median ?? p.min; // the item's "normal" price
        const soldPerDay = ov.soldPerDay ?? Math.max(1, Math.round(p.totalQty * 0.25));
        const rand = mulberry32(hash(`${ref.world}/${ref.domain}/${ref.zone}/${itemId}`));

        // Daily rows, oldest day first, skipping today (today accumulates live).
        for (let d = SEED_DAYS; d >= 1; d--) {
          const day = new Date(nowMs - d * dayMs).toISOString().slice(0, 10);
          const swing = ov.volatile ? 0.5 + 1.5 * (d % 2) : 0.9 + 0.2 * rand(); // volatile: 0.5 / 2.0
          const medianMin = level * swing;
          const qty = Math.round(soldPerDay * (0.7 + 0.6 * rand()));
          insDaily.run(
            ref.world, ref.domain, ref.zone, itemId, day,
            medianMin * 0.92, medianMin, 24,
            ov.soldPerDay === 0 ? 0 : qty, (ov.soldPerDay === 0 ? 0 : qty) * medianMin, 0,
          );
        }
        // Hourly points around the CURRENT price (so sparklines end where the
        // live table begins).
        for (let h = SEED_HOURS; h >= 1; h--) {
          const at = new Date(nowMs - h * 60 * 60 * 1000).toISOString();
          const jitter = 0.95 + 0.1 * rand();
          insHourly.run(
            ref.world, ref.domain, ref.zone, itemId, at,
            p.min * jitter, p.median * jitter, p.totalQty, p.listings,
          );
        }
      }
    }
  });
  seed();
  console.log("market: seeded fixture history (14 d daily, 48 h hourly)");
}
