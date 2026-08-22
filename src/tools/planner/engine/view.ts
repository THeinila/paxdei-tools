/** Plan → view model: grouping, ordering, filtering and row derivation.
 *
 * Inspired by FFXIV Teamcraft's layout system, cut down to three presets. The
 * point of keeping this out of `PlanView.tsx` is twofold: it's unit-testable
 * without a DOM library, and the Markdown export renders from the same view
 * model as the screen, so the two can't drift.
 *
 * Pure: the `items` map is injected rather than imported from `lib/data.ts`, so
 * this module never touches the dataset or the browser. */
import type { Item } from "./types.ts";
import type { CraftStep, Plan } from "./planner.ts";

export const PRESETS = ["tiered", "flat", "profession"] as const;
export type PresetId = (typeof PRESETS)[number];

export const PRESET_LABELS: Record<PresetId, string> = {
  tiered: "Tiered",
  flat: "Flat",
  profession: "By profession",
};

export interface ViewPrefs {
  preset: PresetId;
  /** Drop rows whose owned stock already covers them. */
  hideCompleted: boolean;
  /** Section keys the user has collapsed (see `PlanSection.key`). */
  collapsed: string[];
}

export const DEFAULT_PREFS: ViewPrefs = { preset: "tiered", hideCompleted: false, collapsed: [] };

export interface StackInfo {
  /** The item's maxStackSize; always > 1 when this object exists. */
  size: number;
  full: number;
  remainder: number;
}

export interface PlanRow {
  kind: "gather" | "craft";
  itemId: string;
  /** Resolved display name — used for sorting and for the Markdown export. */
  name: string;
  /** The number rendered as ×qty: the step's `needed`. */
  qty: number;
  satisfied: boolean;
  /** Craft-only; 0 on gather rows. */
  crafts: number;
  produced: number;
  yield: number;
  profession: string | null;
  recipeId: string | null;
  tier: number | null;
  /** Nothing unfinished in the plan blocks this step. Always false for gather
   * rows and for satisfied rows. */
  ready: boolean;
  /** null when the item has no meaningful stack size or the amount fits one stack. */
  stacks: StackInfo | null;
}

export interface PlanSection {
  /** Stable, preset-scoped key used to persist collapse state:
   * "gather" | "craft:all" | "craft:tier:<n>" | "craft:prof:<profession|>". */
  key: string;
  kind: "gather" | "craft";
  heading: string;
  rows: PlanRow[];
  /** Rows in this section still to do. */
  remaining: number;
  /** Satisfied rows removed by `hideCompleted` (0 when it's off). */
  hiddenCount: number;
  collapsed: boolean;
}

export interface PlanViewModel {
  preset: PresetId;
  sections: PlanSection[];
  warnings: string[];
  totals: {
    gatherLeft: number;
    craftsLeft: number;
    /** Sum of CraftStep.crafts — how many times a bench is used in total. */
    totalCrafts: number;
    /** Distinct dependency tiers. Preset-independent: the summary must read the
     * same however the rows happen to be grouped. */
    tierCount: number;
    readyNow: number;
    hiddenCount: number;
  };
}

// --- Ready -------------------------------------------------------------------

/**
 * Which craft steps nothing in the plan blocks — i.e. every ingredient is either
 * already covered by owned stock or isn't itself an unfinished craft.
 *
 * Two linear passes over the step list, O(N + E): no recursion and no traversal,
 * so it can't hang or overflow however the recipe graph is shaped. A cycle simply
 * leaves both of its members blocked by each other — no badge, never a wrong one.
 *
 * `extraBlockers` lets a caller also treat unfinished *gather* rows as blocking,
 * for a stricter "you can literally do this now" reading.
 */
export function computeReady(crafts: CraftStep[], extraBlockers?: Iterable<string>): Set<string> {
  const blocked = new Set<string>(extraBlockers ?? []);
  for (const c of crafts) if (!c.satisfied) blocked.add(c.itemId);

  const ready = new Set<string>();
  for (const c of crafts) {
    if (c.satisfied) continue;
    if (c.ingredients.every((ing) => !blocked.has(ing.itemId))) ready.add(c.itemId);
  }
  return ready;
}

// --- Stacks ------------------------------------------------------------------

/** Stack breakdown for an amount, or null when it isn't worth showing. */
export function stacksFor(qty: number, maxStackSize: number | null): StackInfo | null {
  if (maxStackSize == null || maxStackSize <= 1) return null;
  if (qty <= maxStackSize) return null; // one stack or less: don't clutter the row
  return {
    size: maxStackSize,
    full: Math.floor(qty / maxStackSize),
    remainder: qty % maxStackSize,
  };
}

/** "2 stacks + 50", "3 stacks", "1 stack + 20". */
export function formatStacks(s: StackInfo): string {
  const stacks = `${s.full} stack${s.full === 1 ? "" : "s"}`;
  return s.remainder > 0 ? `${stacks} + ${s.remainder}` : stacks;
}

// --- View model --------------------------------------------------------------

function nameOf(items: Record<string, Item>, itemId: string): string {
  return items[itemId]?.name ?? itemId;
}

