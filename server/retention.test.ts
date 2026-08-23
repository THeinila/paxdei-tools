import { beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, type DB } from "./db.ts";
import { createListsRouter } from "./lists.ts";
import { cutoffFor, sweepLists, ttlDaysFromEnv, DEFAULT_TTL_DAYS } from "./retention.ts";

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
});

/** Insert a list whose last activity was `daysAgo`. */
function seedList(token: string, daysAgo: number): number {
  const ts = cutoffFor(daysAgo);
  const info = db
    .prepare(
      `INSERT INTO lists (share_token, version, state, created_at, updated_at, last_activity_at)
       VALUES (?, 0, ?, ?, ?, ?)`,
    )
    .run(token, JSON.stringify({ name: token, targets: [], pathChoices: {} }), ts, ts, ts);
  return Number(info.lastInsertRowid);
}

const tokens = (): string[] =>
  (db.prepare(`SELECT share_token FROM lists ORDER BY share_token`).all() as {
    share_token: string;
  }[]).map((r) => r.share_token);

describe("ttlDaysFromEnv", () => {
  it("defaults to 90 days when unset or blank", () => {
    expect(ttlDaysFromEnv({} as NodeJS.ProcessEnv)).toBe(DEFAULT_TTL_DAYS);
    expect(ttlDaysFromEnv({ LIST_TTL_DAYS: "" } as NodeJS.ProcessEnv)).toBe(DEFAULT_TTL_DAYS);
  });

  it("honours an explicit value", () => {
    expect(ttlDaysFromEnv({ LIST_TTL_DAYS: "30" } as NodeJS.ProcessEnv)).toBe(30);
  });

  it("treats 0 as 'disabled' rather than 'delete everything'", () => {
    expect(ttlDaysFromEnv({ LIST_TTL_DAYS: "0" } as NodeJS.ProcessEnv)).toBe(0);
  });

  it("falls back to the default on garbage rather than deleting unexpectedly", () => {
    expect(ttlDaysFromEnv({ LIST_TTL_DAYS: "soon" } as NodeJS.ProcessEnv)).toBe(DEFAULT_TTL_DAYS);
    expect(ttlDaysFromEnv({ LIST_TTL_DAYS: "-5" } as NodeJS.ProcessEnv)).toBe(DEFAULT_TTL_DAYS);
  });
});

describe("sweepLists", () => {
  it("deletes lists idle past the window and keeps the rest", () => {
    seedList("fresh", 1);
    seedList("borderline", 89);
    seedList("stale", 120);

    expect(sweepLists(db, 90)).toBe(1);
    expect(tokens()).toEqual(["borderline", "fresh"]);
  });

  it("does nothing when retention is disabled", () => {
    seedList("ancient", 5000);
    expect(sweepLists(db, 0)).toBe(0);
    expect(tokens()).toEqual(["ancient"]);
  });

  it("cascades progress rows away with the list", () => {
    const id = seedList("stale", 200);
    db.prepare(
      `INSERT INTO progress (list_id, item_id, qty, by_handle, updated_at)
       VALUES (?, 'iron', 5, 'ana', ?)`,
    ).run(id, cutoffFor(200));

    sweepLists(db, 90);
    const left = db.prepare(`SELECT COUNT(*) AS n FROM progress`).get() as { n: number };
    expect(left.n).toBe(0);
  });

  it("records how many it swept", () => {
    seedList("a", 200);
    seedList("b", 200);
    sweepLists(db, 90);
    const row = db.prepare(`SELECT count FROM metrics WHERE metric = 'lists_swept'`).get() as
      | { count: number }
      | undefined;
    expect(row?.count).toBe(2);
  });

  it("leaves no metric row when nothing was swept", () => {
    seedList("fresh", 1);
    sweepLists(db, 90);
    const row = db.prepare(`SELECT count FROM metrics WHERE metric = 'lists_swept'`).get();
    expect(row).toBeUndefined();
  });
});

