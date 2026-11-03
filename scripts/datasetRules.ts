/** The dataset normalisation rules (scripts/README.md), split out of
 * build-dataset.ts so they can be tested without running the pipeline. See
 * build-dataset.ts for what each rule is for. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  Dataset,
  Ingredient,
  Item,
  ItemRecipes,
  RecipeVariant,
} from "../src/tools/planner/engine/types.ts";

export interface RawEntity {
  id: string;
  name?: string;
  iconPath?: string;
  mainCategoryId?: string;
  categories?: string[];
  tier?: number;
  quality?: string;
  maxStackSize?: number;
}
export interface RawRecipe {
  id: string;
  name?: string;
  skillRequired?: { id?: string; name?: string };
  outputs?: { entity?: RawEntity; count?: number }[];
  itemIngredients?: { entity?: RawEntity; count?: number }[];
}

/** Strip a trailing tier/quality qualifier so tier-variants of one base collapse. */
const QUALIFIER = /_(?:fine|coarse|refined|pure|raw|cloudy|clear|clarified)$/;
export function stem(id: string): string {
  let s = id;
  // Strip one quality qualifier and any trailing numeric suffix.
  s = s.replace(/_\d+$/, "");
  s = s.replace(QUALIFIER, "");
  return s;
}

/** Output items forced to "raw" — their recipes are dropped and they are gathered.
 * The normal/rough animal hides only have combine-from-small / split-from-large
 * recipes; we treat the normal hide as the gathered unit for leather. */
export const FORCE_RAW = new Set<string>([
  "item_raw_material_medium_animal_hide",
  "item_raw_material_medium_animal_hide_rough",
]);

/** Read the cached upstream data from `cacheDir` (scripts/.cache). The market
 * file is optional; the recipes file is required. */
export function loadRaw(cacheDir: string): { recipes: RawRecipe[]; market: Record<string, any> } {
  const rp = resolve(cacheDir, "recipes.raw.json");
  if (!existsSync(rp)) {
    throw new Error("Missing scripts/.cache/recipes.raw.json — run `npm run fetch:raw` first.");
  }
  const recipes = JSON.parse(readFileSync(rp, "utf8")) as RawRecipe[];
  const mp = resolve(cacheDir, "items.market.json");
  const market = existsSync(mp) ? JSON.parse(readFileSync(mp, "utf8")) : {};
  return { recipes, market };
}

function toItem(e: RawEntity): Item {
  return {
    id: e.id,
    name: e.name ?? e.id,
    iconPath: e.iconPath ?? null,
    mainCategoryId: e.mainCategoryId ?? null,
    categories: e.categories ?? [],
    tier: e.tier ?? null,
    rarity: null, // set from the item's own output entity in the recipe loop
    maxStackSize: e.maxStackSize ?? null,
    isRaw: true, // refined below once we know which items have recipes
  };
}

/** Apply the normalisation rules to the raw upstream data. Pure: no file or
 * network access, and the timestamp is passed in. */
