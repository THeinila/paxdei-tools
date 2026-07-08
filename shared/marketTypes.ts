/** Wire types for the market API (/api/market/*), used by both the client
 * fetch wrappers (src/market/client.ts) and the server routes (server/market.ts).
 *
 * All prices are UNIT prices in gold (floats — a 100-stack listed for 2g rolls
 * up to 0.02/unit). The server stores per-item rollups per zone, never raw
 * listings; data originates from the gaming.tools public market API which
 * refreshes hourly. */

export type MarketMode = "off" | "fixtures" | "live";

export interface MarketStatus {
  /** False when MARKET_UPSTREAM=off — clients hide all market UI. */
  enabled: boolean;
  mode: MarketMode;
}

/** Per-item price summary within one zone. */
export interface PriceRollup {
  /** Lowest unit price on the market. */
  min: number;
  /** Median unit price across listings (unweighted). */
  median: number;
  /** Units available at ~the min price (listings within 10% of min). */
  qtyAtMin: number;
  /** Units available across all listings. */
  totalQty: number;
  /** Number of listings. */
  listings: number;
}

export interface ZonePrices {
  world: string;
  domain: string;
  zone: string;
  /** ISO timestamp of the server's last successful upstream fetch. */
  fetchedAt: string;
  /** True when the last refresh attempt failed and this snapshot is older than
   * the refresh interval — show a "data may be outdated" badge. */
  stale: boolean;
  prices: Record<string, PriceRollup>;
  /** Trailing 7-day stats per item, when the server has accumulated history.
   * Items with no history are simply absent. */
  stats?: Record<string, ItemStats>;
}

/** Trailing 7-day per-item statistics for one zone, from self-accumulated
 * history (the upstream has no history/demand endpoints). Sales are inferred
 * from listings that vanished before expiring — estimates, not ground truth. */
export interface ItemStats {
  /** Median of the daily median-min price — the "normal" price. */
  medianMin7d: number | null;
  /** Coefficient of variation (stddev/mean) of daily min prices — volatility. */
  cv7d: number | null;
  /** Estimated units sold per observed day. 0 means "watched, nothing sold". */
  soldPerDay: number;
  /** ISO day (YYYY-MM-DD) of the most recent estimated sale, or null. */
  lastSaleAt: string | null;
  /** Days with at least one snapshot in the window; 0 rows → item absent. */
  daysObserved: number;
}

/** Stats for every zone of one world (joined with WorldPrices by the UI). */
export interface WorldStats {
  world: string;
  /** First day (YYYY-MM-DD) of the trailing window. */
  sinceDay: string;
  /** Keyed "domain/zone" → itemId → stats. */
  stats: Record<string, Record<string, ItemStats>>;
}

/** Price/sales history for one item in one zone (the sparkline payload). */
export interface ItemHistory {
  world: string;
  domain: string;
  zone: string;
  itemId: string;
  /** Hourly snapshots, oldest first, last ~72 h. */
  hourly: { at: string; min: number; median: number }[];
  /** Daily aggregates, oldest first, last ~60 d. */
  daily: { day: string; minMin: number; medianMin: number; soldQty: number }[];
}

/** The world → domain → zone hierarchy, from the upstream index. */
export interface ZoneTree {
  fetchedAt: string;
  worlds: Record<string, Record<string, string[]>>;
}

/** Rollups for every zone of one world (the arbitrage input). */
export interface WorldPrices {
  world: string;
  zones: ZonePrices[];
  /** Zones listed in the index that have never been fetched successfully. */
  missing: { domain: string; zone: string }[];
}
