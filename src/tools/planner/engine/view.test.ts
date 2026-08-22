import { describe, expect, it } from "vitest";
import { plan } from "./planner.ts";
import { fixture, item, variant } from "./testFixtures.ts";
import {
  DEFAULT_PREFS,
  PRESETS,
  buildPlanView,
  computeReady,
  formatStacks,
  stacksFor,
  type PresetId,
  type ViewPrefs,
} from "./view.ts";

const prefs = (patch: Partial<ViewPrefs> = {}): ViewPrefs => ({ ...DEFAULT_PREFS, ...patch });

/** The standard plan under test: table <- plank x4 + nail x10, plank <- wood x2,
 * nail <- iron_ore x1 (yield 5). Tiers: table 0, plank/nail 1. */
const tablePlan = (owned: Record<string, number> = {}) =>
  plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned });

const keys = (vm: ReturnType<typeof buildPlanView>) => vm.sections.map((s) => s.key);
const idsIn = (vm: ReturnType<typeof buildPlanView>, key: string) =>
  vm.sections.find((s) => s.key === key)?.rows.map((r) => r.itemId);

describe("buildPlanView presets", () => {
  it("groups by tier, deepest first, with gather leading", () => {
    const vm = buildPlanView(tablePlan(), fixture().items, prefs());
    expect(keys(vm)).toEqual(["gather", "craft:tier:1", "craft:tier:0"]);
    expect(idsIn(vm, "craft:tier:1")).toEqual(["nail", "plank"]);
    expect(idsIn(vm, "craft:tier:0")).toEqual(["table"]);
    expect(vm.sections[2]!.heading).toBe("Final products");
    expect(vm.sections[1]!.heading).toBe("Components · Tier 1");
  });

  it("flat keeps the engine's dependency-first order in one section", () => {
    const p = tablePlan();
    const vm = buildPlanView(p, fixture().items, prefs({ preset: "flat" }));
    expect(keys(vm)).toEqual(["gather", "craft:all"]);
    expect(idsIn(vm, "craft:all")).toEqual(p.crafts.map((c) => c.itemId));
  });

  it("groups by profession, unknown last, deepest tier first within a station", () => {
    const ds = fixture();
    ds.recipes.plank!.variants[0]!.profession = "Carpentry";
    ds.recipes.nail!.variants[0]!.profession = "Smithing";
    ds.recipes.table!.variants[0]!.profession = null;
    const vm = buildPlanView(
      plan(ds, [{ itemId: "table", quantity: 1 }]),
      ds.items,
      prefs({ preset: "profession" }),
    );
    expect(keys(vm)).toEqual(["gather", "craft:prof:Carpentry", "craft:prof:Smithing", "craft:prof:"]);
    expect(vm.sections[3]!.heading).toBe("Other");
    expect(idsIn(vm, "craft:prof:Carpentry")).toEqual(["plank"]);
  });

  it("renders an identical gather section under every preset", () => {
    const p = tablePlan();
    const gathers = PRESETS.map((preset: PresetId) => {
      const vm = buildPlanView(p, fixture().items, prefs({ preset }));
      return JSON.stringify(vm.sections.find((s) => s.key === "gather"));
    });
    expect(new Set(gathers).size).toBe(1);
    expect(idsIn(buildPlanView(p, fixture().items, prefs()), "gather")).toEqual(["iron_ore", "wood"]);
  });

  it("reports the same tier count whatever the grouping", () => {
    const p = tablePlan();
    const counts = PRESETS.map(
      (preset: PresetId) => buildPlanView(p, fixture().items, prefs({ preset })).totals.tierCount,
    );
    expect(counts).toEqual([2, 2, 2]);
  });

  it("handles an empty plan", () => {
    const vm = buildPlanView(plan(fixture(), []), fixture().items, prefs());
    expect(vm.sections).toEqual([]);
    expect(vm.totals).toMatchObject({ gatherLeft: 0, craftsLeft: 0, totalCrafts: 0, readyNow: 0 });
  });
});

