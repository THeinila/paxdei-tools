// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { plan, type Target } from "../engine/planner.ts";
import { DEFAULT_PREFS, type ViewPrefs } from "../engine/view.ts";
import { loadDataset, sourceUrl } from "../lib/data.ts";
import { PlanView } from "./PlanView.tsx";

// The planner reads the dataset through lib/data.ts; swap the generated catalogue
// for the engine's fixture graph so these tests don't move with game updates.
vi.mock("../../../../data/dataset.json", async () =>
  (await import("../engine/testFixtures.ts")).datasetModule((ds) => {
    ds.items.wood = { ...ds.items.wood!, maxStackSize: 100 };
  }),
);

let ds: Awaited<ReturnType<typeof loadDataset>>;
beforeAll(async () => {
  ds = await loadDataset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard"); // set per test; never leak a fake
});

/** PlanView is controlled; hold the prefs the way ListEditor does. */
function Harness({
  targets,
  owned = {},
  initialPrefs = {},
  setOwned = () => {},
}: {
  targets: Target[];
  owned?: Record<string, number>;
  initialPrefs?: Partial<ViewPrefs>;
  setOwned?: (itemId: string, qty: number) => void;
}) {
  const [prefs, setPrefs] = useState<ViewPrefs>({ ...DEFAULT_PREFS, ...initialPrefs });
  return (
    <PlanView
      result={plan(ds, targets, { owned })}
      owned={owned}
      pathChoices={{}}
      progress={{}}
      prefs={prefs}
      onPrefsChange={(patch) => setPrefs((p) => ({ ...p, ...patch }))}
      listName="My list"
      shareUrl="https://example.test/planner/tok"
      setOwned={setOwned}
      setPathChoice={() => {}}
    />
  );
}

const rowFor = (name: string) =>
  screen.getAllByRole("listitem").find((li) => li.querySelector(".row-name")?.textContent === name)!;

