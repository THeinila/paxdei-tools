/** Throwaway inspection of the rehydrated recipe data to design normalization. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const recipes = JSON.parse(
  readFileSync(resolve(__dirname, ".cache/recipes.raw.json"), "utf8"),
) as any[];

console.log("total recipes:", recipes.length);
console.log("\n=== keys on a recipe ===");
console.log(Object.keys(recipes[0]).join(", "));

const norm = (r: any) => ({
  recipeId: r.id,
  out: r.outputs?.[0]?.entity?.id,
  outName: r.outputs?.[0]?.entity?.name,
  yield: r.outputs?.[0]?.count,
  skill: r.skillRequired?.name,
  stations: (r.crafters ?? []).map((c: any) => c.name),
  ings: (r.itemIngredients ?? []).map((i: any) => ({ id: i.entity?.id, n: i.entity?.name, c: i.count })),
});

console.log("\n=== sample normalized recipe ===");
console.log(JSON.stringify(norm(recipes[1]), null, 1));

// Group by output item id
const byOut = new Map<string, any[]>();
for (const r of recipes) {
  const out = r.outputs?.[0]?.entity?.id;
  if (!out) continue;
  (byOut.get(out) ?? byOut.set(out, []).get(out)!).push(r);
}
const multi = [...byOut.entries()].filter(([, rs]) => rs.length > 1);
console.log(`\n=== items with >1 recipe: ${multi.length} (of ${byOut.size} output items) ===`);
console.log("distribution of recipe-count per output item:");
const dist = new Map<number, number>();
for (const [, rs] of byOut) dist.set(rs.length, (dist.get(rs.length) ?? 0) + 1);
console.log([...dist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}x:${v}`).join("  "));

const show = (label: string, match: (n: any) => boolean) => {
  console.log(`\n=== ${label} ===`);
  for (const [, rs] of multi) {
    const ns = rs.map(norm);
    if (ns.some(match)) {
      for (const n of ns) {
        console.log(`${n.outName} <- [${n.ings.map((i: any) => `${i.n} x${i.c}`).join(", ")}] yield ${n.yield} @${n.stations.join("/")}`);
      }
      console.log("---");
      return;
    }
  }
  console.log("(none found)");
};

show("charcoal (different input paths)", (n) => /charcoal/i.test(n.outName ?? ""));
show("fine linen cloth (refinement?)", (n) => /fine linen/i.test(n.outName ?? ""));
show("linen cloth", (n) => /^linen cloth/i.test(n.outName ?? ""));

// Find candidate refinement recipes: an ingredient whose name is a substring/relative of the output
console.log("\n=== candidate refinement recipes (ingredient id shares stem with output id) ===");
let count = 0;
for (const [out, rs] of multi) {
  for (const r of rs) {
    const n = norm(r);
    for (const ing of n.ings) {
      // refinement heuristic: ingredient is a lower-tier variant of the same base material
      if (ing.id && out && ing.id !== out) {
        const stem = (s: string) => s.replace(/_?(fine|coarse|refined|pure|cloudy|clear|\d+)$/i, "");
        if (stem(ing.id) === stem(out) && ing.id !== out) {
          if (count < 12) console.log(`${n.outName} <- ${ing.n} (${ing.id} ~ ${out})`);
          count++;
        }
      }
    }
  }
}
console.log("total candidate refinement recipe-ingredient matches:", count);
