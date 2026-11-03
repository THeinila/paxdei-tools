/** The dataset normalisation rules (scripts/README.md), on small hand-made raw
 * recipes. Pure: no network, and the only file access is DAT-9's temp folder. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDataset, loadRaw, type RawEntity, type RawRecipe } from "./datasetRules.ts";

const e = (id: string, extra: Partial<RawEntity> = {}): RawEntity => ({ id, name: id.toUpperCase(), ...extra });
function recipe(
  id: string,
  out: RawEntity | undefined,
  ings: [RawEntity | undefined, number | undefined][],
  opts: { count?: number; skill?: { id?: string; name?: string } } = {},
): RawRecipe {
  return {
    id,
    skillRequired: opts.skill,
    outputs: out ? [{ entity: out, count: opts.count }] : [],
    itemIngredients: ings.map(([entity, count]) => ({ entity, count })),
  };
}
const build = (raw: RawRecipe[], market: Record<string, unknown> = {}) => buildDataset(raw, market, "2026-01-01T00:00:00.000Z");

describe("dataset rules", () => {
  it("DAT-1: a recipe becomes a variant of its output with yield, ingredients and profession", () => {
    const { dataset } = build([
      recipe("r_plank", e("plank"), [[e("wood"), 2]], { count: 3, skill: { id: "s_carp", name: "Carpentry" } }),
      recipe("r_nail", e("nail"), [[e("ore"), 1]]), // no count, no skill
    ]);
    expect(dataset.recipes.plank).toEqual({
      outputItemId: "plank",
      variants: [
        { recipeId: "r_plank", yield: 3, ingredients: [{ itemId: "wood", count: 2 }], profession: "Carpentry", professionId: "s_carp" },
      ],
    });
    expect(dataset.recipes.nail!.variants[0]).toMatchObject({ yield: 1, profession: null, professionId: null });
  });

  it("DAT-1: skips recipes without an output, ingredients without an ID or count, and recipes left empty", () => {
    const { dataset } = build([
      recipe("r_no_output", undefined, [[e("wood"), 1]]),
      recipe("r_partial", e("chair"), [[e("wood"), 2], [undefined, 1], [e("glue"), 0]]),
      recipe("r_empty", e("ghost"), [[e("glue"), 0], [undefined, 3]]),
    ]);
    expect(dataset.recipes.chair!.variants[0]!.ingredients).toEqual([{ itemId: "wood", count: 2 }]);
    expect(dataset.recipes.ghost).toBeUndefined();
    expect(dataset.items.ghost).toBeUndefined();
    expect(Object.keys(dataset.recipes)).toEqual(["chair"]);
  });

  it("DAT-2: forced-raw items keep no recipe, stay raw, and are listed", () => {
    const hide = "item_raw_material_medium_animal_hide";
    const { dataset, forcedRaw } = build([recipe("r_hide", e(hide), [[e("item_raw_material_small_animal_hide"), 2]])]);
    expect(dataset.recipes[hide]).toBeUndefined();
    expect(dataset.items[hide]!.isRaw).toBe(true);
    expect(forcedRaw).toEqual([hide]);
  });

  it("DAT-3: drops a refinement recipe when a recipe from a base material survives", () => {
    const { dataset, droppedRefinements } = build([
      recipe("r_refine", e("linen_cloth_fine"), [[e("linen_cloth"), 2]]),
      recipe("r_base", e("linen_cloth_fine"), [[e("linen_string"), 4]]),
      recipe("r_numbered", e("ingot_2"), [[e("ingot"), 2]]), // trailing digits share the stem
      recipe("r_numbered_base", e("ingot_2"), [[e("ore"), 3]]),
    ]);
    expect(dataset.recipes.linen_cloth_fine!.variants.map((v) => v.recipeId)).toEqual(["r_base"]);
    expect(dataset.recipes.ingot_2!.variants.map((v) => v.recipeId)).toEqual(["r_numbered_base"]);
    expect(droppedRefinements).toEqual(["linen_cloth_fine <- linen_cloth", "ingot_2 <- ingot"]);
  });

  it("DAT-3: keeps refinement recipes when they are the only ones", () => {
    const { dataset, droppedRefinements } = build([
      recipe("r_a", e("salt_pure"), [[e("salt"), 2]]),
      recipe("r_b", e("salt_pure"), [[e("salt_raw"), 3]]),
    ]);
    expect(dataset.recipes.salt_pure!.variants.map((v) => v.recipeId)).toEqual(["r_a", "r_b"]);
    expect(droppedRefinements).toEqual([]);
  });

  it("DAT-4: keeps only the highest yield per ingredient set, and the first on a tie", () => {
    const { dataset } = build([
      recipe("r_hand", e("rope"), [[e("fibre"), 2], [e("tar"), 1]], { count: 1 }),
      recipe("r_station", e("rope"), [[e("tar"), 3], [e("fibre"), 5]], { count: 4 }), // same set, other order and counts
      recipe("r_tie_a", e("pole"), [[e("wood"), 1]], { count: 2 }),
      recipe("r_tie_b", e("pole"), [[e("wood"), 1]], { count: 2 }),
    ]);
    expect(dataset.recipes.rope!.variants.map((v) => v.recipeId)).toEqual(["r_station"]);
    expect(dataset.recipes.pole!.variants.map((v) => v.recipeId)).toEqual(["r_tie_a"]);
  });

  it("DAT-5: different ingredient sets all survive, in upstream order", () => {
    const { dataset } = build([
      recipe("r_sap", e("charcoal"), [[e("sapwood"), 50]], { count: 50 }),
      recipe("r_heart", e("charcoal"), [[e("heartwood"), 100]], { count: 100 }),
    ]);
    expect(dataset.recipes.charcoal!.variants.map((v) => v.recipeId)).toEqual(["r_sap", "r_heart"]);
  });

  it("DAT-6: fills in item fields, rarity from the item's own output, and raw unless craftable", () => {
    const { dataset } = build([
      recipe(
        "r_sword",
        e("sword", { iconPath: "/i/sword.webp", mainCategoryId: "weapons", categories: ["melee"], tier: 2, quality: "rare", maxStackSize: 1 }),
        [[e("ingot", { quality: "uncommon" }), 2]], // seen only as an ingredient
      ),
      recipe("r_axe", e("axe", { quality: "uncommon" }), [[e("ingot"), 1]]),
    ]);
    expect(dataset.items.sword).toEqual({
      id: "sword",
      name: "SWORD",
      iconPath: "/i/sword.webp",
      mainCategoryId: "weapons",
      categories: ["melee"],
      tier: 2,
      rarity: "rare",
      maxStackSize: 1,
      isRaw: false,
    });
    expect(dataset.items.axe!.rarity).toBe("uncommon");
    expect(dataset.items.ingot).toMatchObject({ rarity: null, isRaw: true, iconPath: null, tier: null, categories: [] });
  });

  it("DAT-6: an item with no name is named by its ID", () => {
    const { dataset } = build([recipe("r_x", { id: "nameless" }, [[e("wood"), 1]])]);
    expect(dataset.items.nameless!.name).toBe("nameless");
  });

  it("DAT-7: market items not in any recipe become raw items", () => {
    const { dataset } = build([recipe("r_plank", e("plank"), [[e("wood"), 2]])], {
      flower: { name: { En: "Flower", De: "Blume" }, iconPath: "/i/flower.webp", stackSize: 50 },
      pebble: { name: "Pebble" },
      mystery: {},
      plank: { name: { En: "Market plank" }, stackSize: 999 }, // already known from a recipe
    });
    expect(dataset.items.flower).toEqual({
      id: "flower",
      name: "Flower",
      iconPath: "/i/flower.webp",
      mainCategoryId: null,
      categories: [],
      tier: null,
      rarity: null,
      maxStackSize: 50,
      isRaw: true,
    });
    expect(dataset.items.pebble!.name).toBe("Pebble");
    expect(dataset.items.mystery!.name).toBe("mystery");
    expect(dataset.items.plank).toMatchObject({ name: "PLANK", maxStackSize: null, isRaw: false });
  });

  it("DAT-8: items are sorted by ID, and meta counts variants and items", () => {
    const { dataset } = build(
      [
        recipe("r_sap", e("charcoal"), [[e("sapwood"), 50]]),
        recipe("r_heart", e("charcoal"), [[e("heartwood"), 100]]),
        recipe("r_plank", e("plank"), [[e("wood"), 2]]),
      ],
      { apple: { name: "Apple" } },
    );
    expect(Object.keys(dataset.items)).toEqual(["apple", "charcoal", "heartwood", "plank", "sapwood", "wood"]);
    expect(dataset.meta).toEqual({
      generatedAt: "2026-01-01T00:00:00.000Z",
      source: "paxdei.gaming.tools (cdn-hosted recipes.d.json) + market items.json",
      recipeCount: 3,
      itemCount: 6,
    });
  });

  it("DAT-9: a missing recipe cache is an error; a missing market file isn't", () => {
    const dir = mkdtempSync(join(tmpdir(), "pax-cache-"));
    try {
      expect(() => loadRaw(dir)).toThrow("run `npm run fetch:raw` first");
      writeFileSync(join(dir, "recipes.raw.json"), JSON.stringify([recipe("r", e("a"), [[e("b"), 1]])]));
      const { recipes, market } = loadRaw(dir);
      expect(recipes).toHaveLength(1);
      expect(market).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The real-data half of DAT-N1 needs scripts/.cache, which isn't in git:
  // `npm run check:dataset` rebuilds from it and diffs against data/dataset.json.
  it("DAT-N1: the same input always gives the same dataset, apart from generatedAt", () => {
    const raw = [
      recipe("r_sap", e("charcoal"), [[e("sapwood"), 50]], { count: 50 }),
      recipe("r_heart", e("charcoal"), [[e("heartwood"), 100]], { count: 100 }),
      recipe("r_refine", e("linen_cloth_fine"), [[e("linen_cloth"), 2]]),
      recipe("r_base", e("linen_cloth_fine"), [[e("linen_string"), 4]]),
    ];
    const market = { flower: { name: "Flower" } };
    const a = buildDataset(structuredClone(raw), market, "2026-01-01T00:00:00.000Z");
    const b = buildDataset(structuredClone(raw), market, "2027-06-30T12:00:00.000Z");
    const strip = (d: typeof a.dataset) => JSON.stringify({ ...d, meta: { ...d.meta, generatedAt: "" } });
    expect(strip(a.dataset)).toBe(strip(b.dataset));
    expect(a.dataset.meta.generatedAt).not.toBe(b.dataset.meta.generatedAt);
  });
});
