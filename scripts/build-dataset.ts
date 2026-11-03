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
 *   - A few items are forced to "raw" (FORCE_RAW): their recipes are dropped so
 *     they become gathered materials. Used for the medium/"normal" animal hides,
 *     whose only recipes combine small hides or split large hides — we treat the
 *     normal hide as the gathered unit instead of recursing into those.
 *
 * Prereq: run `npm run fetch:raw` first to populate scripts/.cache/.
 * Run: npm run build:dataset
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDataset, loadRaw } from "./datasetRules.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = resolve(__dirname, ".cache");
const DATA = resolve(__dirname, "../data");

const { recipes: raw, market } = loadRaw(CACHE);
const { dataset, droppedRefinements, collapsed, forcedRaw } = buildDataset(raw, market);

await mkdir(DATA, { recursive: true });
await writeFile(resolve(DATA, "dataset.json"), JSON.stringify(dataset));

console.log(`items:   ${dataset.meta.itemCount}`);
console.log(`recipes: ${dataset.meta.recipeCount} variants across ${Object.keys(dataset.recipes).length} output items`);
const raws = Object.values(dataset.items).filter((i) => i.isRaw).length;
console.log(`raw (gathered) items: ${raws}`);
console.log(`\nforced to raw (recipes dropped) (${forcedRaw.length}):`);
for (const f of forcedRaw) console.log("  " + f);
console.log(`\ndropped refinement recipes (${droppedRefinements.length}):`);
for (const d of droppedRefinements) console.log("  " + d);
console.log(`\ncollapsed same-input variants (${collapsed.length}):`);
for (const c of collapsed.slice(0, 20)) console.log("  " + c);
const multi = Object.values(dataset.recipes).filter((r) => r.variants.length > 1);
console.log(`\noutput items still with alternative paths (${multi.length}):`);
for (const m of multi) console.log(`  ${m.outputItemId}: ${m.variants.length} variants`);
