// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDataset } from "./data.ts";
import { installFakeServer } from "./testServer.ts";
import { useList } from "./useList.ts";

vi.mock("../../../../data/dataset.json", async () => (await import("../engine/testFixtures.ts")).datasetModule());

const TOKEN = "tok_useList_000000000";
const HANDLE_KEY = "paxdei-planner:handle:v1";
const POLL = 10_000;

let server: ReturnType<typeof installFakeServer>;

beforeAll(async () => {
  await loadDataset();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0); // no poll jitter unless a test sets it
  localStorage.setItem(HANDLE_KEY, "Alice");
  server = installFakeServer();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  setVisibility("visible");
});

/** Let pending promises (fetches, effects) run, optionally moving time on. */
const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

async function open(token = TOKEN) {
  const hook = renderHook(() => useList(token));
  await settle();
  expect(hook.result.current.ready).toBe(true);
  return hook;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

const progressPosts = () =>
  server.calls.filter((c) => c.method === "POST" && c.path.endsWith("/progress")).map((c) => c.body);
const patches = () => server.calls.filter((c) => c.method === "PATCH").map((c) => c.body!);

describe("useList progress", () => {
  it("PRG-4: sends the difference from the shown amount, and nothing for no change", async () => {
    server.seed(TOKEN, {}, { wood: [3, "Bob"] });
    const { result } = await open();
    act(() => result.current.setOwned("wood", 5));
    expect(result.current.state.owned.wood).toBe(5); // shown at once
    act(() => result.current.setOwned("wood", 8)); // a second quick edit, before the first returns
    act(() => result.current.setOwned("wood", 8));
    await settle();
    expect(progressPosts()).toEqual([
      { itemId: "wood", delta: 2, handle: "Alice" },
      { itemId: "wood", delta: 3, handle: "Alice" },
    ]);
    expect(server.list(TOKEN).progress.get("wood")!.qty).toBe(8);
  });

  it("PRG-5: have amounts are the plan's owned stock, and 0 doesn't count", async () => {
    server.seed(TOKEN, { targets: [{ itemId: "table", quantity: 1 }] }, { plank: [4, "Bob"], nail: [0, "Bob"] });
    const { result } = await open();
    expect(result.current.state.owned).toEqual({ plank: 4 });
    expect(result.current.result.crafts.find((c) => c.itemId === "plank")!.satisfied).toBe(true);
    expect(result.current.result.crafts.find((c) => c.itemId === "nail")!.satisfied).toBe(false);
  });

  it("PRG-6: the first write asks for a name, stores it and sends it", async () => {
    localStorage.removeItem(HANDLE_KEY);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("  Carol ");
    server.seed(TOKEN);
    const { result } = await open();
    act(() => result.current.setOwned("wood", 2));
    await settle();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(HANDLE_KEY)).toBe("Carol");
    expect(progressPosts()).toEqual([{ itemId: "wood", delta: 2, handle: "Carol" }]);

    act(() => result.current.setOwned("wood", 3));
    await settle();
    expect(prompt).toHaveBeenCalledTimes(1); // not asked again
  });

  it("PRG-13: a failed write is undone and reported", async () => {
    server.seed(TOKEN, {}, { wood: [3, "Bob"] });
    const { result } = await open();
    server.failNext("POST", 500, "/progress");
    act(() => result.current.setOwned("wood", 9));
    expect(result.current.state.owned.wood).toBe(9);
    await settle();
    expect(result.current.state.owned.wood).toBe(3);
    expect(result.current.progress.wood!.byHandle).toBe("Bob");
    expect(result.current.error).toBe("postProgress failed: 500");
  });

  it("PRG-13: a failed first write for an item removes it again", async () => {
    server.seed(TOKEN);
    const { result } = await open();
    server.failNext("POST", 503, "/progress");
    act(() => result.current.setOwned("wood", 4));
    await settle();
    expect(result.current.progress.wood).toBeUndefined();
  });

  it("PRG-10: another collaborator's change appears on the next poll", async () => {
    server.seed(TOKEN);
    const { result } = await open();
    server.otherClient(TOKEN, (l) =>
      l.progress.set("wood", { itemId: "wood", qty: 7, byHandle: "Bob", updatedAt: "2026-01-01T00:00:00.000Z" }),
    );
    await settle(POLL);
    expect(result.current.progress.wood).toMatchObject({ qty: 7, byHandle: "Bob" });
  });

  it("PRG-14: an older poll response never replaces a newer one", async () => {
    server.seed(TOKEN, {}, { wood: [1, "Bob"] });
    const { result } = await open();
    server.hold("GET", "response"); // the server answers at once; the replies are slow
    await settle(POLL); // poll A: the server reads 1
    server.otherClient(TOKEN, (l) => l.progress.set("wood", { ...l.progress.get("wood")!, qty: 5 }));
    setVisibility("hidden");
    setVisibility("visible"); // a second poll here would read 5

    // Deliver the newest reply first, then the rest, recording what the screen shows.
    const seen: number[] = [];
    while (server.held().length) {
      server.release(server.held().length - 1);
      await settle();
      seen.push(result.current.progress.wood!.qty);
    }
    server.release();
    await settle(POLL); // the next regular poll reads 5
    seen.push(result.current.progress.wood!.qty);
    expect(seen.at(-1)).toBe(5);
    // Once 5 has been shown, an older 1 must never come back.
    expect(seen.slice(seen.indexOf(5))).toEqual(seen.slice(seen.indexOf(5)).map(() => 5));
  });
});