describe("activity tracking keeps live lists alive", () => {
  /** Call a route on the lists router directly. */
  const call = (path: string, init?: RequestInit) =>
    createListsRouter(db).request(`http://x${path}`, init);

  const post = (path: string, body: unknown) =>
    call(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("a progress write rescues a list that was about to be swept", async () => {
    const id = seedList("settled", 200);
    const token = "settled";

    // A group that finalised its targets long ago and only ticks items off.
    const res = await post(`/lists/${token}/progress`, {
      itemId: "iron",
      delta: 3,
      handle: "ana",
    });
    expect(res.status).toBe(200);

    expect(sweepLists(db, 90)).toBe(0);
    expect(tokens()).toEqual(["settled"]);

    // ...and it is the activity clock that moved, not the definition clock.
    const row = db
      .prepare(`SELECT updated_at, last_activity_at FROM lists WHERE id = ?`)
      .get(id) as { updated_at: string; last_activity_at: string };
    expect(row.last_activity_at > row.updated_at).toBe(true);
  });

  it("a definition edit also counts as activity", async () => {
    seedList("edited", 200);
    const res = await call(`/lists/edited`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseVersion: 0,
        state: { name: "Edited", targets: [], pathChoices: {} },
      }),
    });
    expect(res.status).toBe(200);
    expect(sweepLists(db, 90)).toBe(0);
  });

  it("merely READING a list does not keep it alive", async () => {
    seedList("abandoned", 200);
    const res = await call(`/lists/abandoned`);
    expect(res.status).toBe(200);
    // Polling is the app's own background traffic; if it counted as activity no
    // list would ever expire while a forgotten tab was open somewhere.
    expect(sweepLists(db, 90)).toBe(1);
  });

  it("a newly created list starts with a fresh activity clock", async () => {
    const res = await post(`/lists`, {
      state: { name: "New", targets: [], pathChoices: {} },
      owned: {},
      handle: "ana",
    });
    expect(res.status).toBe(201);
    expect(sweepLists(db, 90)).toBe(0);
  });
});

describe("migration", () => {
  it("adds and backfills last_activity_at on a legacy database", () => {
    // Rebuild the pre-migration shape, with a list and some newer progress.
    db.exec(`DROP TABLE progress`);
    db.exec(`DROP TABLE lists`);
    db.exec(`
      CREATE TABLE lists (
        id INTEGER PRIMARY KEY, share_token TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE progress (
        list_id INTEGER NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL,
        by_handle TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (list_id, item_id),
        FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
      );
    `);
    const defEdited = cutoffFor(200);
    const lastTicked = cutoffFor(3);
    db.prepare(
      `INSERT INTO lists (share_token, version, state, created_at, updated_at)
       VALUES ('legacy', 0, '{}', ?, ?)`,
    ).run(defEdited, defEdited);
    db.prepare(
      `INSERT INTO progress (list_id, item_id, qty, by_handle, updated_at)
       VALUES (1, 'iron', 5, 'ana', ?)`,
    ).run(lastTicked);

    migrate(db);

    const row = db.prepare(`SELECT last_activity_at FROM lists WHERE share_token = 'legacy'`).get() as
      | { last_activity_at: string }
      | undefined;
    // Backfilled from the PROGRESS timestamp, not the stale definition one —
    // otherwise the first sweep after deploying this would delete a live list.
    expect(row?.last_activity_at).toBe(lastTicked);
    expect(sweepLists(db, 90)).toBe(0);
  });

  it("is idempotent — re-running does not throw or clobber", () => {
    seedList("keep", 5);
    const before = db
      .prepare(`SELECT last_activity_at FROM lists WHERE share_token = 'keep'`)
      .get() as { last_activity_at: string };

    expect(() => {
      migrate(db);
      migrate(db);
    }).not.toThrow();

    const after = db
      .prepare(`SELECT last_activity_at FROM lists WHERE share_token = 'keep'`)
      .get() as { last_activity_at: string };
    expect(after.last_activity_at).toBe(before.last_activity_at);
  });
});
