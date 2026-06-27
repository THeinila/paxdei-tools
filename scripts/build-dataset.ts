/**
 * Step 2 of the data pipeline: normalize the rehydrated raw recipe data into the
 * committed dataset the app reads (data/dataset.json).
 *
 * Applies the multi-recipe rules:
 *   - Refinement/upgrade recipes (output crafted from a tier-variant of itself,
 *     e.g. Fine Linen Cloth <- Linen Cloth) are dropped, keeping the from-base
 *     recipe (Fine Linen Cloth <- Linen String).
 *   - When several variants share the exact same ingredient set, keep only the
 *     highest-yield one (e.g. by-hand vs passive station).
 *   - Genuinely different input paths (e.g. Charcoal from Sapwood vs Heartwood)
 *     are all kept as selectable alternatives.
 *
 * Prereq: run `npm run fetch:raw` first to populate scripts/.cache/.
 * Run: npm run build:dataset
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Dataset,
  Ingredient,
  Item,
  ItemRecipes,
  RecipeVariant,
} from "../src/engine/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = resolve(__dirname, ".cache");
const DATA = resolve(__dirname, "../data");

interface RawEntity {
  id: string;
  name?: string;
  iconPath?: string;
  mainCategoryId?: string;
  categories?: string[];
  tier?: number;
  maxStackSize?: number;
}
interface RawRecipe {
  id: string;
  name?: string;
  skillRequired?: { id?: string; name?: string };
  outputs?: { entity?: RawEntity; count?: number }[];
  itemIngredients?: { entity?: RawEntity; count?: number }[];
}

/** Strip a trailing tier/quality qualifier so tier-variants of one base collapse. */
const QUALIFIER = /_(?:fine|coarse|refined|pure|raw|cloudy|clear|clarified)$/;
function stem(id: string): string {
  let s = id;
  // Strip one quality qualifier and any trailing numeric suffix.
  s = s.replace(/_\d+$/, "");
  s = s.replace(QUALIFIER, "");
  return s;
}

function loadRaw(): { recipes: RawRecipe[]; market: Record<string, any> } {
  const rp = resolve(CACHE, "recipes.raw.json");
  if (!existsSync(rp)) {
    throw new Error("Missing scripts/.cache/recipes.raw.json — run `npm run fetch:raw` first.");
  }
  const recipes = JSON.parse(readFileSync(rp, "utf8")) as RawRecipe[];
  const mp = resolve(CACHE, "items.market.json");
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
    maxStackSize: e.maxStackSize ?? null,
    isRaw: true, // refined below once we know which items have recipes
  };
}

function main() {
  const { recipes: raw, market } = loadRaw();
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
  const recipes: Record<string, ItemRecipes> = {};

  for (const [outId, variants] of byOut) {
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
      generatedAt: new Date().toISOString(),
      source: "paxdei.gaming.tools (cdn-hosted recipes.d.json) + market items.json",
      recipeCount: Object.values(recipes).reduce((n, r) => n + r.variants.length, 0),
      itemCount: items.size,
    },
  };

  return { dataset, droppedRefinements, collapsed };
}

const { dataset, droppedRefinements, collapsed } = main();

await mkdir(DATA, { recursive: true });
await writeFile(resolve(DATA, "dataset.json"), JSON.stringify(dataset));

console.log(`items:   ${dataset.meta.itemCount}`);
console.log(`recipes: ${dataset.meta.recipeCount} variants across ${Object.keys(dataset.recipes).length} output items`);
const raws = Object.values(dataset.items).filter((i) => i.isRaw).length;
console.log(`raw (gathered) items: ${raws}`);
console.log(`\ndropped refinement recipes (${droppedRefinements.length}):`);
for (const d of droppedRefinements) console.log("  " + d);
console.log(`\ncollapsed same-input variants (${collapsed.length}):`);
for (const c of collapsed.slice(0, 20)) console.log("  " + c);
const multi = Object.values(dataset.recipes).filter((r) => r.variants.length > 1);
console.log(`\noutput items still with alternative paths (${multi.length}):`);
for (const m of multi) console.log(`  ${m.outputItemId}: ${m.variants.length} variants`);
