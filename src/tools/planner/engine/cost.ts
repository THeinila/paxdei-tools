/** Gold-cost annotation over the recipe graph: for every item, what does one
 * unit cost if you buy it outright vs. craft it from parts (each part itself
 * acquired the cheapest way)? Pure — same style as planner.ts — so it's unit
 * testable and shared by the planner's "cheaper to buy" hints, the Craft or
 * Buy explorer, and the profit dashboard.
 *
 * Accounting model ("all inputs purchasable"): a gatherable raw is valued at
 * its market min when listed — the gold you'd spend to skip gathering it — and
 * at 0 when unlisted, with `pricedFully: false` propagated so the UI can badge
 * costs that silently include free gathering. Craft costs honor the same
 * variant choice as the visible plan (pickVariant), so the numbers always
 * describe the plan on screen, not a hypothetical cheaper variant. */
import { pickVariant } from "./planner.ts";
import type { Dataset } from "./types.ts";

/** itemId -> unit market price (the zone's min listing). */
export type PriceMap = Record<string, { min: number }>;

export type Strategy = "buy" | "craft" | "gather";

export interface UnitCost {
  /** Unit market price, or null when the item has no listing in the zone. */
  buy: number | null;
  /** Unit cost to craft from parts (parts at their best cost), or null for
   * raws and recipe cycles. */
  craft: number | null;
  /** min(buy, craft); unlisted raws count 0 (gathering is free in gold). */
  best: number;
  /** Where `best` comes from. For a listed raw this is "buy" — its gold value
   * is the market price even if you'd gather it yourself. */
  strategy: Strategy;
  /** False when the best path contains an unpriced gatherable (or a recipe
   * cycle), i.e. `best` understates the real acquisition effort. */
  pricedFully: boolean;
  /** Same, but for the craft estimate specifically — `craft` counts unpriced
   * gatherables as free even when `strategy` is "buy". */
  craftPricedFully: boolean;
}

export function unitCosts(
  ds: Dataset,
  prices: PriceMap,
  pathChoices: Record<string, string> = {},
): Map<string, UnitCost> {
  const memo = new Map<string, UnitCost>();
  const visiting = new Set<string>();

  /** `cyclic` marks the transient sentinel returned for a cycle back-edge; a
   * recipe consuming one can't be crafted (it would recurse forever), so its
   * craft path is invalidated rather than priced at a misleading 0. Sentinels
   * are never memoized — the entry node still gets a proper cost from its
   * other consumers. */
  type Computed = UnitCost & { cyclic?: boolean };

  function compute(id: string): Computed {
    const hit = memo.get(id);
    if (hit) return hit;
    if (visiting.has(id)) {
      const cycleBuy = prices[id]?.min ?? null;
      return cycleBuy !== null
        ? { buy: cycleBuy, craft: null, best: cycleBuy, strategy: "buy", pricedFully: true, craftPricedFully: true }
        : { buy: null, craft: null, best: 0, strategy: "gather", pricedFully: false, craftPricedFully: false, cyclic: true };
    }

    const buy = prices[id]?.min ?? null;
    const variant = pickVariant(ds, id, pathChoices);

    let craft: number | null = null;
    let craftPriced = true;
    if (variant) {
      visiting.add(id);
      let sum = 0;
      let craftable = true;
      for (const ing of variant.ingredients) {
        const c = compute(ing.itemId);
        if (c.cyclic) craftable = false;
        sum += ing.count * c.best;
        craftPriced &&= c.pricedFully;
      }
      visiting.delete(id);
      if (craftable) craft = sum / variant.yield;
    }

    let out: UnitCost;
    if (buy !== null && (craft === null || buy < craft)) {
      out = { buy, craft, best: buy, strategy: "buy", pricedFully: true, craftPricedFully: craftPriced };
    } else if (craft !== null) {
      out = { buy, craft, best: craft, strategy: "craft", pricedFully: craftPriced, craftPricedFully: craftPriced };
    } else {
      // Unlisted raw (or an unlisted item whose only recipe is a cycle).
      out = { buy, craft, best: 0, strategy: "gather", pricedFully: false, craftPricedFully: false };
    }
    memo.set(id, out);
    return out;
  }

  for (const id of Object.keys(ds.items)) compute(id);
  return memo;
}
