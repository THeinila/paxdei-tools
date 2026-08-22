import { describe, expect, it } from "vitest";
import { plan } from "./planner.ts";
import { fixture, item } from "./testFixtures.ts";
import { planToMarkdown } from "./markdown.ts";
import { DEFAULT_PREFS, buildPlanView, type ViewPrefs } from "./view.ts";

const prefs = (patch: Partial<ViewPrefs> = {}): ViewPrefs => ({ ...DEFAULT_PREFS, ...patch });

/** Build the export for the table plan under the given prefs. */
function md(patch: Partial<ViewPrefs> = {}, owned: Record<string, number> = {}, url?: string) {
  const ds = fixture();
  ds.items.wood = item("wood", true, 100);
  const p = plan(ds, [{ itemId: "table", quantity: 1 }], { owned });
  return planToMarkdown(buildPlanView(p, ds.items, prefs(patch)), { listName: "Anvil set", url });
}

describe("planToMarkdown", () => {
  it("renders the whole plan as a checklist", () => {
    expect(md()).toBe(
      [
        "# Anvil set",
        "",
        "**2 to gather · 7 crafts in 2 tiers · 2 ready now**",
        "",
        "## Gather (2)",
        "",
        "- [ ] iron_ore ×2",
        "- [ ] wood ×8",
        "",
        "## Components · Tier 1 (2)",
        "",
        "- [ ] nail ×10 — 2 crafts · Test — **ready**",
        "- [ ] plank ×4 — 4 crafts · Test — **ready**",
        "",
        "## Final products (1)",
        "",
        "- [ ] table ×1 — 1 craft · Test",
        "",
        "Made with the Pax Dei Crafting Planner",
        "",
      ].join("\n"),
    );
  });

  it("checks off satisfied rows and notes what was hidden", () => {
    const shown = md({}, { plank: 4 });
    expect(shown).toContain("- [x] plank ×4 — have enough");
    expect(shown).toContain("- [x] wood ×8");
    expect(shown).not.toContain("hidden._");

    const hidden = md({ hideCompleted: true }, { plank: 4 });
    expect(hidden).not.toContain("plank");
    expect(hidden).toContain("_2 completed items hidden._");
  });

  it("follows the chosen preset", () => {
    expect(md({ preset: "flat" })).toContain("## Craft (3)");
    expect(md({ preset: "flat" })).not.toContain("Components · Tier");
  });

  it("exports a collapsed section's rows anyway", () => {
    expect(md({ collapsed: ["craft:tier:1"] })).toContain("- [ ] plank ×4");
  });

  it("includes stack counts and the share link", () => {
    const out = md({}, {}, "https://example.test/planner/tok");
    expect(out).toContain("Made with the Pax Dei Crafting Planner · https://example.test/planner/tok");

    const big = planToMarkdown(
      (() => {
        const ds = fixture();
        ds.items.wood = item("wood", true, 100);
        return buildPlanView(plan(ds, [{ itemId: "table", quantity: 30 }]), ds.items, prefs());
      })(),
      { listName: "Big" },
    );
    expect(big).toContain("- [ ] wood ×240 — 2 stacks + 40");
  });

  it("falls back to a name for an untitled list", () => {
    const ds = fixture();
    const vm = buildPlanView(plan(ds, [{ itemId: "wood", quantity: 1 }]), ds.items, prefs());
    expect(planToMarkdown(vm, { listName: "" }).startsWith("# Untitled\n")).toBe(true);
  });
});
