/**
 * Rebuild the dataset from scripts/.cache in memory and compare it with the
 * committed data/dataset.json, ignoring meta.generatedAt (DAT-N1). Use it to
 * show a pipeline refactor changes nothing: run it before committing one.
 *
 * Prereq: npm run fetch:raw (the cache must hold the inputs the committed
 * dataset was built from).
 * Run: npm run check:dataset   (exit 0 = identical, 1 = different)
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDataset, loadRaw } from "./datasetRules.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { recipes, market } = loadRaw(resolve(__dirname, ".cache"));
const rebuilt = buildDataset(recipes, market, "").dataset;
const committed = JSON.parse(readFileSync(resolve(__dirname, "../data/dataset.json"), "utf8"));
committed.meta.generatedAt = "";

if (JSON.stringify(rebuilt) === JSON.stringify(committed)) {
  console.log("dataset matches data/dataset.json (ignoring meta.generatedAt)");
} else {
  const ids = (d: { items: object }) => new Set(Object.keys(d.items));
  const [a, b] = [ids(rebuilt), ids(committed)];
  console.log("dataset DIFFERS from data/dataset.json");
  console.log(`  items: ${a.size} rebuilt vs ${b.size} committed`);
  console.log(`  recipes: ${rebuilt.meta.recipeCount} rebuilt vs ${committed.meta.recipeCount} committed`);
  process.exit(1);
}
