/** Dataset access + small helpers shared across the UI.
 *
 * The dataset is ~1.5 MB — it used to be `import`ed statically, which inlined it
 * into the main bundle and made every visitor download the entire item catalogue
 * before the landing page could render, on a host with ~125 ms of CPU per second.
 * Worse, it shared a content hash with the application code, so every code
 * deploy invalidated the dataset too and re-sent all 1.5 MB.
 *
 * It is now a dynamically imported chunk, fetched once and cached forever under
 * its own hash. Only the planner needs it, and the planner routes are lazy (see
 * src/tools/registry.tsx), so the shell and landing page never pay for it and a
 * code-only deploy leaves the cached copy valid.
 *
 * Consumers keep the old synchronous API: every one of them lives inside a
 * planner route, which does not render until `loadDataset()` has resolved. */
import type { Dataset, Item } from "../engine/types.ts";
import { localIconName } from "./iconName.ts";

let loaded: Dataset | undefined;
let inFlight: Promise<Dataset> | undefined;

/** Fetch the dataset chunk (once). Awaited by the planner route loaders before
 * any component that reads `dataset` is allowed to render. */
export function loadDataset(): Promise<Dataset> {
  if (loaded) return Promise.resolve(loaded);
  inFlight ??= import("../../../../data/dataset.json").then((mod) => {
    loaded = (mod.default ?? mod) as unknown as Dataset;
    return loaded;
  });
  return inFlight;
}

/** True once the dataset chunk has arrived. */
export function datasetReady(): boolean {
  return loaded !== undefined;
}

/** The loaded dataset.
 *
 * Throws rather than returning a half-built value: reaching this before
 * `loadDataset()` resolves means a component escaped the route gate, and a
 * confusing empty catalogue is much harder to debug than a loud error. */
export function getDataset(): Dataset {
  if (!loaded) {
    throw new Error(
      "dataset not loaded — render this behind a planner route (see loadDataset in lib/data.ts)",
    );
  }
  return loaded;
}

/** Resolve an item's icon to a same-origin local URL. Icons are downloaded at
 * build time (npm run fetch:icons) so the app makes no external requests. */
export function iconUrl(item: Item | undefined): string | null {
  if (!item?.iconPath) return null;
  return `/icons/${localIconName(item.iconPath)}`;
}

/** Link to the item's gaming.tools page, which lists sources/biomes for raws. */
export function sourceUrl(item: Item | undefined): string | null {
  if (!item) return null;
  const cat = item.mainCategoryId ?? "items";
  return `https://paxdei.gaming.tools/${cat}/${item.id}`;
}

export function getItem(id: string): Item | undefined {
  return getDataset().items[id];
}

export function itemName(id: string): string {
  return getDataset().items[id]?.name ?? id;
}

/** Case-insensitive name search over craftable + raw items, ranked by match. */
export function searchItems(query: string, limit = 40): Item[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const results: { item: Item; score: number }[] = [];
  for (const item of Object.values(getDataset().items)) {
    const name = item.name.toLowerCase();
    const idx = name.indexOf(q);
    if (idx === -1) continue;
    // Prefer prefix matches, then shorter names.
    const score = (idx === 0 ? 0 : 100) + idx + name.length / 100;
    results.push({ item, score });
  }
  results.sort((a, b) => a.score - b.score);
  return results.slice(0, limit).map((r) => r.item);
}