export function buildDataset(
  raw: RawRecipe[],
  market: Record<string, any>,
  generatedAt: string = new Date().toISOString(),
) {
  const items = new Map<string, Item>();

  const recordItem = (e?: RawEntity) => {
    if (!e?.id) return;
    if (!items.has(e.id)) items.set(e.id, toItem(e));
  };

  // Parse raw recipes into variants and collect item entities.
  const parsed: (RecipeVariant & { outputItemId: string })[] = [];
  for (const r of raw) {
    const out = r.outputs?.[0];
    const outId = out?.entity?.id;
    if (!outId || !out) continue;
    const ings: Ingredient[] = [];
    for (const ing of r.itemIngredients ?? []) {
      if (!ing.entity?.id || !ing.count) continue;
      recordItem(ing.entity);
      ings.push({ itemId: ing.entity.id, count: ing.count });
    }
    if (ings.length === 0) continue;
    recordItem(out.entity);
    // Rarity comes from the item's own output entity (an item first seen as a
    // trimmed ingredient reference carries no quality), so set it here.
    const outItem = items.get(outId);
    if (outItem) {
      outItem.rarity =
        out.entity?.quality === "uncommon" ? "uncommon"
        : out.entity?.quality === "rare" ? "rare"
        : null;
    }
    parsed.push({
      outputItemId: outId,
      recipeId: r.id,
      yield: out.count ?? 1,
      ingredients: ings,
      profession: r.skillRequired?.name ?? null,
      professionId: r.skillRequired?.id ?? null,
    });
  }

  // Supplement the item catalog with market items not seen in the recipe graph.
  for (const [id, m] of Object.entries(market)) {
    if (items.has(id)) continue;
    const name = typeof m?.name === "object" ? m.name.En ?? id : m?.name ?? id;
    items.set(id, {
      id,
      name,
      iconPath: m?.iconPath ?? null,
      mainCategoryId: null,
      categories: [],
      tier: null,
      rarity: null,
      maxStackSize: m?.stackSize ?? null,
      isRaw: true,
    });
  }

  // Group variants by output item.
  const byOut = new Map<string, (RecipeVariant & { outputItemId: string })[]>();
  for (const p of parsed) {
    const arr = byOut.get(p.outputItemId) ?? [];
    arr.push(p);
    byOut.set(p.outputItemId, arr);
  }

  const droppedRefinements: string[] = [];
  const collapsed: string[] = [];
  const forcedRaw: string[] = [];
  const recipes: Record<string, ItemRecipes> = {};

  for (const [outId, variants] of byOut) {
    // Rule 0: forced-raw items keep no recipe and stay gathered materials.
    if (FORCE_RAW.has(outId)) {
      forcedRaw.push(outId);
      continue;
    }

    // Rule 1: drop refinement recipes (an ingredient is a tier-variant of the output),
    // but only if a non-refinement (from-base) recipe survives.
    const isRefinement = (v: RecipeVariant) =>
      v.ingredients.some((i) => i.itemId !== outId && stem(i.itemId) === stem(outId));
    const base = variants.filter((v) => !isRefinement(v));
    let kept = base.length > 0 ? base : variants;
    for (const v of variants) {
      if (!kept.includes(v)) {
        const ing = v.ingredients.find((i) => stem(i.itemId) === stem(outId));
        droppedRefinements.push(`${outId} <- ${ing?.itemId}`);
      }
    }

    // Rule 2: among same-ingredient-set variants, keep only the highest yield.
    const bySig = new Map<string, RecipeVariant>();
    for (const v of kept) {
      const sig = v.ingredients
        .map((i) => i.itemId)
        .sort()
        .join("|");
      const existing = bySig.get(sig);
      if (!existing || v.yield > existing.yield) {
        if (existing) collapsed.push(`${outId} (${sig}) kept yield ${Math.max(v.yield, existing.yield)}`);
        bySig.set(sig, v);
      } else {
        collapsed.push(`${outId} (${sig}) dropped yield ${v.yield}`);
      }
    }

    recipes[outId] = {
      outputItemId: outId,
      variants: [...bySig.values()].map((v) => ({
        recipeId: v.recipeId,
        yield: v.yield,
        ingredients: v.ingredients,
        profession: v.profession,
        professionId: v.professionId,
      })),
    };
  }

  // Mark craftable items as not-raw.
  for (const id of Object.keys(recipes)) {
    const it = items.get(id);
    if (it) it.isRaw = false;
  }

  const dataset: Dataset = {
    items: Object.fromEntries([...items.entries()].sort()),
    recipes,
    meta: {
      generatedAt,
      source: "paxdei.gaming.tools (cdn-hosted recipes.d.json) + market items.json",
      recipeCount: Object.values(recipes).reduce((n, r) => n + r.variants.length, 0),
      itemCount: items.size,
    },
  };

  return { dataset, droppedRefinements, collapsed, forcedRaw };
}
