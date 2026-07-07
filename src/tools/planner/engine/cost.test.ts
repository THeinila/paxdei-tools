import { describe, expect, it } from "vitest";
import { unitCosts } from "./cost.ts";
import type { Dataset, Item, RecipeVariant } from "./types.ts";

// Same fixture graph as planner.test.ts:
//   plank <- wood x2 (y1) · nail <- iron_ore x1 (y5) · table <- plank x4, nail x10 (y1)
//   charcoal: A <- sapwood x50 (y50) | B <- heartwood x100 (y100)
//   cyc_a <-> cyc_b (cycle)

function item(id: string, isRaw: boolean): Item {
  return { id, name: id, iconPath: null, mainCategoryId: null, categories: [], tier: null, maxStackSize: null, isRaw };
}

function variant(recipeId: string, yld: number, ingredients: { itemId: string; count: number }[]): RecipeVariant {
  return { recipeId, yield: yld, ingredients, profession: "Test", professionId: "skill_test" };
}

function fixture(): Dataset {
  const items: Record<string, Item> = {};
  for (const id of ["wood", "iron_ore", "sapwood", "heartwood"]) items[id] = item(id, true);
  for (const id of ["plank", "nail", "table", "charcoal", "cyc_a", "cyc_b"]) items[id] = item(id, false);
  return {
    items,
    recipes: {
      plank: { outputItemId: "plank", variants: [variant("r_plank", 1, [{ itemId: "wood", count: 2 }])] },
      nail: { outputItemId: "nail", variants: [variant("r_nail", 5, [{ itemId: "iron_ore", count: 1 }])] },
      table: {
        outputItemId: "table",
        variants: [
          variant("r_table", 1, [
            { itemId: "plank", count: 4 },
            { itemId: "nail", count: 10 },
          ]),
        ],
      },
      charcoal: {
        outputItemId: "charcoal",
        variants: [
          variant("r_charcoal_sapwood", 50, [{ itemId: "sapwood", count: 50 }]),
          variant("r_charcoal_heartwood", 100, [{ itemId: "heartwood", count: 100 }]),
        ],
      },
      cyc_a: { outputItemId: "cyc_a", variants: [variant("r_a", 1, [{ itemId: "cyc_b", count: 1 }])] },
      cyc_b: { outputItemId: "cyc_b", variants: [variant("r_b", 1, [{ itemId: "cyc_a", count: 1 }])] },
    },
    meta: { generatedAt: "", source: "fixture", recipeCount: 0, itemCount: 0 },
  };
}

describe("unitCosts", () => {
  it("recommends crafting when parts are cheaper than the listing", () => {
    // plank listed at 5, but wood is 1 → craft cost 2.
    const costs = unitCosts(fixture(), { wood: { min: 1 }, plank: { min: 5 } });
    const plank = costs.get("plank")!;
    expect(plank).toEqual({ buy: 5, craft: 2, best: 2, strategy: "craft", pricedFully: true, craftPricedFully: true });
  });

  it("recommends buying when the listing beats the parts", () => {
    // wood is 10 → craft cost 20; plank listed at 5.
    const costs = unitCosts(fixture(), { wood: { min: 10 }, plank: { min: 5 } });
    const plank = costs.get("plank")!;
    expect(plank).toEqual({ buy: 5, craft: 20, best: 5, strategy: "buy", pricedFully: true, craftPricedFully: true });
  });

  it("divides craft cost by recipe yield", () => {
    // nail: 1 iron_ore (2g) yields 5 → 0.4/unit.
    const costs = unitCosts(fixture(), { iron_ore: { min: 2 } });
    expect(costs.get("nail")!.craft).toBeCloseTo(0.4);
  });

  it("uses the cheapest acquisition of each part, recursively", () => {
    // table = 4 plank + 10 nail. plank: craft 2 (wood 1) < buy 5 → 2.
    // nail: buy 0.3 < craft 0.4 (ore 2) → 0.3. table craft = 8 + 3 = 11.
    const costs = unitCosts(fixture(), {
      wood: { min: 1 },
      plank: { min: 5 },
      iron_ore: { min: 2 },
      nail: { min: 0.3 },
      table: { min: 20 },
    });
    const table = costs.get("table")!;
    expect(table.craft).toBeCloseTo(11);
    expect(table.strategy).toBe("craft");
    expect(table.pricedFully).toBe(true);
  });

  it("values unlisted gatherables at 0 and flags the cost as partial", () => {
    const costs = unitCosts(fixture(), {}); // nothing listed anywhere
    expect(costs.get("wood")!).toEqual({
      buy: null,
      craft: null,
      best: 0,
      strategy: "gather",
      pricedFully: false,
      craftPricedFully: false,
    });
    const table = costs.get("table")!;
    expect(table.best).toBe(0);
    expect(table.strategy).toBe("craft");
    expect(table.pricedFully).toBe(false);
  });

  it("honors the plan's variant choice instead of a cheaper alternative", () => {
    // Default variant is sapwood (expensive); the heartwood variant would be
    // cheaper but isn't chosen — costs must match the visible plan.
    const prices = { sapwood: { min: 2 }, heartwood: { min: 0.5 } };
    const dflt = unitCosts(fixture(), prices).get("charcoal")!;
    expect(dflt.craft).toBeCloseTo(2); // 50×2 / 50
    const chosen = unitCosts(fixture(), prices, { charcoal: "r_charcoal_heartwood" }).get("charcoal")!;
    expect(chosen.craft).toBeCloseTo(0.5); // 100×0.5 / 100
  });

  it("survives recipe cycles, buying its way out when a listing exists", () => {
    const unpriced = unitCosts(fixture(), {});
    expect(unpriced.get("cyc_a")!.best).toBe(0);
    expect(unpriced.get("cyc_a")!.pricedFully).toBe(false);

    const priced = unitCosts(fixture(), { cyc_b: { min: 3 } });
    // cyc_a crafts from cyc_b, which is buyable for 3 → craft cost 3.
    const a = priced.get("cyc_a")!;
    expect(a.craft).toBe(3);
    expect(a.pricedFully).toBe(true);
  });

  it("treats a listed raw's gold value as its market price", () => {
    const costs = unitCosts(fixture(), { wood: { min: 1.5 } });
    expect(costs.get("wood")!).toEqual({
      buy: 1.5,
      craft: null,
      best: 1.5,
      strategy: "buy",
      pricedFully: true,
      craftPricedFully: true,
    });
  });
});