function byName(a: PlanRow, b: PlanRow): number {
  return a.name.localeCompare(b.name);
}

/** Assemble a section, applying hideCompleted and the collapse flag. */
function section(
  key: string,
  kind: "gather" | "craft",
  heading: string,
  rows: PlanRow[],
  prefs: ViewPrefs,
  collapsed: Set<string>,
): PlanSection {
  const kept = prefs.hideCompleted ? rows.filter((r) => !r.satisfied) : rows;
  return {
    key,
    kind,
    heading,
    rows: kept,
    remaining: rows.filter((r) => !r.satisfied).length,
    hiddenCount: rows.length - kept.length,
    collapsed: collapsed.has(key),
  };
}

export function buildPlanView(
  plan: Plan,
  items: Record<string, Item>,
  prefs: ViewPrefs,
): PlanViewModel {
  const collapsed = new Set(prefs.collapsed);

  // Readiness is computed over the FULL step list, before any hide-completed
  // filtering — otherwise hiding a row would silently unblock its consumers.
  const ready = computeReady(plan.crafts);

  const gatherRows: PlanRow[] = plan.gather
    .map((g) => ({
      kind: "gather" as const,
      itemId: g.itemId,
      name: nameOf(items, g.itemId),
      qty: g.needed,
      satisfied: g.satisfied,
      crafts: 0,
      produced: 0,
      yield: 0,
      profession: null,
      recipeId: null,
      tier: null,
      ready: false,
      stacks: stacksFor(g.needed, items[g.itemId]?.maxStackSize ?? null),
    }))
    .sort(byName); // the engine sorts gather by raw item id, which reads randomly

  const craftRows: PlanRow[] = plan.crafts.map((c) => ({
    kind: "craft" as const,
    itemId: c.itemId,
    name: nameOf(items, c.itemId),
    qty: c.needed,
    satisfied: c.satisfied,
    crafts: c.crafts,
    produced: c.produced,
    yield: c.yield,
    profession: c.profession,
    recipeId: c.recipeId,
    tier: c.tier,
    ready: ready.has(c.itemId),
    stacks: stacksFor(c.needed, items[c.itemId]?.maxStackSize ?? null),
  }));

  // Gather is one section under every preset: GatherStep carries neither a tier
  // nor a profession, so there is nothing to group it by, and inventing a
  // pseudo-profession would only add a heading that says nothing. Keeping it
  // identical across presets also makes its collapse state portable.
  const sections: PlanSection[] = [
    section("gather", "gather", "Gather", gatherRows, prefs, collapsed),
  ];

  if (prefs.preset === "flat") {
    // Engine order verbatim: plan.crafts is already dependency-first, so a flat
    // list reads "do these top to bottom". Re-sorting would destroy that.
    sections.push(section("craft:all", "craft", "Craft", craftRows, prefs, collapsed));
  } else if (prefs.preset === "profession") {
    const byProf = new Map<string, PlanRow[]>();
    for (const r of craftRows) {
      const key = r.profession ?? "";
      const arr = byProf.get(key) ?? [];
      arr.push(r);
      byProf.set(key, arr);
    }
    const groups = [...byProf.entries()].sort(([a], [b]) => {
      if (a === "") return 1; // the unknown-profession bucket trails
      if (b === "") return -1;
      return a.localeCompare(b);
    });
    for (const [prof, rows] of groups) {
      // Within one station, deepest components first — same logic as the tiers.
      const sorted = [...rows].sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) || byName(a, b));
      sections.push(
        section(`craft:prof:${prof}`, "craft", prof || "Other", sorted, prefs, collapsed),
      );
    }
  } else {
    const byTier = new Map<number, PlanRow[]>();
    for (const r of craftRows) {
      const arr = byTier.get(r.tier ?? 0) ?? [];
      arr.push(r);
      byTier.set(r.tier ?? 0, arr);
    }
    const groups = [...byTier.entries()].sort((a, b) => b[0] - a[0]); // deepest first
    for (const [tier, rows] of groups) {
      const sorted = [...rows].sort(
        (a, b) => (a.profession ?? "").localeCompare(b.profession ?? "") || byName(a, b),
      );
      sections.push(
        section(
          `craft:tier:${tier}`,
          "craft",
          tier === 0 ? "Final products" : `Components · Tier ${tier}`,
          sorted,
          prefs,
          collapsed,
        ),
      );
    }
  }

  // A section emptied by hideCompleted drops out of the page, but its hidden
  // rows still show up in the total so the user knows they're there.
  const hiddenCount = sections.reduce((n, s) => n + s.hiddenCount, 0);
  const kept = sections.filter((s) => s.rows.length > 0);

  return {
    preset: prefs.preset,
    sections: kept,
    warnings: plan.warnings,
    totals: {
      gatherLeft: plan.gather.filter((g) => !g.satisfied).length,
      craftsLeft: plan.crafts.filter((c) => !c.satisfied).length,
      totalCrafts: plan.crafts.reduce((n, c) => n + c.crafts, 0),
      tierCount: new Set(plan.crafts.map((c) => c.tier)).size,
      readyNow: ready.size,
      hiddenCount,
    },
  };
}
