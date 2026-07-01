import { describe, expect, it } from "vitest";
import { plan } from "./planner.ts";
import type { Dataset, Item, RecipeVariant } from "./types.ts";

// --- Fixture builder ---------------------------------------------------------

function item(id: string, isRaw: boolean): Item {
  return {
    id,
    name: id,
    iconPath: null,
    mainCategoryId: null,
    categories: [],
    tier: null,
    maxStackSize: null,
    isRaw,
  };
}

function variant(
  recipeId: string,
  yld: number,
  ingredients: { itemId: string; count: number }[],
): RecipeVariant {
  return { recipeId, yield: yld, ingredients, profession: "Test", professionId: "skill_test" };
}

/**
 * Graph:
 *   wood (raw), iron_ore (raw), sapwood (raw), heartwood (raw)
 *   plank   <- wood x2            (yield 1)
 *   nail    <- iron_ore x1        (yield 5)
 *   table   <- plank x4, nail x10 (yield 1)
 *   chair   <- plank x2, nail x4  (yield 1)
 *   charcoal: A <- sapwood x50 (yield 50) | B <- heartwood x100 (yield 100)
 *   cyc_a <- cyc_b x1 ; cyc_b <- cyc_a x1   (cycle)
 */
function fixture(): Dataset {
  const items: Record<string, Item> = {};
  for (const id of ["wood", "iron_ore", "sapwood", "heartwood"]) items[id] = item(id, true);
  for (const id of ["plank", "nail", "table", "chair", "charcoal", "cyc_a", "cyc_b"])
    items[id] = item(id, false);

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
      chair: {
        outputItemId: "chair",
        variants: [
          variant("r_chair", 1, [
            { itemId: "plank", count: 2 },
            { itemId: "nail", count: 4 },
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

// Maps cover only the still-needed steps; satisfied (fully-owned) rows are kept
// in the plan but greyed in the UI, so they're excluded here for clarity.
const gatherMap = (p: ReturnType<typeof plan>) =>
  Object.fromEntries(p.gather.filter((g) => !g.satisfied).map((g) => [g.itemId, g.needed]));
const craftMap = (p: ReturnType<typeof plan>) =>
  Object.fromEntries(
    p.crafts.filter((c) => !c.satisfied).map((c) => [c.itemId, { needed: c.needed, crafts: c.crafts }]),
  );
const satisfiedIds = (p: ReturnType<typeof plan>) => [
  ...p.gather.filter((g) => g.satisfied).map((g) => g.itemId),
  ...p.crafts.filter((c) => c.satisfied).map((c) => c.itemId),
];

// --- Tests -------------------------------------------------------------------

describe("plan", () => {
  it("treats a raw target as a pure gather", () => {
    const p = plan(fixture(), [{ itemId: "wood", quantity: 5 }]);
    expect(p.crafts).toHaveLength(0);
    expect(gatherMap(p)).toEqual({ wood: 5 });
  });

  it("expands a single craft and its raw inputs", () => {
    const p = plan(fixture(), [{ itemId: "plank", quantity: 3 }]);
    expect(craftMap(p)).toEqual({ plank: { needed: 3, crafts: 3 } });
    expect(gatherMap(p)).toEqual({ wood: 6 });
  });

  it("rounds craft batches up by yield (nail yields 5)", () => {
    const p = plan(fixture(), [{ itemId: "nail", quantity: 7 }]);
    // need 7 -> ceil(7/5) = 2 batches -> produced 10 -> iron_ore 2
    expect(craftMap(p).nail).toEqual({ needed: 7, crafts: 2 });
    expect(gatherMap(p)).toEqual({ iron_ore: 2 });
  });

  it("flattens a multi-level chain with dependency-first ordering", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }]);
    expect(gatherMap(p)).toEqual({ wood: 8, iron_ore: 2 }); // plank x4 -> wood 8; nail 10 -> 2 batches -> ore 2
    // table must come after plank and nail
    const ids = p.crafts.map((c) => c.itemId);
    expect(ids.indexOf("table")).toBeGreaterThan(ids.indexOf("plank"));
    expect(ids.indexOf("table")).toBeGreaterThan(ids.indexOf("nail"));
  });

  it("aggregates a shared intermediate across two targets", () => {
    const p = plan(fixture(), [
      { itemId: "table", quantity: 1 },
      { itemId: "chair", quantity: 1 },
    ]);
    // plank: 4 + 2 = 6 -> wood 12 ; nail: 10 + 4 = 14 -> ceil(14/5)=3 batches -> ore 3
    expect(craftMap(p).plank).toEqual({ needed: 6, crafts: 6 });
    expect(craftMap(p).nail).toEqual({ needed: 14, crafts: 3 });
    expect(gatherMap(p)).toEqual({ wood: 12, iron_ore: 3 });
  });

  it("keeps a fully-owned raw leaf as a satisfied (greyed) row", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned: { wood: 8 } });
    expect(gatherMap(p)).toEqual({ iron_ore: 2 }); // wood no longer counts as to-gather
    expect(satisfiedIds(p)).toContain("wood"); // but the row is retained, greyed
    expect(craftMap(p).plank).toEqual({ needed: 4, crafts: 4 }); // still must craft planks
  });

  it("keeps a fully-owned intermediate and its whole sub-tree as satisfied", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned: { plank: 4 } });
    expect(craftMap(p).plank).toBeUndefined(); // no active plank craft
    expect(satisfiedIds(p)).toContain("plank"); // kept as a greyed row
    // The plank's inputs stay as greyed rows too (not deleted), showing the
    // quantity you'd have needed had you not already had the plank.
    expect(gatherMap(p).wood).toBeUndefined(); // not an active gather
    expect(satisfiedIds(p)).toContain("wood");
    expect(p.gather.find((g) => g.itemId === "wood")).toMatchObject({ needed: 8, satisfied: true });
    expect(gatherMap(p)).toEqual({ iron_ore: 2 }); // nails still needed
  });

  it("partially owned intermediate reduces but does not eliminate the branch", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned: { plank: 1 } });
    expect(craftMap(p).plank).toEqual({ needed: 3, crafts: 3 }); // 4 - 1 owned
    expect(gatherMap(p).wood).toBe(6);
  });

  it("uses the default (first) variant for an alternative-path item", () => {
    const p = plan(fixture(), [{ itemId: "charcoal", quantity: 100 }]);
    expect(gatherMap(p)).toEqual({ sapwood: 100 });
    expect(p.choices).toEqual([
      { itemId: "charcoal", chosen: "r_charcoal_sapwood", available: ["r_charcoal_sapwood", "r_charcoal_heartwood"] },
    ]);
  });

  it("honours an explicit alternative-path choice", () => {
    const p = plan(fixture(), [{ itemId: "charcoal", quantity: 100 }], {
      pathChoices: { charcoal: "r_charcoal_heartwood" },
    });
    expect(gatherMap(p)).toEqual({ heartwood: 100 });
  });

  it("assigns tiers by depth (target = 0, ingredients deeper)", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }]);
    const tier = Object.fromEntries(p.crafts.map((c) => [c.itemId, c.tier]));
    expect(tier).toEqual({ table: 0, plank: 1, nail: 1 });
  });

  it("places a component used at several depths in its deepest tier only", () => {
    // deluxe <- table x1 + plank x2 ; table <- plank x4 + nail x10
    const ds = fixture();
    ds.items.deluxe = item("deluxe", false);
    ds.recipes.deluxe = {
      outputItemId: "deluxe",
      variants: [
        variant("r_deluxe", 1, [
          { itemId: "table", count: 1 },
          { itemId: "plank", count: 2 },
        ]),
      ],
    };
    const p = plan(ds, [{ itemId: "deluxe", quantity: 1 }]);
    const plankSteps = p.crafts.filter((c) => c.itemId === "plank");
    expect(plankSteps).toHaveLength(1); // appears once, not per consumer
    // deluxe(0) -> table(1) -> plank(2): the deeper path wins over deluxe -> plank(1)
    expect(plankSteps[0]!.tier).toBe(2);
  });

  it("guards against recipe cycles without hanging", () => {
    const p = plan(fixture(), [{ itemId: "cyc_a", quantity: 1 }]);
    expect(p.warnings.some((w) => /cycle/i.test(w))).toBe(true);
  });
});
