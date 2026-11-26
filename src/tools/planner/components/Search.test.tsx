// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadDataset } from "../lib/data.ts";
import { installFakeServer } from "../lib/testServer.ts";
import Planner from "../Planner.tsx";
import PlannerHome from "../PlannerHome.tsx";
import { Search } from "./Search.tsx";

// The engine fixture, plus names that only a correct ranking can order and enough
// filler to hit the result cap.
vi.mock("../../../../data/dataset.json", async () => {
  const { datasetModule, item } = await import("../engine/testFixtures.ts");
  return datasetModule((ds) => {
    ds.items.sapwood!.name = "SapWood"; // mixed case: matching must ignore it
    ds.items.plank = { ...ds.items.plank!, mainCategoryId: "buildingpieces" };
    ds.items.chair = { ...ds.items.chair!, mainCategoryId: "somethingnew" };
    ds.items.woodcutter = item("woodcutter", true);
    ds.items.ppwood = { ...item("ppwood", true), name: "ppwood extra long name" };
    for (let i = 1; i <= 45; i++) ds.items[`stone_${i}`] = { ...item(`stone_${i}`, true), name: `Stone ${i}` };
  });
});

beforeAll(async () => {
  await loadDataset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The list editor for one server list, against the shared fake backend.
 * Returns a function listing every PATCH body the editor has sent so far. */
function renderEditor() {
  const server = installFakeServer();
  const token = server.seed("AAAAAAAAAAAAAAAAAAAAAA", { name: "L" }); // 22 base64url chars, like a real token
  render(
    <MemoryRouter initialEntries={[`/planner/${token}`]}>
      <Routes>
        <Route path="/planner/:listId" element={<Planner />} />
      </Routes>
    </MemoryRouter>,
  );
  return () =>
    server.calls.filter((c) => c.method === "PATCH").map((c) => c.body!) as unknown as {
      state: { targets: { itemId: string; quantity: number }[] };
    }[];
}

const input = () => screen.getByPlaceholderText("Search items to craft…") as HTMLInputElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const resultNames = () => [...document.querySelectorAll(".search-row .search-name")].map((n) => n.textContent);

describe("Search", () => {
  it("SRCH-1: shows nothing for queries under 2 characters", () => {
    render(<Search onAdd={() => {}} />);
    type("w");
    expect(resultNames()).toEqual([]);
    expect(screen.queryByText(/No items match/)).toBeNull();
  });

  it("SRCH-2: matches names containing the query, ignoring case", () => {
    render(<Search onAdd={() => {}} />);
    type("WOOD");
    const names = resultNames();
    expect(names).toEqual(expect.arrayContaining(["wood", "woodcutter", "SapWood", "heartwood"]));
    expect(names).not.toContain("plank");
    expect(names.every((n) => n!.toLowerCase().includes("wood"))).toBe(true);
  });

  it("SRCH-3: ranks prefix matches first, then earlier matches, then shorter names", () => {
    render(<Search onAdd={() => {}} />);
    type("wood");
    expect(resultNames()).toEqual(["wood", "woodcutter", "ppwood extra long name", "SapWood", "heartwood"]);
  });

  it("SRCH-3: shows at most 40 results", () => {
    render(<Search onAdd={() => {}} />);
    type("stone");
    expect(resultNames()).toHaveLength(40);
  });

  it("SRCH-4: results show a readable category", () => {
    render(<Search onAdd={() => {}} />);
    const category = (q: string, name: string) => {
      type(q);
      const row = [...document.querySelectorAll(".search-row")].find((r) => r.querySelector(".search-name")!.textContent === name)!;
      return row.querySelector(".search-cat")!.textContent;
    };
    expect(category("plank", "plank")).toBe("Building pieces");
    expect(category("wood", "wood")).toBe("Raw material");
    expect(category("table", "table")).toBe("Item"); // craftable, no category
    expect(category("chair", "chair")).toBe("Somethingnew"); // an ID with no label yet
  });

  it("SRCH-5: each result's quantity starts at 1 and never goes below it", () => {
    render(<Search onAdd={() => {}} />);
    type("plank");
    const qty = screen.getByLabelText("Quantity of plank") as HTMLInputElement;
    expect(qty.value).toBe("1");
    for (const [entered, shown] of [["0", "1"], ["-3", "1"], ["", "1"], ["2.7", "2"], ["12", "12"]]) {
      fireEvent.change(qty, { target: { value: entered } });
      expect(qty.value).toBe(shown);
    }
  });

  it("SRCH-6: adding an item that is already a target increases its quantity", async () => {
    const patches = renderEditor();
    await screen.findByPlaceholderText("Search items to craft…");
    type("plank");
    fireEvent.click(screen.getByRole("button", { name: "Add 1 plank" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 plank" }));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]!.state.targets).toEqual([{ itemId: "plank", quantity: 2 }]);
    expect((document.querySelector(".target-qty") as HTMLInputElement).value).toBe("2");
  });

  it("SRCH-6: clicking a result or its + adds it once, with its quantity", () => {
    const onAdd = vi.fn();
    render(<Search onAdd={onAdd} />);
    type("plank");
    fireEvent.change(screen.getByLabelText("Quantity of plank"), { target: { value: "4" } });

    fireEvent.click(screen.getByRole("button", { name: "Add 4 plank" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenLastCalledWith("plank", 4);

    fireEvent.click(screen.getByText("plank"));
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onAdd).toHaveBeenLastCalledWith("plank", 4);
  });

  it("SRCH-7: says so when nothing matches", () => {
    render(<Search onAdd={() => {}} />);
    type("zzz");
    expect(screen.getByText("No items match “zzz”.")).toBeTruthy();
  });

  it("SRCH-8: Escape or an outside press closes the results; focus reopens them", () => {
    render(
      <>
        <Search onAdd={() => {}} />
        <p>outside</p>
      </>,
    );
    type("wood");
    expect(resultNames().length).toBeGreaterThan(0);

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(resultNames()).toEqual([]);
    fireEvent.focus(input());
    expect(resultNames().length).toBeGreaterThan(0);

    fireEvent.mouseDown(screen.getByText("outside"));
    expect(resultNames()).toEqual([]);
    fireEvent.mouseDown(input());
    expect(resultNames().length).toBeGreaterThan(0);
  });

  it("SRCH-9: takes focus in the list editor's search", async () => {
    renderEditor();
    const search = await screen.findByPlaceholderText("Search items to craft…");
    await waitFor(() => expect(document.activeElement).toBe(search)); // focus lands just after mount
  });

  it("SRCH-9: doesn't take focus on the directory page", () => {
    render(
      <MemoryRouter>
        <PlannerHome />
      </MemoryRouter>,
    );
    expect(document.activeElement).not.toBe(input());
  });
});