describe("buildPlanView hideCompleted", () => {
  // owned plank x4 satisfies plank and prunes its whole wood sub-tree.
  const p = () => tablePlan({ plank: 4 });

  it("drops satisfied rows, counts them, and removes emptied sections", () => {
    const shown = buildPlanView(p(), fixture().items, prefs());
    const hidden = buildPlanView(p(), fixture().items, prefs({ hideCompleted: true }));

    expect(idsIn(shown, "craft:tier:1")).toEqual(["nail", "plank"]);
    expect(idsIn(hidden, "craft:tier:1")).toEqual(["nail"]);
    // wood is fully satisfied, so the gather section loses it entirely.
    expect(idsIn(shown, "gather")).toEqual(["iron_ore", "wood"]);
    expect(idsIn(hidden, "gather")).toEqual(["iron_ore"]);
    expect(hidden.totals.hiddenCount).toBe(2);
    expect(shown.totals.hiddenCount).toBe(0);
  });

  it("keeps `remaining` counting the section's real outstanding work", () => {
    const hidden = buildPlanView(p(), fixture().items, prefs({ hideCompleted: true }));
    expect(hidden.sections.find((s) => s.key === "craft:tier:1")!.remaining).toBe(1);
  });

  it("does not change ready flags", () => {
    const flags = (hideCompleted: boolean) =>
      buildPlanView(p(), fixture().items, prefs({ hideCompleted }))
        .sections.flatMap((s) => s.rows)
        .filter((r) => r.ready)
        .map((r) => r.itemId)
        .sort();
    expect(flags(true)).toEqual(flags(false));
  });
});

describe("buildPlanView collapsed", () => {
  it("flags the section but still builds its rows", () => {
    const vm = buildPlanView(tablePlan(), fixture().items, prefs({ collapsed: ["craft:tier:1"] }));
    const tier1 = vm.sections.find((s) => s.key === "craft:tier:1")!;
    expect(tier1.collapsed).toBe(true);
    expect(tier1.rows).toHaveLength(2);
    expect(vm.sections.find((s) => s.key === "gather")!.collapsed).toBe(false);
  });
});

describe("computeReady", () => {
  it("marks steps whose sub-crafts are all done", () => {
    const p = tablePlan();
    expect([...computeReady(p.crafts)].sort()).toEqual(["nail", "plank"]);
  });

  it("promotes the consumer once its ingredients are owned", () => {
    const p = tablePlan({ plank: 4, nail: 10 });
    expect([...computeReady(p.crafts)]).toEqual(["table"]);
  });

  it("marks nothing inside a cycle, and terminates", () => {
    const p = plan(fixture(), [{ itemId: "cyc_a", quantity: 1 }]);
    expect([...computeReady(p.crafts)]).toEqual([]);
  });

  it("can also treat unfinished gathers as blocking", () => {
    const p = tablePlan();
    const rawIds = p.gather.filter((g) => !g.satisfied).map((g) => g.itemId);
    expect([...computeReady(p.crafts, rawIds)]).toEqual([]);
  });

  it("treats a craft with only raw ingredients as ready by default", () => {
    const p = plan(fixture(), [{ itemId: "plank", quantity: 3 }]);
    expect([...computeReady(p.crafts)]).toEqual(["plank"]);
  });
});

describe("stacksFor / formatStacks", () => {
  it("returns null when there's nothing useful to say", () => {
    expect(stacksFor(500, null)).toBeNull();
    expect(stacksFor(500, 1)).toBeNull();
    expect(stacksFor(80, 100)).toBeNull();
    expect(stacksFor(100, 100)).toBeNull();
  });

  it("breaks an amount into stacks", () => {
    expect(stacksFor(250, 100)).toEqual({ size: 100, full: 2, remainder: 50 });
    expect(formatStacks(stacksFor(250, 100)!)).toBe("2 stacks + 50");
    expect(formatStacks(stacksFor(300, 100)!)).toBe("3 stacks");
    expect(formatStacks(stacksFor(120, 100)!)).toBe("1 stack + 20");
  });

  it("reaches rows through the injected item map", () => {
    const ds = fixture();
    ds.items.wood = item("wood", true, 100);
    const vm = buildPlanView(
      plan(ds, [{ itemId: "table", quantity: 30 }]),
      ds.items,
      prefs(),
    );
    const wood = vm.sections.find((s) => s.key === "gather")!.rows.find((r) => r.itemId === "wood")!;
    expect(wood.qty).toBe(240);
    expect(formatStacks(wood.stacks!)).toBe("2 stacks + 40");
  });
});

describe("row derivation", () => {
  it("carries the craft meta the UI and the export both need", () => {
    const ds = fixture();
    ds.items.deluxe = item("deluxe", false);
    ds.recipes.deluxe = {
      outputItemId: "deluxe",
      variants: [variant("r_deluxe", 1, [{ itemId: "plank", count: 1 }], "Joinery")],
    };
    const vm = buildPlanView(plan(ds, [{ itemId: "nail", quantity: 7 }]), ds.items, prefs());
    const nail = vm.sections.find((s) => s.kind === "craft")!.rows[0];
    expect(nail).toMatchObject({
      kind: "craft",
      itemId: "nail",
      qty: 7,
      crafts: 2,
      produced: 10,
      yield: 5,
      profession: "Test",
      recipeId: "r_nail",
      tier: 0,
    });
  });
});
