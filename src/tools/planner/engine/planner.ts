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
  /** Longest dependency distance from a final product (a target is tier 0, its
   * direct ingredients tier 1, …). An item used at several depths takes its
   * deepest (max) tier so it appears once, above all its consumers. */
  tier: number;
  /** Net units that must exist after this step (gross demand minus owned). For a
   * satisfied step this is the gross demand, since owned already covers it. */
  needed: number;
  /** Number of times the recipe is run (ceil(needed / yield)); 0 when satisfied. */
  crafts: number;
  /** Units actually produced (crafts * yield); may exceed needed. 0 when satisfied. */
  produced: number;
  yield: number;
  profession: string | null;
  recipeId: string;
  ingredients: { itemId: string; count: number }[];
  /** Owned stock fully covers the gross demand: keep the row but grey it out, and
   * don't propagate demand to its ingredients. */
  satisfied: boolean;
}

/** A gather step: collect `needed` units of a raw material. */
export interface GatherStep {
  itemId: string;
  needed: number;
  /** Owned stock fully covers the gross demand: keep the row but grey it out. */
  satisfied: boolean;
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

  // 3. Tier = longest dependency distance from a final product. `order` visits
  //    every consumer before the item it consumes, so reading depth(node) is
  //    final by the time we expand its ingredients.
  const depth = new Map<string, number>();
  for (const t of targets) depth.set(t.itemId, Math.max(depth.get(t.itemId) ?? 0, 0));
  for (const id of order) {
    const d = depth.get(id) ?? 0;
    const variant = pickVariant(ds, id, pathChoices);
    if (!variant) continue;
    for (const ing of variant.ingredients) {
      depth.set(ing.itemId, Math.max(depth.get(ing.itemId) ?? 0, d + 1));
    }
  }

  // 4. Propagate demand along the topo order, subtracting owned at each node.
  for (const t of targets) gross.set(t.itemId, (gross.get(t.itemId) ?? 0) + t.quantity);

  const crafts: CraftStep[] = [];
  const gather: GatherStep[] = [];

  for (const id of order) {
    const grossNeed = gross.get(id) ?? 0;
    // grossNeed is 0 only for items never actually demanded (e.g. ingredients of
    // a satisfied parent, whose demand was never propagated): drop those entirely.
    if (grossNeed <= 0) continue;
    const have = owned[id] ?? 0;
    const need = Math.max(0, grossNeed - have);
    const satisfied = need <= 0;

    const variant = pickVariant(ds, id, pathChoices);
    if (!variant) {
      gather.push({ itemId: id, needed: satisfied ? grossNeed : need, satisfied });
      continue;
    }

    const batches = satisfied ? 0 : Math.ceil(need / variant.yield);
    const produced = batches * variant.yield;
    crafts.push({
      itemId: id,
      tier: depth.get(id) ?? 0,
      needed: satisfied ? grossNeed : need,
      crafts: batches,
      produced,
      yield: variant.yield,
      profession: variant.profession,
      recipeId: variant.recipeId,
      ingredients: variant.ingredients,
      satisfied,
    });
    // A satisfied step is fully covered by owned stock, so its ingredients aren't
    // needed: skip propagation so the sub-tree is pruned (not greyed).
    if (satisfied) continue;
    for (const ing of variant.ingredients) {
      gross.set(ing.itemId, (gross.get(ing.itemId) ?? 0) + ing.count * batches);
    }
  }

  // 5. Crafts are emitted consumers-first; reverse so dependencies come first.
  crafts.reverse();
  gather.sort((a, b) => a.itemId.localeCompare(b.itemId));

  // 6. Surface alternative-path choices for the UI.
  const choices = [...nodes]
    .filter((id) => (ds.recipes[id]?.variants.length ?? 0) > 1)
    .map((id) => ({
      itemId: id,
      chosen: pickVariant(ds, id, pathChoices)!.recipeId,
      available: ds.recipes[id]!.variants.map((v) => v.recipeId),
    }));

  return { crafts, gather, choices, warnings };
}
