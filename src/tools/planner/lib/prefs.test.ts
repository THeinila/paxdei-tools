import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS } from "../engine/view.ts";
import { clearPrefs, readPrefs, writePrefs } from "./prefs.ts";

const KEY = "paxdei-planner:prefs:v1";

// Vitest runs in node, which has no localStorage — stub it rather than pulling
// in jsdom for one string-keyed map.
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

describe("readPrefs", () => {
  it("defaults when nothing is stored", () => {
    expect(readPrefs("tok")).toEqual(DEFAULT_PREFS);
  });

  it("survives corrupt or unexpected storage", () => {
    for (const raw of ["not json", "[1,2]", "null", '"string"', '{"tok":[]}', '{"tok":7}']) {
      store[KEY] = raw;
      expect(readPrefs("tok")).toEqual(DEFAULT_PREFS);
    }
  });

  it("coerces each field independently", () => {
    store[KEY] = JSON.stringify({
      tok: { preset: "nonsense", hideCompleted: "yes", collapsed: "gather" },
    });
    expect(readPrefs("tok")).toEqual({ preset: "tiered", hideCompleted: false, collapsed: [] });

    store[KEY] = JSON.stringify({ tok: { preset: "flat", collapsed: [1, "a", "a", null] } });
    expect(readPrefs("tok")).toEqual({ preset: "flat", hideCompleted: false, collapsed: ["a"] });
  });

  it("does not throw when localStorage is unavailable", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", undefined);
    expect(readPrefs("tok")).toEqual(DEFAULT_PREFS);
  });
});

describe("writePrefs", () => {
  it("merges, persists, and returns the merged value", () => {
    expect(writePrefs("tok", { preset: "profession" })).toEqual({
      preset: "profession",
      hideCompleted: false,
      collapsed: [],
    });
    expect(writePrefs("tok", { hideCompleted: true })).toEqual({
      preset: "profession",
      hideCompleted: true,
      collapsed: [],
    });
    expect(readPrefs("tok")).toEqual({ preset: "profession", hideCompleted: true, collapsed: [] });
  });

  it("keeps lists independent", () => {
    writePrefs("a", { preset: "flat" });
    writePrefs("b", { preset: "profession" });
    expect(readPrefs("a").preset).toBe("flat");
    expect(readPrefs("b").preset).toBe("profession");
  });

  it("sanitizes what it is handed", () => {
    expect(writePrefs("tok", { preset: "bogus" as never }).preset).toBe("tiered");
  });

  it("caps the number of remembered lists, keeping the newest", () => {
    for (let i = 0; i < 60; i++) writePrefs(`tok${i}`, { preset: "flat" });
    const stored = JSON.parse(store[KEY]!) as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(50);
    expect(readPrefs("tok59").preset).toBe("flat");
    expect(readPrefs("tok0")).toEqual(DEFAULT_PREFS);
  });

  it("caps collapsed keys", () => {
    const many = Array.from({ length: 100 }, (_, i) => `craft:tier:${i}`);
    expect(writePrefs("tok", { collapsed: many }).collapsed).toHaveLength(64);
  });
});

describe("clearPrefs", () => {
  it("forgets one list and leaves the others", () => {
    writePrefs("a", { preset: "flat" });
    writePrefs("b", { preset: "profession" });
    clearPrefs("a");
    expect(readPrefs("a")).toEqual(DEFAULT_PREFS);
    expect(readPrefs("b").preset).toBe("profession");
  });

  it("is a no-op for an unknown list", () => {
    expect(() => clearPrefs("nope")).not.toThrow();
  });
});
