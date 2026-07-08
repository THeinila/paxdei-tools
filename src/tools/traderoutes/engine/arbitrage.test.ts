import { describe, expect, it } from "vitest";
import { computeRoutes } from "./arbitrage.ts";
import type { WorldPrices, ZonePrices } from "../../../../shared/marketTypes.ts";

function zone(domain: string, z: string, prices: ZonePrices["prices"]): ZonePrices {
  return { world: "w", domain, zone: z, fetchedAt: "2026-07-07T00:00:00Z", stale: false, prices };
}

function world(zones: ZonePrices[]): WorldPrices {
  return { world: "w", zones, missing: [] };
}

const rollup = (min: number, qtyAtMin: number) => ({
  min,
  median: min,
  qtyAtMin,
  totalQty: qtyAtMin,
  listings: 1,
});

describe("computeRoutes", () => {
  it("finds the cheapest and dearest zones and prices the spread", () => {
    const routes = computeRoutes(
      world([
        zone("merrie", "shire", { ingot: rollup(3, 120) }),
        zone("merrie", "yarborn", { ingot: rollup(8, 20) }),
        zone("ancien", "libornes", { ingot: rollup(2, 40) }),
      ]),
      { ingot: 100 },
    );
    expect(routes).toHaveLength(1);
    const r = routes[0]!;
    expect(r.buy).toEqual({ domain: "ancien", zone: "libornes", min: 2, qtyAtMin: 40 });
    expect(r.sell).toEqual({ domain: "merrie", zone: "yarborn", min: 8, qtyAtMin: 20 });
    expect(r.spread).toBe(6);
    expect(r.spreadPct).toBe(3);
    // cargo = min(stack 100, 40 buyable) = 40 units × 6g
    expect(r.perStack).toBe(240);
    expect(r.zones.map((z) => z.zone)).toEqual(["libornes", "shire", "yarborn"]);
  });

  it("drops items listed in one zone or with no spread", () => {
    const routes = computeRoutes(
      world([
        zone("merrie", "shire", { lonely: rollup(5, 10), flat: rollup(4, 10) }),
        zone("merrie", "yarborn", { flat: rollup(4, 10) }),
      ]),
      {},
    );
    expect(routes).toEqual([]);
  });

  it("caps cargo at the stack size and sorts by per-trip profit", () => {
    const routes = computeRoutes(
      world([
        zone("m", "a", { bulky: rollup(1, 500), gem: rollup(10, 5) }),
        zone("m", "b", { bulky: rollup(2, 1), gem: rollup(100, 1) }),
      ]),
      { bulky: 50, gem: 10 },
    );
    // bulky: spread 1 × min(50, 500) = 50 · gem: spread 90 × min(10, 5) = 450
    expect(routes.map((r) => r.itemId)).toEqual(["gem", "bulky"]);
    expect(routes[0]!.perStack).toBe(450);
    expect(routes[1]!.perStack).toBe(50);
  });
});

// ---- History-based reality checks --------------------------------------------------

import type { ItemStats, WorldStats } from "../../../../shared/marketTypes.ts";

function stats(entries: Record<string, Record<string, Partial<ItemStats>>>): WorldStats {
  const full: WorldStats["stats"] = {};
  for (const [zk, items] of Object.entries(entries)) {
    full[zk] = {};
    for (const [itemId, s] of Object.entries(items)) {
      full[zk][itemId] = {
        medianMin7d: null,
        cv7d: null,
        soldPerDay: 0,
        lastSaleAt: null,
        daysObserved: 7,
        ...s,
      };
    }
  }
  return { world: "w", sinceDay: "2026-07-01", stats: full };
}

describe("computeRoutes with history stats", () => {
  const twoZones = () =>
    world([
      zone("m", "src", { ingot: rollup(2, 40) }),
      zone("m", "dst", { ingot: rollup(8, 20) }),
    ]);

  it("reverts an anomalous sell price to the 7-day median", () => {
    const r = computeRoutes(twoZones(), { ingot: 100 }, stats({
      "m/src": { ingot: { medianMin7d: 2.1 } },
      "m/dst": { ingot: { medianMin7d: 4, soldPerDay: 30 } },
    }))[0]!;
    expect(r.sellAnomaly).toBe(true); // 8 > 1.5 × 4
    expect(r.sellEff).toBe(4);
    expect(r.spreadEff).toBe(2); // 4 − 2, not 6
    expect(r.spread).toBe(6); // raw spread untouched
    // profit/day = spreadEff × min(cargo 40, sold 30)
    expect(r.profitPerDay).toBe(60);
  });

  it("flags an anomalously cheap buy price", () => {
    const r = computeRoutes(twoZones(), {}, stats({
      "m/src": { ingot: { medianMin7d: 5 } }, // current 2 < 0.5 × 5
      "m/dst": { ingot: { medianMin7d: 7.9 } },
    }))[0]!;
    expect(r.buyAnomaly).toBe(true);
    expect(r.sellAnomaly).toBe(false);
  });

  it("caps profit per day by the destination's sales rate", () => {
    const r = computeRoutes(twoZones(), { ingot: 100 }, stats({
      "m/dst": { ingot: { medianMin7d: 8, soldPerDay: 5 } },
    }))[0]!;
    expect(r.profitPerDay).toBe(30); // 6 × min(40, 5)
  });

  it("zero sales → zero profit per day, however juicy the spread", () => {
    const r = computeRoutes(twoZones(), {}, stats({
      "m/dst": { ingot: { medianMin7d: 8, soldPerDay: 0 } },
    }))[0]!;
    expect(r.profitPerDay).toBe(0);
    expect(r.spread).toBe(6);
  });

  it("flags volatility from either end", () => {
    const r = computeRoutes(twoZones(), {}, stats({
      "m/src": { ingot: { cv7d: 0.8 } },
    }))[0]!;
    expect(r.volatile).toBe(true);
  });

  it("behaves exactly as before without stats and flags noHistory", () => {
    const bare = computeRoutes(twoZones(), { ingot: 100 })[0]!;
    expect(bare.noHistory).toBe(true);
    expect(bare.sellEff).toBe(8);
    expect(bare.spreadEff).toBe(6);
    expect(bare.profitPerDay).toBeNull();
    expect(bare.buyAnomaly).toBe(false);
    expect(bare.volatile).toBe(false);
  });

  it("sorts history-backed routes by profit/day above no-history routes", () => {
    const w = world([
      zone("m", "a", { liquid: rollup(1, 100), mystery: rollup(1, 100) }),
      zone("m", "b", { liquid: rollup(2, 10), mystery: rollup(50, 10) }),
    ]);
    const routes = computeRoutes(w, {}, stats({
      "m/b": { liquid: { medianMin7d: 2, soldPerDay: 50 } },
    }));
    // mystery has a monster raw spread but no history; liquid has real sales.
    expect(routes.map((r) => r.itemId)).toEqual(["liquid", "mystery"]);
  });
});
