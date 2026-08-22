/** Shared fixture builders for the engine's unit tests.
 *
 * A plain module (not a `*.test.ts`) so several test files can import the same
 * graph without re-executing another file's `describe`s. Nothing in the app
 * imports it, so it never reaches the bundle. */
import type { Dataset, Item, RecipeVariant } from "./types.ts";

export function item(id: string, isRaw: boolean, maxStackSize: number | null = null): Item {
  return {
    id,
    name: id,
    iconPath: null,
    mainCategoryId: null,
    categories: [],
    tier: null,
    rarity: null,
    maxStackSize,
    isRaw,
  };
}

export function variant(
  recipeId: string,
  yld: number,
  ingredients: { itemId: string; count: number }[],
  profession = "Test",
): RecipeVariant {
  return { recipeId, yield: yld, ingredients, profession, professionId: "skill_test" };
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
export function fixture(): Dataset {
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
