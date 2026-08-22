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
  it("treats a raw target as a pure gather", () => {
    const p = plan(fixture(), [{ itemId: "wood", quantity: 5 }]);
    expect(p.crafts).toHaveLength(0);
    expect(gatherMap(p)).toEqual({ wood: 5 });
  });

  it("expands a single craft and its raw inputs", () => {
    const p = plan(fixture(), [{ itemId: "plank", quantity: 3 }]);
    expect(craftMap(p)).toEqual({ plank: { needed: 3, crafts: 3 } });
    expect(gatherMap(p)).toEqual({ wood: 6 });
  });

  it("rounds craft batches up by yield (nail yields 5)", () => {
    const p = plan(fixture(), [{ itemId: "nail", quantity: 7 }]);
    // need 7 -> ceil(7/5) = 2 batches -> produced 10 -> iron_ore 2
    expect(craftMap(p).nail).toEqual({ needed: 7, crafts: 2 });
    expect(gatherMap(p)).toEqual({ iron_ore: 2 });
  });

  it("flattens a multi-level chain with dependency-first ordering", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }]);
    expect(gatherMap(p)).toEqual({ wood: 8, iron_ore: 2 }); // plank x4 -> wood 8; nail 10 -> 2 batches -> ore 2
    // table must come after plank and nail
    const ids = p.crafts.map((c) => c.itemId);
    expect(ids.indexOf("table")).toBeGreaterThan(ids.indexOf("plank"));
    expect(ids.indexOf("table")).toBeGreaterThan(ids.indexOf("nail"));
  });

  it("aggregates a shared intermediate across two targets", () => {
    const p = plan(fixture(), [
      { itemId: "table", quantity: 1 },
      { itemId: "chair", quantity: 1 },
    ]);
    // plank: 4 + 2 = 6 -> wood 12 ; nail: 10 + 4 = 14 -> ceil(14/5)=3 batches -> ore 3
    expect(craftMap(p).plank).toEqual({ needed: 6, crafts: 6 });
    expect(craftMap(p).nail).toEqual({ needed: 14, crafts: 3 });
    expect(gatherMap(p)).toEqual({ wood: 12, iron_ore: 3 });
  });

  it("keeps a fully-owned raw leaf as a satisfied (greyed) row", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned: { wood: 8 } });
    expect(gatherMap(p)).toEqual({ iron_ore: 2 }); // wood no longer counts as to-gather
    expect(satisfiedIds(p)).toContain("wood"); // but the row is retained, greyed
    expect(craftMap(p).plank).toEqual({ needed: 4, crafts: 4 }); // still must craft planks
  });

  it("keeps a fully-owned intermediate and its whole sub-tree as satisfied", () => {
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

  it("partially owned intermediate reduces but does not eliminate the branch", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }], { owned: { plank: 1 } });
    expect(craftMap(p).plank).toEqual({ needed: 3, crafts: 3 }); // 4 - 1 owned
    expect(gatherMap(p).wood).toBe(6);
  });

  it("uses the default (first) variant for an alternative-path item", () => {
    const p = plan(fixture(), [{ itemId: "charcoal", quantity: 100 }]);
    expect(gatherMap(p)).toEqual({ sapwood: 100 });
    expect(p.choices).toEqual([
      { itemId: "charcoal", chosen: "r_charcoal_sapwood", available: ["r_charcoal_sapwood", "r_charcoal_heartwood"] },
    ]);
  });

  it("honours an explicit alternative-path choice", () => {
    const p = plan(fixture(), [{ itemId: "charcoal", quantity: 100 }], {
      pathChoices: { charcoal: "r_charcoal_heartwood" },
    });
    expect(gatherMap(p)).toEqual({ heartwood: 100 });
  });

  it("assigns tiers by depth (target = 0, ingredients deeper)", () => {
    const p = plan(fixture(), [{ itemId: "table", quantity: 1 }]);
    const tier = Object.fromEntries(p.crafts.map((c) => [c.itemId, c.tier]));
    expect(tier).toEqual({ table: 0, plank: 1, nail: 1 });
  });

  it("places a component used at several depths in its deepest tier only", () => {
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

  it("guards against recipe cycles without hanging", () => {
    const p = plan(fixture(), [{ itemId: "cyc_a", quantity: 1 }]);
    expect(p.warnings.some((w) => /cycle/i.test(w))).toBe(true);
  });
});
