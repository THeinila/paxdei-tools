/** Backend integration tests against an in-memory SQLite DB. Focus: the two
 * concurrency guarantees — atomic additive progress deltas and version-guarded
 * definition edits. */
import { beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { openDb } from "./db.ts";
import { createListsRouter } from "./lists.ts";

let app: Hono;

beforeEach(() => {
  const db = openDb(":memory:");
  app = createListsRouter(db);
});

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function createList(state: unknown, extra: Record<string, unknown> = {}) {
  const res = await app.request("/lists", json({ state, ...extra }));
  expect(res.status).toBe(201);
  return res.json() as Promise<{ token: string; version: number; progress: { itemId: string; qty: number }[] }>;
}

describe("create + get", () => {
  it("SHR-1, SHR-2: round-trips state and seeds progress from owned", async () => {
    const { token, progress } = await createList(
      { targets: [{ itemId: "axe", quantity: 2 }], pathChoices: { charcoal: "recipe_charcoal_sapwood" } },
      { owned: { sapwood: 5, junk: 0 }, handle: "Alice" },
    );
    expect(progress).toContainEqual(expect.objectContaining({ itemId: "sapwood", qty: 5 }));
    expect(progress.find((p) => p.itemId === "junk")).toBeUndefined(); // 0 not seeded

    const get = await app.request(`/lists/${token}`);
    expect(get.status).toBe(200);
    const body = (await get.json()) as { version: number; state: { targets: unknown[] }; progress: unknown[] };
    expect(body.version).toBe(0);
    expect(body.state.targets).toEqual([{ itemId: "axe", quantity: 2 }]);
  });

  it("SHR-11: round-trips the list name and bounds its length", async () => {
    const { token } = await createList({ name: "Stronghold supplies", targets: [], pathChoices: {} });
    const body = (await (await app.request(`/lists/${token}`)).json()) as { state: { name: string } };
    expect(body.state.name).toBe("Stronghold supplies");

    const long = await createList({ name: "x".repeat(200), targets: [], pathChoices: {} });
    const longBody = (await (await app.request(`/lists/${long.token}`)).json()) as { state: { name: string } };
    expect(longBody.state.name.length).toBe(80);
  });

  it("SHR-11: defaults name to an empty string when absent", async () => {
    const { token } = await createList({ targets: [], pathChoices: {} });
    const body = (await (await app.request(`/lists/${token}`)).json()) as { state: { name: string } };
    expect(body.state.name).toBe("");
  });

  it("SHR-10: 404s an unknown token", async () => {
    const res = await app.request("/lists/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("SHR-11: drops malformed targets instead of storing them", async () => {
    const { token } = await createList({
      targets: [{ itemId: "ok", quantity: 1 }, { itemId: 5, quantity: "x" }, { quantity: 2 }],
      pathChoices: {},
    });
    const body = (await (await app.request(`/lists/${token}`)).json()) as { state: { targets: unknown[] } };
    expect(body.state.targets).toEqual([{ itemId: "ok", quantity: 1 }]);
  });
});

describe("version-guarded edits", () => {
  it("EDT-2: increments version on a fresh-base PATCH", async () => {
    const { token } = await createList({ targets: [], pathChoices: {} });
    const res = await app.request(`/lists/${token}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: { targets: [{ itemId: "a", quantity: 1 }], pathChoices: {} }, baseVersion: 0 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(1);
  });

  it("EDT-3: rejects a stale baseVersion with 409 and returns the current state", async () => {
    const { token } = await createList({ targets: [], pathChoices: {} });
    const patch = (base: number, itemId: string) =>
      app.request(`/lists/${token}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: { targets: [{ itemId, quantity: 1 }], pathChoices: {} }, baseVersion: base }),
      });

    const first = await patch(0, "first"); // wins, version -> 1
    expect(first.status).toBe(200);

    const stale = await patch(0, "second"); // same base, now stale
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { version: number; state: { targets: { itemId: string }[] } };
    expect(body.version).toBe(1);
    expect(body.state.targets[0]?.itemId).toBe("first"); // the winning edit, not clobbered
  });
});

describe("atomic additive progress deltas", () => {
  it("PRG-1: two +10 deltas on the same item sum to 20", async () => {
    const { token } = await createList({ targets: [], pathChoices: {} });
    const bump = (delta: number, handle: string) =>
      app.request(`/lists/${token}/progress`, json({ itemId: "iron", delta, handle }));

    await bump(10, "Alice");
    const second = await bump(10, "Bob");
    expect(second.status).toBe(200);
    const body = (await second.json()) as { qty: number; byHandle: string };
    expect(body.qty).toBe(20);
    expect(body.byHandle).toBe("Bob"); // last toucher recorded
  });

  it("PRG-2: a negative delta never drives qty below 0", async () => {
    const { token } = await createList({ targets: [], pathChoices: {} });
    const bump = (delta: number) => app.request(`/lists/${token}/progress`, json({ itemId: "iron", delta, handle: "A" }));
    await bump(3);
    const res = await bump(-5);
    expect((await res.json()).qty).toBe(0);
  });

  it("PRG-3: 400s a non-numeric delta", async () => {
    const { token } = await createList({ targets: [], pathChoices: {} });
    const res = await app.request(`/lists/${token}/progress`, json({ itemId: "iron", delta: "lots", handle: "A" }));
    expect(res.status).toBe(400);
  });
});

