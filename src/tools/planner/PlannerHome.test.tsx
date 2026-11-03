// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDataset } from "./lib/data.ts";
import { listEntries, type ListEntry } from "./lib/directory.ts";
import { installFakeServer } from "./lib/testServer.ts";
import Planner from "./Planner.tsx";
import PlannerHome from "./PlannerHome.tsx";

vi.mock("../../../data/dataset.json", async () => (await import("./engine/testFixtures.ts")).datasetModule());

const INDEX_KEY = "paxdei-planner:lists:v1";
const NOW = new Date("2026-11-03T12:00:00.000Z");

let server: ReturnType<typeof installFakeServer>;

beforeAll(async () => {
  await loadDataset();
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  server = installFakeServer();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function entry(id: string, patch: Partial<ListEntry> = {}): ListEntry {
  return { id, name: id, kind: "shared", shareToken: `tok_${id}`.padEnd(22, "0"), targetCount: 0, createdAt: ago(0), updatedAt: ago(0), ...patch };
}
const seedDirectory = (entries: ListEntry[]) => localStorage.setItem(INDEX_KEY, JSON.stringify(entries));

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

async function openDirectory(path = "/planner") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/planner" element={<PlannerHome />} />
        <Route path="/planner/:listId" element={<Planner />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  await settle();
}

const where = () => screen.getByTestId("where").textContent;
const cards = () => [...document.querySelectorAll(".tool-grid:not(.archived) > .list-card:not(.archived)")];
const cardNames = () => cards().map((c) => c.querySelector(".list-card-name")!.textContent);
const cardFor = (name: string) => cards().find((c) => c.querySelector(".list-card-name")!.textContent === name)!;

describe("list directory", () => {
  it("LST-1: shows this browser's lists, newest first, with name, item count and age", async () => {
    seedDirectory([
      entry("a", { name: "Week", targetCount: 1, updatedAt: ago(30_000) }),
      entry("b", { name: "", targetCount: 3, updatedAt: ago(90_000) }), // past the 1-minute "just now"
      entry("c", { name: "Old", targetCount: 0, updatedAt: ago(3 * 3_600_000) }),
      entry("d", { name: "Older", targetCount: 2, updatedAt: ago(2 * 86_400_000) }),
    ]);
    await openDirectory();
    expect(cardNames()).toEqual(["Week", "Untitled", "Old", "Older"]);
    expect(cards().map((c) => c.querySelector(".list-card-meta")!.textContent)).toEqual([
      "1 item · just now",
      "3 items · 2m ago",
      "0 items · 3h ago",
      "2 items · 2d ago",
    ]);
  });

  it("LST-2: an empty directory invites the first list", async () => {
    await openDirectory();
    expect(screen.getByText("No lists yet. Create one to start planning your crafts.")).toBeTruthy();
  });

  it("LST-12: a corrupt or unreadable directory shows as empty", async () => {
    localStorage.setItem(INDEX_KEY, "{not json");
    await openDirectory();
    expect(screen.getByText("No lists yet. Create one to start planning your crafts.")).toBeTruthy();
    cleanup();
    localStorage.setItem(INDEX_KEY, JSON.stringify({ not: "an array" }));
    await openDirectory();
    expect(screen.getByText("No lists yet. Create one to start planning your crafts.")).toBeTruthy();
  });

  it("LST-3: Create a new list makes an Untitled server list and opens it", async () => {
    await openDirectory();
    server.hold("POST");
    fireEvent.click(screen.getByRole("button", { name: "+ Create a new list" }));
    await settle();
    const busy = screen.getByRole("button", { name: "Working…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    server.release();
    await settle();
    const [created] = listEntries();
    expect(created).toMatchObject({ name: "Untitled", kind: "shared" });
    expect(server.list(created!.shareToken!).state.name).toBe("Untitled");
    expect(where()).toBe(`/planner/${created!.shareToken}`);
  });

  it("LST-4: picking an item from the directory's search starts a list holding it", async () => {
    await openDirectory();
    fireEvent.change(screen.getByPlaceholderText("Search items to craft…"), { target: { value: "plank" } });
    fireEvent.change(screen.getByLabelText("Quantity of plank"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Add 6 plank" }));
    await settle();
    const [created] = listEntries();
    expect(server.list(created!.shareToken!).state).toMatchObject({ name: "plank", targets: [{ itemId: "plank", quantity: 6 }] });
    expect(where()).toBe(`/planner/${created!.shareToken}`);
  });

  it("LST-5: renaming a card updates the card and the shared list; Escape cancels", async () => {
    seedDirectory([entry("a", { name: "Before" })]);
    server.seed("tok_a".padEnd(22, "0"), { name: "Before" });
    await openDirectory();
    fireEvent.click(within(cardFor("Before") as HTMLElement).getByRole("button", { name: "rename" }));
    const field = document.querySelector(".list-card-rename") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "After" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await settle();
    expect(cardNames()).toEqual(["After"]);
    expect(server.list("tok_a".padEnd(22, "0")).state.name).toBe("After");

    fireEvent.click(within(cardFor("After") as HTMLElement).getByRole("button", { name: "rename" }));
    const again = document.querySelector(".list-card-rename") as HTMLInputElement;
    fireEvent.change(again, { target: { value: "Nope" } });
    fireEvent.keyDown(again, { key: "Escape" });
    await settle();
    expect(cardNames()).toEqual(["After"]);

    fireEvent.click(within(cardFor("After") as HTMLElement).getByRole("button", { name: "rename" }));
    const blank = document.querySelector(".list-card-rename") as HTMLInputElement;
    fireEvent.change(blank, { target: { value: "  " } });
    fireEvent.keyDown(blank, { key: "Enter" });
    await settle();
    expect(cardNames()).toEqual(["Untitled"]);
    expect(server.list("tok_a".padEnd(22, "0")).state.name).toBe("Untitled");
  });

  it("LST-7: Duplicate copies targets and path choices, not progress", async () => {
    const src = "tok_a".padEnd(22, "0");
    seedDirectory([entry("a", { name: "Kit" })]);
    server.seed(src, { name: "Kit", targets: [{ itemId: "charcoal", quantity: 50 }], pathChoices: { charcoal: "r_charcoal_heartwood" } }, { heartwood: [4, "Bob"] });
    await openDirectory();
    fireEvent.click(within(cardFor("Kit") as HTMLElement).getByRole("button", { name: "duplicate" }));
    await settle();
    expect(cardNames()).toContain("Kit (copy)");
    const copy = listEntries().find((e) => e.name === "Kit (copy)")!;
    const stored = server.list(copy.shareToken!);
    expect(stored.state).toMatchObject({ targets: [{ itemId: "charcoal", quantity: 50 }], pathChoices: { charcoal: "r_charcoal_heartwood" } });
    expect(stored.progress.size).toBe(0);
    expect(server.list(src).state.name).toBe("Kit");
  });

  it("LST-8: archiving hides a card in the archived section, and unarchiving restores its place", async () => {
    seedDirectory([
      entry("a", { name: "First", updatedAt: ago(1000) }),
      entry("b", { name: "Second", updatedAt: ago(2000) }),
    ]);
    await openDirectory();
    // Archive the older list: if archiving touched its update time, it would jump to the top.
    fireEvent.click(within(cardFor("Second") as HTMLElement).getByRole("button", { name: "archive" }));
    expect(cardNames()).toEqual(["First"]);
    fireEvent.click(screen.getByRole("button", { name: "Show archived (1)" }));
    const archived = document.querySelector(".list-card.archived")!;
    expect(archived.querySelector(".list-card-name")!.textContent).toBe("Second");
    fireEvent.click(within(archived as HTMLElement).getByRole("button", { name: "unarchive" }));
    expect(cardNames()).toEqual(["First", "Second"]);
  });

  it("LST-10: failed directory actions say what failed", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    seedDirectory([entry("a", { name: "Kit" })]);
    server.seed("tok_a".padEnd(22, "0"), { name: "Kit" });
    await openDirectory();

    server.failNext("POST", 500, "/api/lists");
    fireEvent.click(screen.getByRole("button", { name: "+ Create a new list" }));
    await settle();
    expect(alert).toHaveBeenLastCalledWith("Could not create a list: createList failed: 500");

    server.failNext("GET", 500);
    fireEvent.click(within(cardFor("Kit") as HTMLElement).getByRole("button", { name: "duplicate" }));
    await settle();
    expect(alert).toHaveBeenLastCalledWith("Could not load the list to duplicate.");

    server.failNext("POST", 500, "/api/lists");
    fireEvent.click(within(cardFor("Kit") as HTMLElement).getByRole("button", { name: "duplicate" }));
    await settle();
    expect(alert).toHaveBeenLastCalledWith("Could not duplicate the list: createList failed: 500");

    server.failNext("GET", 500);
    fireEvent.click(within(cardFor("Kit") as HTMLElement).getByRole("button", { name: "rename" }));
    const field = document.querySelector(".list-card-rename") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Kit 2" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await settle();
    expect(alert).toHaveBeenLastCalledWith("Could not rename the list: getList failed: 500");
    expect(listEntries()).toHaveLength(1); // nothing was added by the failures
  });

  it("LST-11: a legacy local list is promoted to the server when opened", async () => {
    seedDirectory([{ id: "legacy-1", name: "Old plan", kind: "local", targetCount: 1, createdAt: ago(0), updatedAt: ago(0) }]);
    localStorage.setItem(
      "paxdei-planner:list:legacy-1",
      JSON.stringify({ name: "Old plan", targets: [{ itemId: "table", quantity: 1 }], owned: { wood: 3 }, pathChoices: {} }),
    );
    await openDirectory("/planner/legacy-1");
    await settle();
    const [promoted] = listEntries();
    expect(promoted).toMatchObject({ id: "legacy-1", kind: "shared", name: "Old plan" });
    const stored = server.list(promoted!.shareToken!);
    expect(stored.state.targets).toEqual([{ itemId: "table", quantity: 1 }]);
    expect(server.calls.find((c) => c.method === "POST")!.body).toMatchObject({ owned: { wood: 3 } });
    expect(localStorage.getItem("paxdei-planner:list:legacy-1")).toBeNull();
    expect(where()).toBe(`/planner/${promoted!.shareToken}`);
  });

  it("LST-11: a failed promotion returns to the directory", async () => {
    seedDirectory([{ id: "legacy-2", name: "Old", kind: "local", targetCount: 0, createdAt: ago(0), updatedAt: ago(0) }]);
    server.failNext("POST", 500, "/api/lists");
    await openDirectory("/planner/legacy-2");
    await settle();
    expect(where()).toBe("/planner");
  });

  it("SHR-7: a legacy ?list= link redirects to the token URL", async () => {
    const token = server.seed("tok_legacy_link_000000");
    await openDirectory(`/planner?list=${token}`);
    expect(where()).toBe(`/planner/${token}`);
  });
});
