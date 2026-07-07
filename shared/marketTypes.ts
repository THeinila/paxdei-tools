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
