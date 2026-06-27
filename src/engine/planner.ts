/**
 * The recipe engine: given a dataset, a list of target items with quantities,
 * and (optionally) owned stock + chosen alternative paths, compute the flattened
 * plan — raw materials to gather and intermediate crafts to make — with totals
 * aggregated across all targets and owned stock subtracted at every node.
 */
import type { Dataset, RecipeVariant } from "./types.ts";

export interface Target {
  itemId: string;
  quantity: number;
}

/** A craft step: make `crafts` batches of `itemId`, producing `produced` units. */
export interface CraftStep {
  itemId: string;
  /** Net units that must exist after this step (gross demand minus owned). */
  needed: number;
  /** Number of times the recipe is run (ceil(needed / yield)). */
  crafts: number;
  /** Units actually produced (crafts * yield); may exceed needed. */
  produced: number;
  yield: number;
  profession: string | null;
  recipeId: string;
  ingredients: { itemId: string; count: number }[];
}

/** A gather step: collect `needed` units of a raw material. */
export interface GatherStep {
  itemId: string;
  needed: number;
}

export interface Plan {
  /** Intermediate + target crafts, ordered dependencies-first. */
  crafts: CraftStep[];
  /** Raw materials to gather. */
  gather: GatherStep[];
  /** Items with >1 path and the variant chosen for each (for UI override). */
  choices: { itemId: string; chosen: string; available: string[] }[];
  warnings: string[];
}

export interface PlanOptions {
  /** itemId -> quantity already owned (subtracted from gross demand). */
  owned?: Record<string, number>;
  /** itemId -> recipeId, to override the default variant for multi-path items. */
  pathChoices?: Record<string, string>;
}

/** Pick the recipe variant for an item: explicit choice, else the first variant. */
function pickVariant(
  ds: Dataset,
  itemId: string,
  pathChoices: Record<string, string>,
): RecipeVariant | null {
  const entry = ds.recipes[itemId];
  if (!entry || entry.variants.length === 0) return null;
  const chosen = pathChoices[itemId];
  if (chosen) {
    const match = entry.variants.find((v) => v.recipeId === chosen);
    if (match) return match;
  }
  return entry.variants[0] ?? null;
}

export function plan(ds: Dataset, targets: Target[], options: PlanOptions = {}): Plan {
  const owned = { ...(options.owned ?? {}) };
  const pathChoices = options.pathChoices ?? {};
  const warnings: string[] = [];

  // 1. Discover the reachable sub-graph (only along chosen variants) and the
  //    "consumes" edges, so we can process each item after all its consumers.
  const gross = new Map<string, number>(); // accumulated gross demand
  const consumers = new Map<string, Set<string>>(); // item -> items that consume it
  const nodes = new Set<string>();

  const addEdge = (parent: string, child: string) => {
    if (!consumers.has(child)) consumers.set(child, new Set());
    consumers.get(child)!.add(parent);
  };

  // Seed targets and walk the graph to register nodes + edges (qty-independent).
  const stack: string[] = [];
  for (const t of targets) {
    nodes.add(t.itemId);
    stack.push(t.itemId);
  }
  const walked = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (walked.has(id)) continue;
    walked.add(id);
    const variant = pickVariant(ds, id, pathChoices);
    if (!variant) continue;
    for (const ing of variant.ingredients) {
      nodes.add(ing.itemId);
      addEdge(id, ing.itemId);
      if (!walked.has(ing.itemId)) stack.push(ing.itemId);
    }
  }

  // 2. Topological order over "consumes" edges: an item is emitted only after
  //    every item that consumes it. Kahn's algorithm on remaining-consumer count.
  const remaining = new Map<string, number>();
  for (const id of nodes) remaining.set(id, consumers.get(id)?.size ?? 0);
  const ready: string[] = [...nodes].filter((id) => (remaining.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    const variant = pickVariant(ds, id, pathChoices);
    if (!variant) continue;
    for (const ing of variant.ingredients) {
      const left = (remaining.get(ing.itemId) ?? 0) - 1;
      remaining.set(ing.itemId, left);
      if (left === 0) ready.push(ing.itemId);
    }
  }
  if (order.length < nodes.size) {
    warnings.push(
      "Recipe cycle detected; some items were treated as raw to break the loop.",
    );
    for (const id of nodes) if (!order.includes(id)) order.push(id);
  }

  // 3. Propagate demand along the topo order, subtracting owned at each node.
  for (const t of targets) gross.set(t.itemId, (gross.get(t.itemId) ?? 0) + t.quantity);

  const crafts: CraftStep[] = [];
  const gather: GatherStep[] = [];

  for (const id of order) {
    const grossNeed = gross.get(id) ?? 0;
    const have = owned[id] ?? 0;
    const need = Math.max(0, grossNeed - have);
    if (need <= 0) continue;

    const variant = pickVariant(ds, id, pathChoices);
    if (!variant) {
      gather.push({ itemId: id, needed: need });
      continue;
    }

    const batches = Math.ceil(need / variant.yield);
    const produced = batches * variant.yield;
    crafts.push({
      itemId: id,
      needed: need,
      crafts: batches,
      produced,
      yield: variant.yield,
      profession: variant.profession,
      recipeId: variant.recipeId,
      ingredients: variant.ingredients,
    });
    for (const ing of variant.ingredients) {
      gross.set(ing.itemId, (gross.get(ing.itemId) ?? 0) + ing.count * batches);
    }
  }

  // 4. Crafts are emitted consumers-first; reverse so dependencies come first.
  crafts.reverse();
  gather.sort((a, b) => a.itemId.localeCompare(b.itemId));

  // 5. Surface alternative-path choices for the UI.
  const choices = [...nodes]
    .filter((id) => (ds.recipes[id]?.variants.length ?? 0) > 1)
    .map((id) => ({
      itemId: id,
      chosen: pickVariant(ds, id, pathChoices)!.recipeId,
      available: ds.recipes[id]!.variants.map((v) => v.recipeId),
    }));

  return { crafts, gather, choices, warnings };
}
