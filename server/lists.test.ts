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
  it("round-trips state and seeds progress from owned", async () => {
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

  it("round-trips the list name and bounds its length", async () => {
    const { token } = await createList({ name: "Stronghold supplies", targets: [], pathChoices: {} });
    const body = (await (await app.request(`/lists/${token}`)).json()) as { state: { name: string } };
    expect(body.state.name).toBe("Stronghold supplies");

    const long = await createList({ name: "x".repeat(200), targets: [], pathChoices: {} });
    const longBody = (await (await app.request(`/lists/${long.token}`)).json()) as { state: { name: string } };
    expect(longBody.state.name.length).toBe(80);
  });

  it("defaults name to an empty string when absent", async () => {
    const { token } = await createList({ targets: [], pathChoices: {} });
    const body = (await (await app.request(`/lists/${token}`)).json()) as { state: { name: string } };
    expect(body.state.name).toBe("");
  });

  it("404s an unknown token", async () => {
    const res = await app.request("/lists/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("drops malformed targets instead of storing them", async () => {
    const { token } = await createList({
      targets: [{ itemId: "ok", quantity: 1 }, { itemId: 5, quantity: "x" }, { quantity: 2 }],
      pathChoices: {},
    });
    const body = (await (await app.request(`/lists/${token}`)).json()) as { state: { targets: unknown[] } };
    expect(body.state.targets).toEqual([{ itemId: "ok", quantity: 1 }]);
  });
});

describe("version-guarded edits", () => {
  it("increments version on a fresh-base PATCH", async () => {
    const { token } = await createList({ targets: [], pathChoices: {} });
    const res = await app.request(`/lists/${token}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: { targets: [{ itemId: "a", quantity: 1 }], pathChoices: {} }, baseVersion: 0 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(1);
  });

  it("rejects a stale baseVersion with 409 and returns the current state", async () => {
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
  it("two +10 deltas on the same item sum to 20", async () => {
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

  it("a negative delta never drives qty below 0", async () => {
    const { token } = await createList({ targets: [], pathChoices: {} });
    const bump = (delta: number) => app.request(`/lists/${token}/progress`, json({ itemId: "iron", delta, handle: "A" }));
    await bump(3);
    const res = await bump(-5);
    expect((await res.json()).qty).toBe(0);
  });

  it("400s a non-numeric delta", async () => {
    const { token } = await createList({ targets: [], pathChoices: {} });
    const res = await app.request(`/lists/${token}/progress`, json({ itemId: "iron", delta: "lots", handle: "A" }));
    expect(res.status).toBe(400);
  });
});
