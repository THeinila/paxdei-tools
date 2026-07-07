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

/** A buy step: purchase `needed` units instead of crafting/gathering them.
 * The item's whole ingredient sub-tree is pruned — bought items arrive whole. */
export interface BuyStep {
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
  /** Items marked "buy": acquired whole, their ingredients not planned. */
  buys: BuyStep[];
  /** Items with >1 path and the variant chosen for each (for UI override). */
  choices: { itemId: string; chosen: string; available: string[] }[];
  warnings: string[];
}

export interface PlanOptions {
  /** itemId -> quantity already owned (subtracted from gross demand). */
  owned?: Record<string, number>;
  /** itemId -> recipeId, to override the default variant for multi-path items. */
  pathChoices?: Record<string, string>;
  /** Items to buy instead of craft/gather. Owned stock still subtracts first
   * (own 5, buy the rest); the item's ingredients receive no demand at all. */
  buys?: Iterable<string>;
}

/** Pick the recipe variant for an item: explicit choice, else the first variant. */
export function pickVariant(
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
  const buys = new Set(options.buys ?? []);
  const warnings: string[] = [];

  // A bought node is a leaf in every pass below: its recipe is never expanded,
  // so its ingredient sub-tree receives no demand (and isn't even discovered
  // unless another consumer needs it).
  const variantOf = (id: string): RecipeVariant | null =>
    buys.has(id) ? null : pickVariant(ds, id, pathChoices);

  // 1. Discover the reachable sub-graph (only along chosen variants) and the
  //    "consumes" edges, so we can process each item after all its consumers.
  const gross = new Map<string, number>(); // full bill-of-materials demand (owned-agnostic)
  const active = new Map<string, number>(); // demand that still needs doing (owned subtracted)
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
    const variant = variantOf(id);
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
    const variant = variantOf(id);
    if (!variant) continue;
    for (const ing of variant.ingredients) {
      const left = (remaining.get(ing.itemId) ?? 0) - 1;
      remaining.set(ing.itemId, left);
      if (left === 0) ready.push(ing.itemId);
    }
  }
  if (order.length < nodes.size) {
    warnings.push(
      "Recipe cycle detected; the steps involved may be listed in arbitrary order.",
    );
    const placed = new Set(order);
    for (const id of nodes) if (!placed.has(id)) order.push(id);
  }

  // 3. Tier = longest dependency distance from a final product. `order` visits
  //    every consumer before the item it consumes, so reading depth(node) is
  //    final by the time we expand its ingredients.
  const depth = new Map<string, number>();
  for (const t of targets) depth.set(t.itemId, Math.max(depth.get(t.itemId) ?? 0, 0));
  for (const id of order) {
    const d = depth.get(id) ?? 0;
    const variant = variantOf(id);
    if (!variant) continue;
    for (const ing of variant.ingredients) {
      depth.set(ing.itemId, Math.max(depth.get(ing.itemId) ?? 0, d + 1));
    }
  }

  // 4. Propagate demand along the topo order. Two quantities per node:
  //    - gross: the full bill of materials, ignoring owned stock. Always flows
  //      down so every reachable node has a quantity to display.
  //    - active: the demand that still needs doing — it flows only through steps
  //      not already covered by owned stock, and owned is subtracted at each node.
  //    A node whose active demand is fully covered is `satisfied` (greyed). It
  //    keeps its row but stops propagating active demand, so its whole sub-tree
  //    inherits zero active demand and greys out too (rather than disappearing).
  for (const t of targets) {
    gross.set(t.itemId, (gross.get(t.itemId) ?? 0) + t.quantity);
    active.set(t.itemId, (active.get(t.itemId) ?? 0) + t.quantity);
  }

  const crafts: CraftStep[] = [];
  const gather: GatherStep[] = [];
  const buySteps: BuyStep[] = [];

  for (const id of order) {
    const grossNeed = gross.get(id) ?? 0;
    if (grossNeed <= 0) continue; // never demanded at all
    const activeNeed = active.get(id) ?? 0;
    const have = owned[id] ?? 0;
    const need = Math.max(0, activeNeed - have);
    const satisfied = need <= 0;

    if (buys.has(id)) {
      buySteps.push({ itemId: id, needed: satisfied ? grossNeed : need, satisfied });
      continue;
    }

    const variant = variantOf(id);
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
    // Full BOM always flows down so a greyed sub-tree still shows quantities;
    // active demand flows only while this step is actually being crafted.
    const grossBatches = Math.ceil(grossNeed / variant.yield);
    for (const ing of variant.ingredients) {
      gross.set(ing.itemId, (gross.get(ing.itemId) ?? 0) + ing.count * grossBatches);
      if (!satisfied) {
        active.set(ing.itemId, (active.get(ing.itemId) ?? 0) + ing.count * batches);
      }
    }
  }

  // 5. Crafts are emitted consumers-first; reverse so dependencies come first.
  crafts.reverse();
  gather.sort((a, b) => a.itemId.localeCompare(b.itemId));
  buySteps.sort((a, b) => a.itemId.localeCompare(b.itemId));

  // 6. Surface alternative-path choices for the UI.
  const choices = [...nodes]
    .filter((id) => (ds.recipes[id]?.variants.length ?? 0) > 1)
    .map((id) => ({
      itemId: id,
      chosen: pickVariant(ds, id, pathChoices)!.recipeId,
      available: ds.recipes[id]!.variants.map((v) => v.recipeId),
    }));

  return { crafts, gather, buys: buySteps, choices, warnings };
}
