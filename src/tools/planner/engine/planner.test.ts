import { describe, expect, it } from "vitest";
import { plan } from "./planner.ts";
import { fixture, item, variant } from "./testFixtures.ts";

// Maps cover only the still-needed steps; satisfied (fully-owned) rows are kept
// in the plan but greyed in the UI, so they're excluded here for clarity.
const gatherMap = (p: ReturnType<typeof plan>) =>
  Object.fromEntries(p.gather.filter((g) => !g.satisfied).map((g) => [g.itemId, g.needed]));
const craftMap = (p: ReturnType<typeof plan>) =>
  Object.fromEntries(
    p.crafts.filter((c) => !c.satisfied).map((c) => [c.itemId, { needed: c.needed, crafts: c.crafts }]),
  );
const satisfiedIds = (p: ReturnType<typeof plan>) => [
  ...p.gather.filter((g) => g.satisfied).map((g) => g.itemId),
  ...p.crafts.filter((c) => c.satisfied).map((c) => c.itemId),
];

// --- Tests -------------------------------------------------------------------

describe("plan", () => {
  it("PLAN-1: treats a raw target as a pure gather", () => {
    const p = plan(fixture(), [{ itemId: "wood", quantity: 5 }]);
    expect(p.crafts).toHaveLength(0);
    expect(gatherMap(p)).toEqual({ wood: 5 });
  });

  it("PLAN-2: expands a single craft and its raw inputs", () => {
    const p = plan(fixture(), [{ itemId: "plank", quantity: 3 }]);
    expect(craftMap(p)).toEqual({ plank: { needed: 3, crafts: 3 } });
    expect(gatherMap(p)).toEqual({ wood: 6 });
  });

  it("PLAN-3: rounds craft batches up by yield (nail yields 5)", () => {
    const p = plan(fixture(), [{ itemId: "nail", quantity: 7 }]);
    // need 7 -> ceil(7/5) = 2 batches -> produced 10 -> iron_ore 2
    expect(craftMap(p).nail).toEqual({ needed: 7, crafts: 2 });
    expect(gatherMap(p)).toEqual({ iron_ore: 2 });
  });

  it("PLAN-4: flattens a multi-level chain with dependency-first ordering", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }]);
    expect(gatherMap(p)).toEqual({ wood: 8, iron_ore: 2 }); // plank x4 -> wood 8; nail 10 -> 2 batches -> ore 2
    // table must come after plank and nail
    const ids = p.crafts.map((c) => c.itemId);
    expect(ids.indexOf("table")).toBeGreaterThan(ids.indexOf("plank"));
    expect(ids.indexOf("table")).toBeGreaterThan(ids.indexOf("nail"));
  });

  it("PLAN-5: aggregates a shared intermediate across two targets", () => {
    const p = plan(fixture(), [
      { itemId: "table", quantity: 1 },
      { itemId: "chair", quantity: 1 },
    ]);
    // plank: 4 + 2 = 6 -> wood 12 ; nail: 10 + 4 = 14 -> ceil(14/5)=3 batches -> ore 3
    expect(craftMap(p).plank).toEqual({ needed: 6, crafts: 6 });
    expect(craftMap(p).nail).toEqual({ needed: 14, crafts: 3 });
    expect(gatherMap(p)).toEqual({ wood: 12, iron_ore: 3 });
  });

  it("OWN-3: keeps a fully-owned raw leaf as a satisfied (greyed) row", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned: { wood: 8 } });
    expect(gatherMap(p)).toEqual({ iron_ore: 2 }); // wood no longer counts as to-gather
    expect(satisfiedIds(p)).toContain("wood"); // but the row is retained, greyed
    expect(craftMap(p).plank).toEqual({ needed: 4, crafts: 4 }); // still must craft planks
  });

  it("OWN-4: keeps a fully-owned intermediate and its whole sub-tree as satisfied", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned: { plank: 4 } });
    expect(craftMap(p).plank).toBeUndefined(); // no active plank craft
    expect(satisfiedIds(p)).toContain("plank"); // kept as a greyed row
    // The plank's inputs stay as greyed rows too (not deleted), showing the
    // quantity you'd have needed had you not already had the plank.
    expect(gatherMap(p).wood).toBeUndefined(); // not an active gather
    expect(satisfiedIds(p)).toContain("wood");
    expect(p.gather.find((g) => g.itemId === "wood")).toMatchObject({ needed: 8, satisfied: true });
    expect(gatherMap(p)).toEqual({ iron_ore: 2 }); // nails still needed
  });

  it("OWN-5: partially owned intermediate reduces but does not eliminate the branch", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned: { plank: 1 } });
    expect(craftMap(p).plank).toEqual({ needed: 3, crafts: 3 }); // 4 - 1 owned
    expect(gatherMap(p).wood).toBe(6);
  });

  it("ALT-1: uses the default (first) variant for an alternative-path item", () => {
    const p = plan(fixture(), [{ itemId: "charcoal", quantity: 100 }]);
    expect(gatherMap(p)).toEqual({ sapwood: 100 });
    expect(p.choices).toEqual([
      { itemId: "charcoal", chosen: "r_charcoal_sapwood", available: ["r_charcoal_sapwood", "r_charcoal_heartwood"] },
    ]);
  });

  it("ALT-2: honours an explicit alternative-path choice", () => {
    const p = plan(fixture(), [{ itemId: "charcoal", quantity: 100 }], {
      pathChoices: { charcoal: "r_charcoal_heartwood" },
    });
    expect(gatherMap(p)).toEqual({ heartwood: 100 });
  });

  it("PLAN-6: assigns tiers by depth (target = 0, ingredients deeper)", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }]);
    const tier = Object.fromEntries(p.crafts.map((c) => [c.itemId, c.tier]));
    expect(tier).toEqual({ table: 0, plank: 1, nail: 1 });
  });

  it("PLAN-6: places a component used at several depths in its deepest tier only", () => {
    // deluxe <- table x1 + plank x2 ; table <- plank x4 + nail x10
    const ds = fixture();
    ds.items.deluxe = item("deluxe", false);
    ds.recipes.deluxe = {
      outputItemId: "deluxe",
      variants: [
        variant("r_deluxe", 1, [
          { itemId: "table", count: 1 },
          { itemId: "plank", count: 2 },
        ]),
      ],
    };
    const p = plan(ds, [{ itemId: "deluxe", quantity: 1 }]);
    const plankSteps = p.crafts.filter((c) => c.itemId === "plank");
    expect(plankSteps).toHaveLength(1); // appears once, not per consumer
    // deluxe(0) -> table(1) -> plank(2): the deeper path wins over deluxe -> plank(1)
    expect(plankSteps[0]!.tier).toBe(2);
  });

  it("PLAN-7: guards against recipe cycles without hanging", () => {
    const p = plan(fixture(), [{ itemId: "cyc_a", quantity: 1 }]);
    expect(p.warnings.some((w) => /cycle/i.test(w))).toBe(true);
  });

  it("PLAN-7: keeps a step for every item in the cycle", () => {
    const p = plan(fixture(), [{ itemId: "cyc_a", quantity: 1 }]);
    expect(p.crafts.map((c) => c.itemId).sort()).toEqual(["cyc_a", "cyc_b"]);
  });

  it("OWN-3: a covered raw row keeps its full demand as its quantity", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned: { wood: 20 } });
    expect(p.gather.find((g) => g.itemId === "wood")).toEqual({ itemId: "wood", needed: 8, satisfied: true });
  });

  it("OWN-4: a fully owned intermediate has 0 crafts", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned: { plank: 4 } });
    expect(p.crafts.find((c) => c.itemId === "plank")).toMatchObject({ satisfied: true, crafts: 0, produced: 0 });
  });

  it("ALT-2: uses the chosen variant's yield and profession", () => {
    const ds = fixture();
    ds.recipes.charcoal!.variants[1]!.profession = "Charcoal Burning";
    const p = plan(ds, [{ itemId: "charcoal", quantity: 150 }], {
      pathChoices: { charcoal: "r_charcoal_heartwood" },
    });
    expect(p.crafts.find((c) => c.itemId === "charcoal")).toMatchObject({
      recipeId: "r_charcoal_heartwood",
      yield: 100,
      crafts: 2,
      profession: "Charcoal Burning",
    });
    expect(gatherMap(p)).toEqual({ heartwood: 200 });
  });

  it("PLAN-8: merges a target that is also another target's ingredient into one step", () => {
    // table needs plank x4; plank is also a target in its own right
    const p = plan(fixture(), [
      { itemId: "table", quantity: 1 },
      { itemId: "plank", quantity: 3 },
    ]);
    expect(p.crafts.filter((c) => c.itemId === "plank")).toHaveLength(1);
    expect(craftMap(p).plank).toEqual({ needed: 7, crafts: 7 });
    expect(gatherMap(p).wood).toBe(14);
  });

  it("OWN-2: subtracts a partial have amount from a raw material", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned: { wood: 3 } });
    expect(gatherMap(p).wood).toBe(5); // demand 8 - have 3
    expect(satisfiedIds(p)).not.toContain("wood");
  });

  it("OWN-6: keeps an ingredient active when only one of its consumers is owned", () => {
    // Both target orders, so a "zero the owned branch's sub-tree" bug can't hide
    // behind whichever consumer the engine happens to visit last.
    for (const targets of [
      [{ itemId: "table", quantity: 1 }, { itemId: "chair", quantity: 1 }],
      [{ itemId: "chair", quantity: 1 }, { itemId: "table", quantity: 1 }],
    ]) {
      const p = plan(fixture(), targets, { owned: { table: 1 } });
      expect(satisfiedIds(p)).toContain("table");
      expect(craftMap(p).plank).toEqual({ needed: 2, crafts: 2 }); // chair's share only
      expect(craftMap(p).nail).toEqual({ needed: 4, crafts: 1 });
      expect(gatherMap(p)).toEqual({ wood: 4, iron_ore: 1 });
    }
  });

  it("OWN-7: never produces a negative quantity, however much is owned", () => {
    const p = plan(
      fixture(),
      [
        { itemId: "table", quantity: 1 },
        { itemId: "chair", quantity: 2 },
      ],
      { owned: { wood: 1000, plank: 3, nail: 500, iron_ore: 9, chair: 7 } },
    );
    for (const c of p.crafts) {
      expect(c.needed).toBeGreaterThanOrEqual(0);
      expect(c.crafts).toBeGreaterThanOrEqual(0);
      expect(c.produced).toBeGreaterThanOrEqual(0);
    }
    for (const g of p.gather) expect(g.needed).toBeGreaterThanOrEqual(0);
    expect(p.crafts.find((c) => c.itemId === "nail")).toMatchObject({ satisfied: true, crafts: 0 });
  });

  it("ALT-5: falls back to the first variant when the chosen recipe no longer exists", () => {
    const p = plan(fixture(), [{ itemId: "charcoal", quantity: 100 }], {
      pathChoices: { charcoal: "r_charcoal_removed_upstream" },
    });
    expect(craftMap(p).charcoal).toEqual({ needed: 100, crafts: 2 });
    expect(gatherMap(p)).toEqual({ sapwood: 100 });
  });
});
