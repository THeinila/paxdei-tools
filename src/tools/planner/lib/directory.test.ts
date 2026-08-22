import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listEntries, setArchived, updateEntry, type ListEntry } from "./directory.ts";

const INDEX_KEY = "paxdei-planner:lists:v1";

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  });
});

afterEach(() => vi.unstubAllGlobals());

const seed = (patch: Partial<ListEntry> = {}): ListEntry => {
  const entry: ListEntry = {
    id: "l1",
    name: "Anvil set",
    kind: "shared",
    shareToken: "tok",
    targetCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...patch,
  };
  store[INDEX_KEY] = JSON.stringify([entry]);
  return entry;
};

describe("setArchived", () => {
  it("marks a list archived without disturbing its place in the directory", () => {
    const before = seed();
    const after = setArchived("l1", true)!;
    expect(after.archivedAt).toBeTruthy();
    // The directory sorts by updatedAt, so archiving must not bump it — the list
    // would jump to the top at the moment it's hidden.
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("restores a list and leaves no archivedAt behind", () => {
    seed({ archivedAt: "2026-02-01T00:00:00.000Z" });
    expect(setArchived("l1", false)!.archivedAt).toBeUndefined();
    const stored = JSON.parse(store[INDEX_KEY]!) as ListEntry[];
    expect("archivedAt" in stored[0]!).toBe(false);
  });

  it("leaves other fields and other lists alone", () => {
    seed();
    store[INDEX_KEY] = JSON.stringify([
      ...(JSON.parse(store[INDEX_KEY]!) as ListEntry[]),
      { ...seed(), id: "l2", name: "Keep" },
    ]);
    setArchived("l1", true);
    const entries = listEntries();
    expect(entries.find((e) => e.id === "l1")).toMatchObject({ name: "Anvil set", shareToken: "tok" });
    expect(entries.find((e) => e.id === "l2")?.archivedAt).toBeUndefined();
  });

  it("returns undefined for an unknown list", () => {
    seed();
    expect(setArchived("nope", true)).toBeUndefined();
  });

  it("still bumps updatedAt for ordinary edits", () => {
    const before = seed();
    expect(updateEntry("l1", { name: "Renamed" })!.updatedAt).not.toBe(before.updatedAt);
  });
});