describe("PRG-N1 polling", () => {
  it("PRG-N1: polls every 10 s plus up to 2 s of jitter", async () => {
    server.seed(TOKEN);
    await open();
    const gets = () => server.countOf("GET");
    expect(gets()).toBe(1);
    await settle(POLL - 1);
    expect(gets()).toBe(1);
    await settle(1);
    expect(gets()).toBe(2);

    vi.mocked(Math.random).mockReturnValue(0.999);
    await settle(POLL); // the timer set after poll 2 used random = 0
    expect(gets()).toBe(3);
    await settle(POLL + 1997);
    expect(gets()).toBe(3);
    await settle(2);
    expect(gets()).toBe(4);
  });

  it("PRG-N1: never has two polls in flight", async () => {
    server.seed(TOKEN);
    await open();
    server.hold("GET");
    await settle(POLL * 5);
    // The timer waits for the slow poll; coming back to the tab must not add a second one.
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect(server.held()).toHaveLength(1);
    server.release();
    await settle();
  });

  it("PRG-N1: stops polling while hidden and polls at once on return", async () => {
    server.seed(TOKEN);
    await open();
    setVisibility("hidden");
    await settle(POLL * 3);
    expect(server.countOf("GET")).toBe(1);
    setVisibility("visible");
    await settle();
    expect(server.countOf("GET")).toBe(2);
  });
});

