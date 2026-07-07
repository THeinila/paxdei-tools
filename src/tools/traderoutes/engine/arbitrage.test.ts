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