describe("PlanView", () => {
  it("PLAN-9: an empty list shows a hint instead of a plan", () => {
    render(<Harness targets={[]} />);
    expect(screen.getByText("Add items above to see what to gather and craft.")).toBeTruthy();
    expect(screen.queryByText(/^Gather/)).toBeNull();
  });

  it("OWN-1: every gather and craft row has a have input showing the stored amount", () => {
    render(<Harness targets={[{ itemId: "table", quantity: 1 }]} owned={{ wood: 3 }} />);
    for (const name of ["wood", "iron_ore", "plank", "nail", "table"]) {
      const input = within(rowFor(name)).getByLabelText(/have/) as HTMLInputElement;
      expect(input.type).toBe("number");
      if (name === "wood") expect(input.value).toBe("3");
      else {
        expect(input.value).toBe("");
        expect(input.placeholder).toBe("0");
      }
    }
  });

  it("ALT-3: offers a recipe choice only on items with more than one variant", () => {
    render(
      <Harness
        targets={[
          { itemId: "charcoal", quantity: 100 },
          { itemId: "plank", quantity: 1 },
        ]}
      />,
    );
    const select = within(rowFor("charcoal")).getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("r_charcoal_sapwood");
    expect([...select.options].map((o) => o.textContent)).toEqual(["sapwood×50", "heartwood×100"]);
    expect(within(rowFor("plank")).queryByRole("combobox")).toBeNull();
  });

  it("LAY-9: a plan with no gather steps says so", () => {
    // The cycle fixture is all crafts and no raw materials.
    render(<Harness targets={[{ itemId: "cyc_a", quantity: 1 }]} />);
    expect(screen.getByRole("heading", { name: "Gather (0)" })).toBeTruthy();
    expect(screen.getByText("Nothing to gather.")).toBeTruthy();
  });

  it("LAY-9: hiding every completed row leaves empty-state messages", () => {
    render(
      <Harness
        targets={[{ itemId: "table", quantity: 1 }]}
        owned={{ table: 1 }}
        initialPrefs={{ hideCompleted: true }}
      />,
    );
    expect(screen.getByText("Nothing to gather.")).toBeTruthy();
    expect(screen.getByText("Nothing left to craft.")).toBeTruthy();
  });

  it("LAY-6: clicking a section heading collapses and expands it", () => {
    render(<Harness targets={[{ itemId: "table", quantity: 1 }]} />);
    const toggle = screen.getByRole("button", { name: /Gather \(2\)/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toContain("▾");
    expect(screen.queryByText("iron_ore")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("▸");
    expect(screen.queryByText("iron_ore")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText("iron_ore")).toBeTruthy();
  });

  it("PLAN-7: shows the cycle warning above the plan", () => {
    render(<Harness targets={[{ itemId: "cyc_a", quantity: 1 }]} />);
    expect(
      screen.getByText("⚠ Recipe cycle detected; the steps involved may be listed in arbitrary order."),
    ).toBeTruthy();
  });

  it("OWN-4: a fully owned craft row says \"have enough\"", () => {
    render(<Harness targets={[{ itemId: "table", quantity: 1 }]} owned={{ plank: 4 }} />);
    expect(within(rowFor("plank")).getByText("have enough")).toBeTruthy();
    expect(rowFor("plank").className).toContain("satisfied");
    expect(within(rowFor("nail")).queryByText("have enough")).toBeNull();
  });

  it("RDY-1: ready crafts carry a badge, blocked ones don't", () => {
    render(<Harness targets={[{ itemId: "table", quantity: 1 }]} />);
    expect(within(rowFor("plank")).getByText("ready")).toBeTruthy();
    expect(within(rowFor("nail")).getByText("ready")).toBeTruthy();
    expect(within(rowFor("table")).queryByText("ready")).toBeNull();
  });

  it("RDY-7: rows over one stack show the stack breakdown", () => {
    render(<Harness targets={[{ itemId: "table", quantity: 30 }]} />); // wood 240, stack 100
    expect(within(rowFor("wood")).getByText("2 stacks + 40")).toBeTruthy();
    expect(within(rowFor("iron_ore")).queryByText(/stack/)).toBeNull();
  });

  it("LAY-2: the flat preset heads its one section \"Craft (n)\"", () => {
    render(
      <Harness
        targets={[{ itemId: "table", quantity: 1 }]}
        owned={{ nail: 10 }}
        initialPrefs={{ preset: "flat" }}
      />,
    );
    expect(screen.getByRole("button", { name: /Craft \(2\)/ })).toBeTruthy(); // nail is satisfied
    expect(screen.queryByText(/Components · Tier/)).toBeNull();
  });

  it("LAY-5: the toolbar counts hidden rows, and says nothing when none are hidden", () => {
    render(<Harness targets={[{ itemId: "table", quantity: 1 }]} owned={{ plank: 4 }} />);
    expect(screen.queryByText(/hidden$/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide completed" }));
    expect(screen.getByText("2 hidden")).toBeTruthy(); // plank and its wood
    expect(screen.queryByText("plank")).toBeNull();
  });

  it("TIP-8: gather rows link to their gaming.tools page in a new tab, without a referrer", () => {
    render(<Harness targets={[{ itemId: "table", quantity: 1 }]} />);
    const link = within(rowFor("wood")).getByRole("link", { name: "where?" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://paxdei.gaming.tools/items/wood"); // no category → "items"
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noreferrer");
    expect(sourceUrl({ ...ds.items.wood!, mainCategoryId: "materials" })).toBe(
      "https://paxdei.gaming.tools/materials/wood",
    );
    expect(within(rowFor("plank")).queryByRole("link", { name: "where?" })).toBeNull();
  });

  it("PLAN-10: the summary counts only tiers with crafts left", () => {
    render(<Harness targets={[{ itemId: "table", quantity: 1 }]} owned={{ table: 1 }} />);
    expect(document.querySelector(".summary")!.textContent).toContain("0 crafts in 0 tiers");
  });

  it("OWN-8: have amounts are whole numbers, at least 0", () => {
    const setOwned = vi.fn();
    render(<Harness targets={[{ itemId: "table", quantity: 1 }]} setOwned={setOwned} />);
    const input = within(rowFor("wood")).getByLabelText(/have/);
    for (const [entered, saved] of [["2.7", 2], ["-1", 0], ["", 0], ["5", 5]] as const) {
      fireEvent.change(input, { target: { value: entered } });
      expect(setOwned).toHaveBeenLastCalledWith("wood", saved);
    }
  });

  it("MDX-10: a failed copy says so for 2 seconds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness targets={[{ itemId: "table", quantity: 1 }]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));
    });
    expect(screen.getByRole("button", { name: "Copy failed" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("button", { name: "Copy as Markdown" })).toBeTruthy();
  });

  it("MDX-9: the copy button confirms for 2 seconds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness targets={[{ itemId: "table", quantity: 1 }]} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toMatch(/^# My list\n/);
    expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy();

    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("button", { name: "Copy as Markdown" })).toBeTruthy();
  });
});