describe("useList definition edits", () => {
  it("EDT-1: an edit shows before the server answers", async () => {
    server.seed(TOKEN);
    const { result } = await open();
    server.hold("PATCH");
    act(() => result.current.addTarget("table", 2));
    expect(result.current.state.targets).toEqual([{ itemId: "table", quantity: 2 }]);
    expect(result.current.result.crafts.map((c) => c.itemId)).toContain("table");
    server.release();
    await settle();
  });

  it("EDT-3: a stale save is rebased onto the other edit, keeping both", async () => {
    server.seed(TOKEN, { targets: [{ itemId: "wood", quantity: 1 }] });
    const { result } = await open();
    server.otherClient(TOKEN, (l) => {
      l.state.targets.push({ itemId: "chair", quantity: 1 });
      l.version++;
    });
    act(() => result.current.addTarget("table", 1));
    await settle();
    expect(patches().map((p) => p.baseVersion)).toEqual([0, 1]);
    expect(server.list(TOKEN).state.targets.map((t) => t.itemId)).toEqual(["wood", "chair", "table"]);
    expect(result.current.state.targets.map((t) => t.itemId)).toEqual(["wood", "chair", "table"]);
    expect(result.current.error).toBeNull();
  });

  it("EDT-4: three conflicts in a row are reported, and the next poll shows the server's list", async () => {
    server.seed(TOKEN, { targets: [{ itemId: "wood", quantity: 1 }] });
    const { result } = await open();
    server.conflictNext(3);
    act(() => result.current.addTarget("table", 1));
    await settle();
    expect(patches()).toHaveLength(3);
    expect(result.current.error).toBe("someone else is editing this list — your last change may not have saved");
    await settle(POLL);
    expect(result.current.state.targets).toEqual([{ itemId: "wood", quantity: 1 }]);
  });

  it("EDT-5: other save failures are reported, and the next poll shows the server's list", async () => {
    server.seed(TOKEN, { targets: [{ itemId: "wood", quantity: 1 }] });
    const { result } = await open();
    server.failNext("PATCH", 500);
    act(() => result.current.setTargetQty("wood", 4));
    await settle();
    expect(result.current.error).toBe("patchList failed: 500");
    await settle(POLL);
    expect(result.current.state.targets).toEqual([{ itemId: "wood", quantity: 1 }]);
  });

  it("EDT-7: a poll doesn't undo an edit that is still being saved", async () => {
    server.seed(TOKEN, { targets: [{ itemId: "wood", quantity: 1 }] });
    const { result } = await open();
    server.hold("PATCH");
    act(() => result.current.setTargetQty("wood", 6));
    server.otherClient(TOKEN, (l) => l.progress.set("nail", { itemId: "nail", qty: 2, byHandle: "Bob", updatedAt: "x" }));
    await settle(POLL); // this poll still has quantity 1
    expect(result.current.state.targets).toEqual([{ itemId: "wood", quantity: 6 }]);
    expect(result.current.progress.nail!.qty).toBe(2); // progress in that poll still applies
    server.release();
    await settle();
  });

  it("EDT-8: quantity 0 takes a target off the list", async () => {
    server.seed(TOKEN, { targets: [{ itemId: "wood", quantity: 1 }, { itemId: "nail", quantity: 2 }] });
    const { result } = await open();
    act(() => result.current.setTargetQty("wood", 0));
    await settle();
    expect(result.current.state.targets).toEqual([{ itemId: "nail", quantity: 2 }]);
    expect(server.list(TOKEN).state.targets).toEqual([{ itemId: "nail", quantity: 2 }]);
  });

  it("EDT-10: clearing removes targets and path choices but keeps have amounts", async () => {
    server.seed(
      TOKEN,
      { name: "Kit", targets: [{ itemId: "charcoal", quantity: 50 }], pathChoices: { charcoal: "r_charcoal_heartwood" } },
      { sapwood: [9, "Bob"] },
    );
    const { result } = await open();
    act(() => result.current.clear());
    await settle();
    expect(server.list(TOKEN).state).toEqual({ name: "Kit", targets: [], pathChoices: {} });
    expect(server.list(TOKEN).progress.get("sapwood")!.qty).toBe(9);
    act(() => result.current.addTarget("charcoal", 50));
    expect(result.current.state.owned.sapwood).toBe(9);
  });

  it("ALT-4: a path choice is saved with the list and used when it's opened again", async () => {
    server.seed(TOKEN, { targets: [{ itemId: "charcoal", quantity: 100 }] });
    const first = await open();
    act(() => first.result.current.setPathChoice("charcoal", "r_charcoal_heartwood"));
    await settle();
    expect(server.list(TOKEN).state.pathChoices).toEqual({ charcoal: "r_charcoal_heartwood" });
    first.unmount();

    const again = await open();
    expect(again.result.current.result.gather.map((g) => g.itemId)).toEqual(["heartwood"]);
  });
});
