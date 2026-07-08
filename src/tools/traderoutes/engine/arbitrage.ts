/** Cross-zone arbitrage over one world's price rollups: for each item listed
 * in at least two zones, where is it cheapest to buy and dearest to sell, and
 * what's the spread worth per trip? Pure — the UI filters and sorts the
 * result. Sell prices are ceilings, not guarantees: the API exposes sell
 * listings only (no demand), so "sell" means undercutting the destination
 * zone's current cheapest listing.
 *
 * With history stats (WorldStats, self-accumulated server-side) the routes
 * also carry reality checks:
 *  - a robust sell price (7-day median reversion) so a momentarily-dear
 *    destination doesn't inflate the expected profit,
 *  - anomaly flags when the current buy/sell price is far from its 7-day norm,
 *  - a volatility flag, and
 *  - liquidity: estimated units sold/day at the destination, capping
 *    profit-per-day — a huge margin on something nobody buys is worth 0. */
import type { ItemStats, WorldPrices, WorldStats } from "../../../../shared/marketTypes.ts";

/** Current buy price this far below the 7-day median is treated as a likely
 * anomaly (a one-off cheap listing that may be gone within hours). */
export const BUY_ANOMALY_RATIO = 0.5;
/** Current sell reference this far above the 7-day median likewise. */
export const SELL_ANOMALY_RATIO = 1.5;
/** Coefficient of variation above which an item's price counts as volatile. */
export const VOLATILE_CV = 0.5;

export interface ZoneQuote {
  domain: string;
  zone: string;
  /** Cheapest unit price in the zone. */
  min: number;
  /** Units available within ~10% of that price. */
  qtyAtMin: number;
}

export interface Route {
  itemId: string;
  buy: ZoneQuote;
  sell: ZoneQuote;
  /** Gold per unit at CURRENT prices: sell.min − buy.min. Always > 0. */
  spread: number;
  /** spread / buy.min (Infinity when items are listed for free at the source). */
  spreadPct: number;
  /** Spread × one trip's cargo: min(stack size, units buyable at ~min). Items
   * without a stack size use the buyable volume alone. */
  perStack: number;
  /** Every zone where the item is listed, cheapest first (for the detail view). */
  zones: ZoneQuote[];

  // ---- History-based reality checks (null/false without stats) ----
  /** Sell price after 7-day median reversion: min(sell.min, dest median). */
  sellEff: number;
  /** sellEff − buy.min — the spread you can plausibly sustain. */
  spreadEff: number;
  /** Estimated units sold per day at the destination (null: no history). */
  soldPerDay: number | null;
  /** ISO day of the destination's last estimated sale (null: none observed). */
  lastSaleAt: string | null;
  /** spreadEff × min(cargo, soldPerDay) — gold/day the market can absorb
   * (null without sales history; can be ≤ 0 when the spread was a mirage). */
  profitPerDay: number | null;
  /** Source price is far below its 7-day norm — may vanish before the trip. */
  buyAnomaly: boolean;
  /** Destination price is far above its 7-day norm — expect reversion. */
  sellAnomaly: boolean;
  /** Either end's price swings hard day-to-day (cv7d > VOLATILE_CV). */
  volatile: boolean;
  /** No history rows for this item at either end yet. */
  noHistory: boolean;
}

export function computeRoutes(
  world: WorldPrices,
  stackSizes: Record<string, number | null | undefined>,
  stats?: WorldStats | null,
): Route[] {
  const byItem = new Map<string, ZoneQuote[]>();
  for (const zone of world.zones) {
    for (const [itemId, p] of Object.entries(zone.prices)) {
      const arr = byItem.get(itemId) ?? [];
      arr.push({ domain: zone.domain, zone: zone.zone, min: p.min, qtyAtMin: p.qtyAtMin });
      byItem.set(itemId, arr);
    }
  }

  const statFor = (q: ZoneQuote, itemId: string): ItemStats | undefined =>
    stats?.stats[`${q.domain}/${q.zone}`]?.[itemId];

  const routes: Route[] = [];
  for (const [itemId, quotes] of byItem) {
    if (quotes.length < 2) continue;
    quotes.sort((a, b) => a.min - b.min);
    const buy = quotes[0]!;
    const sell = quotes[quotes.length - 1]!;
    const spread = sell.min - buy.min;
    if (spread <= 0) continue;
    const stack = stackSizes[itemId] ?? null;
    const cargo = stack !== null && stack !== undefined ? Math.min(stack, buy.qtyAtMin) : buy.qtyAtMin;

    const buyStats = statFor(buy, itemId);
    const sellStats = statFor(sell, itemId);
    const sellEff = Math.min(sell.min, sellStats?.medianMin7d ?? sell.min);
    const spreadEff = sellEff - buy.min;
    const soldPerDay = sellStats ? sellStats.soldPerDay : null;
    const profitPerDay = soldPerDay !== null ? spreadEff * Math.min(cargo, soldPerDay) : null;

    routes.push({
      itemId,
      buy,
      sell,
      spread,
      spreadPct: buy.min > 0 ? spread / buy.min : Number.POSITIVE_INFINITY,
      perStack: spread * cargo,
      zones: quotes,
      sellEff,
      spreadEff,
      soldPerDay,
      lastSaleAt: sellStats?.lastSaleAt ?? null,
      profitPerDay,
      buyAnomaly:
        buyStats?.medianMin7d != null && buy.min < BUY_ANOMALY_RATIO * buyStats.medianMin7d,
      sellAnomaly:
        sellStats?.medianMin7d != null && sell.min > SELL_ANOMALY_RATIO * sellStats.medianMin7d,
      volatile: Math.max(buyStats?.cv7d ?? 0, sellStats?.cv7d ?? 0) > VOLATILE_CV,
      noHistory: !buyStats && !sellStats,
    });
  }
  // Realistic gold/day first; routes without sales history sort below any
  // history-backed route, among themselves by per-trip profit.
  routes.sort((a, b) => {
    if (a.profitPerDay !== null && b.profitPerDay !== null) return b.profitPerDay - a.profitPerDay;
    if (a.profitPerDay !== null) return -1;
    if (b.profitPerDay !== null) return 1;
    return b.perStack - a.perStack;
  });
  return routes;
}