describe("request validation and bounds", () => {
  const patch = (token: string, body: unknown) =>
    app.request(`/lists/${token}`, { ...json(body), method: "PATCH" });

  it("EDT-6: rejects a PATCH without a numeric baseVersion and stores nothing", async () => {
    const { token } = await createList({ name: "keep", targets: [], pathChoices: {} });
    for (const body of [{ state: { name: "x" } }, { state: { name: "x" }, baseVersion: "0" }]) {
      const res = await patch(token, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "baseVersion required" });
    }
    const after = (await (await app.request(`/lists/${token}`)).json()) as { version: number; state: { name: string } };
    expect(after).toMatchObject({ version: 0, state: { name: "keep" } });
  });

  it("SHR-10: an unknown token is 404 on PATCH and on progress writes too", async () => {
    const res1 = await patch("nope", { state: {}, baseVersion: 0 });
    expect(res1.status).toBe(404);
    expect(await res1.json()).toEqual({ error: "not found" });
    const res2 = await app.request("/lists/nope/progress", json({ itemId: "wood", delta: 1 }));
    expect(res2.status).toBe(404);
    expect(await res2.json()).toEqual({ error: "not found" });
  });

  it("SHR-N1: tokens are 22 base64url characters (128 bits) and never repeat", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { token } = await createList({});
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(200);
  });

  it("SHR-11: caps targets at 500 and path choices at 1,000, and bounds quantities", async () => {
    const targets = Array.from({ length: 600 }, (_, i) => ({ itemId: `i${i}`, quantity: 1 }));
    const pathChoices = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`i${i}`, "r"]));
    const res = await app.request("/lists", json({ state: { targets, pathChoices } }));
    const { state } = (await res.json()) as { state: { targets: unknown[]; pathChoices: object } };
    expect(state.targets).toHaveLength(500);
    expect(Object.keys(state.pathChoices)).toHaveLength(1000);

    const bounded = await app.request(
      "/lists",
      json({
        state: {
          targets: [
            { itemId: "frac", quantity: 2.9 },
            { itemId: "zero", quantity: 0 },
            { itemId: "huge", quantity: 10_000_001 },
            { itemId: "max", quantity: 10_000_000 },
            { itemId: "x".repeat(129), quantity: 1 },
          ],
        },
      }),
    );
    const kept = ((await bounded.json()) as { state: { targets: unknown[] } }).state.targets;
    expect(kept).toEqual([
      { itemId: "frac", quantity: 2 },
      { itemId: "max", quantity: 10_000_000 },
    ]);
  });

  it("PRG-2: truncates deltas and caps the stored amount at 10,000,000", async () => {
    const { token } = await createList({});
    const post = async (delta: number) =>
      (await app.request(`/lists/${token}/progress`, json({ itemId: "wood", delta }))).json();
    expect(await post(2.9)).toMatchObject({ qty: 2 });
    expect(await post(-1.9)).toMatchObject({ qty: 1 });
    expect(await post(20_000_000)).toMatchObject({ qty: 10_000_000 });
  });

  it("PRG-3: rejects an item ID longer than 128 characters", async () => {
    const { token } = await createList({});
    const res = await app.request(`/lists/${token}/progress`, json({ itemId: "x".repeat(129), delta: 1 }));
    expect(res.status).toBe(400);
  });
});

describe("creation seeding and progress validation", () => {
  it("SHR-2: seeded progress is attributed to the creator, and bad amounts are left out", async () => {
    const { progress } = (await createList({}, {
      owned: { wood: 3, neg: -2, text: "lots", frac: 2.6 },
      handle: "Alice",
    })) as unknown as { progress: { itemId: string; qty: number; byHandle: string | null }[] };
    expect(progress).toEqual([
      expect.objectContaining({ itemId: "frac", qty: 2, byHandle: "Alice" }),
      expect.objectContaining({ itemId: "wood", qty: 3, byHandle: "Alice" }),
    ]);
  });

  it("PRG-3: a rejected progress write stores nothing", async () => {
    const { token } = await createList({});
    await app.request(`/lists/${token}/progress`, json({ itemId: "iron", delta: "lots" }));
    const body = (await (await app.request(`/lists/${token}`)).json()) as { progress: unknown[] };
    expect(body.progress).toEqual([]);
  });
});
