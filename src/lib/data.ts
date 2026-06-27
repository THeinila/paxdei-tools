/** Dataset access + small helpers shared across the UI. */
import datasetJson from "../../data/dataset.json";
import type { Dataset, Item } from "../engine/types.ts";
import { localIconName } from "./iconName.ts";

export const dataset = datasetJson as unknown as Dataset;

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
  return dataset.items[id];
}

export function itemName(id: string): string {
  return dataset.items[id]?.name ?? id;
}

/** Case-insensitive name search over craftable + raw items, ranked by match. */
export function searchItems(query: string, limit = 40): Item[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const results: { item: Item; score: number }[] = [];
  for (const item of Object.values(dataset.items)) {
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
