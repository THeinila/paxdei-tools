// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { plan, type Target } from "../engine/planner.ts";
import { DEFAULT_PREFS, type ViewPrefs } from "../engine/view.ts";
import { loadDataset } from "../lib/data.ts";
import { PlanView } from "./PlanView.tsx";

// The planner reads the dataset through lib/data.ts; swap the generated catalogue
// for the engine's fixture graph so these tests don't move with game updates.
vi.mock("../../../../data/dataset.json", async () => {
  const { fixture } = await import("../engine/testFixtures.ts");
  return { default: fixture() };
});

let ds: Awaited<ReturnType<typeof loadDataset>>;
beforeAll(async () => {
  ds = await loadDataset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** PlanView is controlled; hold the prefs the way ListEditor does. */
function Harness({
  targets,
  owned = {},
  initialPrefs = {},
}: {
  targets: Target[];
  owned?: Record<string, number>;
  initialPrefs?: Partial<ViewPrefs>;
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
      setOwned={() => {}}
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
