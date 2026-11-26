// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDataset } from "./lib/data.ts";
import { listEntries } from "./lib/directory.ts";
import { installFakeServer } from "./lib/testServer.ts";
import Planner from "./Planner.tsx";

vi.mock("../../../data/dataset.json", async () => (await import("./engine/testFixtures.ts")).datasetModule());

const TOKEN = "tok_editor_00000000000"; // 22 characters, token-shaped
const HANDLE_KEY = "paxdei-planner:handle:v1";

let server: ReturnType<typeof installFakeServer>;

beforeAll(async () => {
  await loadDataset();
});

beforeEach(() => {
  vi.useFakeTimers();
  server = installFakeServer();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  Reflect.deleteProperty(navigator, "clipboard");
});

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

async function openEditor(path = `/planner/${TOKEN}`) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/planner" element={<p>directory page</p>} />
        <Route path="/planner/:listId" element={<Planner />} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
}

const rowFor = (name: string) =>
  screen.getAllByRole("listitem").filter((li) => li.querySelector(".row-name")?.textContent === name);
const title = () => document.querySelector(".tool-title-input") as HTMLInputElement;

describe("list editor", () => {
  it("SHR-3: opening a share link shows that list's definition and progress", async () => {
    server.seed(TOKEN, { name: "Anvils", targets: [{ itemId: "table", quantity: 2 }] }, { wood: [3, "Bob"] });
    await openEditor();
    expect(title().value).toBe("Anvils");
    const target = within(document.querySelector(".targets")!).getByText("table");
    expect(target).toBeTruthy();
    expect((document.querySelector(".target-qty") as HTMLInputElement).value).toBe("2");
    const wood = rowFor("wood")[0]!;
    expect((within(wood).getByLabelText(/have/) as HTMLInputElement).value).toBe("3");
  });

  it("SHR-4: Copy link copies the share link and confirms for 2 seconds", async () => {
    server.seed(TOKEN);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await settle();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/planner/${TOKEN}`);
    expect(screen.getByRole("button", { name: "Link copied!" })).toBeTruthy();
    await settle(1999);
    expect(screen.getByRole("button", { name: "Link copied!" })).toBeTruthy();
    await settle(1);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("SHR-5: a failed Copy link says so for 2 seconds", async () => {
    server.seed(TOKEN);
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await settle();
    expect(screen.getByRole("button", { name: "Copy failed" })).toBeTruthy();
    await settle(2000);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("EDT-9: clear asks first, and cancelling changes nothing", async () => {
    server.seed(TOKEN, { targets: [{ itemId: "table", quantity: 1 }], pathChoices: { charcoal: "r_charcoal_heartwood" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    await settle();
    expect(confirm).toHaveBeenCalledWith("Remove every target from this list, for everyone using it?");
    expect(server.list(TOKEN).state.targets).toHaveLength(1);
    expect(server.countOf("PATCH")).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    await settle();
    expect(server.list(TOKEN).state).toMatchObject({ targets: [], pathChoices: {} });
  });

  it("SHR-6: opening someone else's link adds it to my directory, then names it", async () => {
    server.seed(TOKEN, { name: "Guild order", targets: [{ itemId: "nail", quantity: 1 }] });
    server.hold("GET");
    await openEditor();
    expect(listEntries()).toMatchObject([{ shareToken: TOKEN, name: "Shared list" }]);
    server.release();
    await settle();
    expect(listEntries()).toMatchObject([{ shareToken: TOKEN, name: "Guild order", targetCount: 1 }]);
  });

  it("SHR-8: a list that doesn't exist says so, offers removal, and shows no editor", async () => {
    await openEditor(); // TOKEN was never created on the server
    expect(screen.getByRole("heading", { name: "This list doesn't exist any more" })).toBeTruthy();
    expect(screen.getByText(/deleted after 90 days with no changes/)).toBeTruthy();
    expect(document.querySelector(".tool-title-input")).toBeNull();
    expect(screen.queryByPlaceholderText("Search items to craft…")).toBeNull();
    const gets = server.countOf("GET");
    await settle(30_000);
    expect(server.countOf("GET")).toBe(gets); // stops polling a list that is gone

    expect(listEntries()).toMatchObject([{ name: "Shared list" }]); // adopted when opened, name untouched
    fireEvent.click(screen.getByRole("button", { name: "Remove from my lists" }));
    await settle();
    expect(listEntries()).toEqual([]);
    expect(screen.getByText("directory page")).toBeTruthy();
  });

  it("SHR-8: a list swept while it is open switches to the same page", async () => {
    server.seed(TOKEN, { name: "Soon gone" });
    await openEditor();
    expect(title().value).toBe("Soon gone");
    server.drop(TOKEN);
    await settle(12_000);
    expect(screen.getByRole("heading", { name: "This list doesn't exist any more" })).toBeTruthy();
    expect(document.querySelector(".tool-title-input")).toBeNull();
  });

  it("SHR-9: a route that is neither a known list nor token-shaped goes back to the directory", async () => {
    await openEditor("/planner/not a token!");
    expect(screen.getByText("directory page")).toBeTruthy();
  });

  it("PRG-8: rows name whoever last set them, with the time on hover", async () => {
    server.seed(TOKEN, { targets: [{ itemId: "table", quantity: 1 }] }, {
      wood: [3, "Bob"],
      nail: [0, "Bob"], // nothing held: no name
      iron_ore: [1, null], // no handle: no name
    });
    await openEditor();
    const by = within(rowFor("wood")[0]!).getByText("· Bob");
    expect(by.getAttribute("title")).toBe(`updated ${new Date(0).toLocaleString()}`);
    expect(rowFor("nail")[0]!.querySelector(".by-handle")).toBeNull();
    expect(rowFor("iron_ore")[0]!.querySelector(".by-handle")).toBeNull();
  });

  it("PRG-9: the display name can be set and changed, and later writes use it", async () => {
    server.seed(TOKEN, { targets: [{ itemId: "plank", quantity: 1 }] });
    const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce("Dana").mockReturnValueOnce("Eve");
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "set your name" }));
    expect(document.querySelector(".share-handle")!.textContent).toBe("Dana");

    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    expect(prompt).toHaveBeenLastCalledWith(expect.any(String), "Dana"); // pre-filled
    expect(document.querySelector(".share-handle")!.textContent).toBe("Eve");

    fireEvent.change(within(rowFor("wood")[0]!).getByLabelText(/have/), { target: { value: "2" } });
    await settle();
    expect(server.calls.at(-1)!.body).toMatchObject({ itemId: "wood", handle: "Eve" });
    expect(localStorage.getItem(HANDLE_KEY)).toBe("Eve");
  });

  it("RET-9: the footer states the retention window", async () => {
    server.seed(TOKEN);
    await openEditor();
    expect(document.querySelector(".tool-note")!.textContent).toContain(
      "Shared lists are deleted after 90 days with no changes",
    );
  });

  it("LST-5: renaming the title saves the shared name; blank becomes Untitled", async () => {
    server.seed(TOKEN, { name: "Old" });
    await openEditor();
    title().focus();
    fireEvent.change(title(), { target: { value: "New name" } });
    fireEvent.keyDown(title(), { key: "Enter" }); // Enter confirms by leaving the field
    await settle();
    expect(document.activeElement).not.toBe(title());
    expect(server.list(TOKEN).state.name).toBe("New name");

    fireEvent.change(title(), { target: { value: "   " } });
    fireEvent.blur(title());
    await settle();
    expect(server.list(TOKEN).state.name).toBe("Untitled");
    expect(title().value).toBe("Untitled");
  });

  it("EDT-8: the quantity field and remove take targets off; bad input counts as 0", async () => {
    server.seed(TOKEN, {
      targets: [
        { itemId: "table", quantity: 1 },
        { itemId: "chair", quantity: 1 },
        { itemId: "nail", quantity: 1 },
      ],
    });
    await openEditor();
    const qty = (i: number) => document.querySelectorAll(".target-qty")[i] as HTMLInputElement;
    fireEvent.change(qty(0), { target: { value: "2.7" } });
    await settle();
    expect(server.list(TOKEN).state.targets[0]).toEqual({ itemId: "table", quantity: 2 });

    fireEvent.change(qty(1), { target: { value: "-3" } });
    await settle();
    expect(server.list(TOKEN).state.targets.map((t) => t.itemId)).toEqual(["table", "nail"]);

    const nailRow = within(document.querySelector(".targets")!).getByText("nail").closest("li")!;
    fireEvent.click(within(nailRow).getByRole("button", { name: "remove" }));
    await settle();
    expect(server.list(TOKEN).state.targets.map((t) => t.itemId)).toEqual(["table"]);
  });
});
