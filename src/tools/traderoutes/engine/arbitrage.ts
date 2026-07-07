/** Cross-zone arbitrage over one world's price rollups: for each item listed
 * in at least two zones, where is it cheapest to buy and dearest to sell, and
 * what's the spread worth per trip? Pure — the UI filters and sorts the
 * result. Sell prices are ceilings, not guarantees: the API exposes sell
 * listings only (no demand), so "sell" means undercutting the destination
 * zone's current cheapest listing. */
import type { WorldPrices } from "../../../../shared/marketTypes.ts";

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
  /** Gold per unit: sell.min − buy.min. Always > 0 (flat items are dropped). */
  spread: number;
  /** spread / buy.min (Infinity when items are listed for free at the source). */
  spreadPct: number;
  /** Spread × one trip's cargo: min(stack size, units buyable at ~min). Items
   * without a stack size use the buyable volume alone. */
  perStack: number;
  /** Every zone where the item is listed, cheapest first (for the detail view). */
  zones: ZoneQuote[];
}

export function computeRoutes(
  world: WorldPrices,
  stackSizes: Record<string, number | null | undefined>,
): Route[] {
  const byItem = new Map<string, ZoneQuote[]>();
  for (const zone of world.zones) {
    for (const [itemId, p] of Object.entries(zone.prices)) {
      const arr = byItem.get(itemId) ?? [];
      arr.push({ domain: zone.domain, zone: zone.zone, min: p.min, qtyAtMin: p.qtyAtMin });
      byItem.set(itemId, arr);
    }
  }

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
    routes.push({
      itemId,
      buy,
      sell,
      spread,
      spreadPct: buy.min > 0 ? spread / buy.min : Number.POSITIVE_INFINITY,
      perStack: spread * cargo,
      zones: quotes,
    });
  }
  routes.sort((a, b) => b.perStack - a.perStack);
  return routes;
}
