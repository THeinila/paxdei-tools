import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createDiskGuard, DEFAULT_MIN_FREE_BYTES } from "./diskGuard.ts";

const silent = () => {};

/** An app whose only route is guarded, so a 503 can only come from the guard. */
function guardedApp(guard: ReturnType<typeof createDiskGuard>) {
  const app = new Hono();
  app.post("/lists", guard.middleware(), (c) => c.json({ ok: true }, 201));
  return app;
}

describe("createDiskGuard", () => {
  it("allows writes when there is plenty of space", async () => {
    const guard = createDiskGuard({ path: process.cwd(), minFreeBytes: 1, log: silent });
    await guard.refresh();
    expect(guard.status().low).toBe(false);

    const res = await guardedApp(guard).request("http://x/lists", { method: "POST" });
    expect(res.status).toBe(201);
  });

  it("refuses new lists when free space is below the floor", async () => {
    // A floor larger than any real volume forces the low state.
    const guard = createDiskGuard({
      path: process.cwd(),
      minFreeBytes: Number.MAX_SAFE_INTEGER,
      log: silent,
    });
    await guard.refresh();
    expect(guard.status().low).toBe(true);

    const res = await guardedApp(guard).request("http://x/lists", { method: "POST" });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("3600");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("storage full");
  });

  it("fails OPEN when the disk cannot be measured", async () => {
    // A path that cannot exist: neither it nor its parent will stat. Blocking
    // writes because we failed to measure would be the wrong call — an
    // unmeasurable disk is not a full one.
    const guard = createDiskGuard({
      path: "/nonexistent-volume-xyz/nested/data.sqlite",
      log: silent,
    });
    await guard.refresh();
    const s = guard.status();
    expect(s.freeBytes).toBeNull();
    expect(s.low).toBe(false);

    const res = await guardedApp(guard).request("http://x/lists", { method: "POST" });
    expect(res.status).toBe(201);
  });

  it("falls back to the parent directory when the database file is absent", async () => {
    // Normal on a fresh deployment: data/ exists but data.sqlite does not yet.
    const guard = createDiskGuard({
      path: `${process.cwd()}/definitely-not-created-yet.sqlite`,
      minFreeBytes: 1,
      log: silent,
    });
    await guard.refresh();
    expect(guard.status().freeBytes).toBeGreaterThan(0);
    expect(guard.status().low).toBe(false);
  });

  it("caches, so a burst of requests does not stat the volume every time", async () => {
    const guard = createDiskGuard({
      path: process.cwd(),
      minFreeBytes: 1,
      checkIntervalMs: 60_000,
      log: silent,
    });
    await guard.refresh();
    const first = guard.status().checkedAt;

    const app = guardedApp(guard);
    for (let i = 0; i < 25; i++) {
      await app.request("http://x/lists", { method: "POST" });
    }
    expect(guard.status().checkedAt).toBe(first);
  });

  it("reports a sane default floor", () => {
    expect(DEFAULT_MIN_FREE_BYTES).toBe(256 * 1024 * 1024);
  });
});
