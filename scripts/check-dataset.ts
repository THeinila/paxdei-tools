/** Spot-check helper: inspect items/recipes in the built dataset by name or id. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dataset } from "../src/engine/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ds = JSON.parse(
  readFileSync(resolve(__dirname, "../data/dataset.json"), "utf8"),
) as Dataset;

const byName = (q: string) =>
  Object.values(ds.items).filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));

function show(id: string) {
  const it = ds.items[id];
  const r = ds.recipes[id];
  console.log(`\n${it?.name} (${id}) raw=${it?.isRaw}`);
  if (r)
    for (const v of r.variants)
      console.log(
        `  yield ${v.yield} @${v.profession}: ` +
          v.ingredients.map((g) => `${ds.items[g.itemId]?.name ?? g.itemId} x${g.count}`).join(", "),
      );
}

show("wieldable_tool_build_hammer"); // Construction Hammer
console.log("\n=== raw gneiss / sapwood materials ===");
for (const i of [...byName("gneiss rock"), ...byName("sapwood")].slice(0, 8))
  console.log(`  ${i.name}  ${i.id}  raw=${i.isRaw}`);
