/** List + progress route handlers. The server is "dumb storage": it never runs
 * the recipe engine. Two concurrency strategies live here:
 *
 *  - Progress writes are atomic additive deltas (UPSERT with qty = qty + delta),
 *    so two near-simultaneous "+10 gathered" sum to +20 — no lost updates.
 *  - List-definition writes are version-guarded (optimistic concurrency): a stale
 *    baseVersion yields 409 so the client can rebase on the current state. */
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import type { DB } from "./db.ts";
import type { ListStateDef } from "../shared/listTypes.ts";
import { bumpMetric } from "./metrics.ts";

/** A row from the lists table (state is the JSON-encoded ListStateDef). */
interface ListRow {
  id: number;
  version: number;
  state: string;
  updated_at: string;
}

interface ProgressRow {
  item_id: string;
  qty: number;
  by_handle: string | null;
  updated_at: string;
}

function now(): string {
  return new Date().toISOString();
}

function newToken(): string {
  return randomBytes(16).toString("base64url");
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Bounds so a single request can't store an unbounded blob (the API is exposed).
const MAX_TARGETS = 500;
const MAX_PATH_CHOICES = 1000;
const MAX_BUYS = 1000;
const MAX_ID_LEN = 128;
const MAX_HANDLE_LEN = 64;
const MAX_NAME_LEN = 80;
const MAX_QTY = 10_000_000;

function isShortString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length <= max;
}

/** Trim a handle to its max length, or null if absent/blank. */
function cleanHandle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.slice(0, MAX_HANDLE_LEN);
  return t.length > 0 ? t : null;
}

/** Accept any shape but coerce to a well-formed, size-bounded definition so a
 * malformed or oversized body can never corrupt or bloat stored state. */
function sanitizeState(raw: unknown): ListStateDef {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.slice(0, MAX_NAME_LEN) : "";
  const targetsRaw = Array.isArray(obj.targets) ? obj.targets : [];
  const targets = targetsRaw
    .map((t) => t as Record<string, unknown>)
    .filter((t) => isShortString(t.itemId, MAX_ID_LEN) && isFiniteNumber(t.quantity))
    .map((t) => ({ itemId: t.itemId as string, quantity: Math.floor(t.quantity as number) }))
    .filter((t) => t.quantity >= 1 && t.quantity <= MAX_QTY)
    .slice(0, MAX_TARGETS);
  const pathChoicesRaw = (obj.pathChoices ?? {}) as Record<string, unknown>;
  const pathChoices: Record<string, string> = {};
  for (const [k, v] of Object.entries(pathChoicesRaw)) {
    if (k.length <= MAX_ID_LEN && isShortString(v, MAX_ID_LEN)) pathChoices[k] = v;
    if (Object.keys(pathChoices).length >= MAX_PATH_CHOICES) break;
  }
  const buysRaw = Array.isArray(obj.buys) ? obj.buys : [];
  const buys = [...new Set(buysRaw.filter((b): b is string => isShortString(b, MAX_ID_LEN)))].slice(
    0,
    MAX_BUYS,
  );
  return { name, targets, pathChoices, buys };
}

function progressList(db: DB, listId: number) {
  const rows = db
    .prepare(
      `SELECT item_id, qty, by_handle, updated_at FROM progress WHERE list_id = ? ORDER BY item_id`,
    )
    .all(listId) as ProgressRow[];
  return rows.map((r) => ({
    itemId: r.item_id,
    qty: r.qty,
    byHandle: r.by_handle,
    updatedAt: r.updated_at,
  }));
}

export function createListsRouter(db: DB) {
  const app = new Hono();

  const findList = db.prepare(
    `SELECT id, version, state, updated_at FROM lists WHERE share_token = ?`,
  );

  // Create a list, optionally seeding progress from the creator's local "owned".
  app.post("/lists", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const state = sanitizeState(body.state);
    const handle = cleanHandle(body.handle);
    const owned = (body.owned ?? {}) as Record<string, unknown>;
    const token = newToken();
    const ts = now();

    const create = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO lists (share_token, version, state, created_at, updated_at)
           VALUES (?, 0, ?, ?, ?)`,
        )
        .run(token, JSON.stringify(state), ts, ts);
      const listId = Number(info.lastInsertRowid);
      const seed = db.prepare(
        `INSERT INTO progress (list_id, item_id, qty, by_handle, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const [itemId, qtyRaw] of Object.entries(owned)) {
        if (itemId.length > MAX_ID_LEN) continue;
        const qty = Math.min(MAX_QTY, Math.floor(Number(qtyRaw)));
        if (Number.isFinite(qty) && qty > 0) seed.run(listId, itemId, qty, handle, ts);
      }
      bumpMetric(db, "list_created");
      return listId;
    });
    const listId = create();

    return c.json(
      { token, version: 0, state, progress: progressList(db, listId), updatedAt: ts },
      201,
    );
  });

  // Poll endpoint: full list + progress snapshot.
  app.get("/lists/:token", (c) => {
    const row = findList.get(c.req.param("token")) as ListRow | undefined;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({
      version: row.version,
      state: JSON.parse(row.state) as ListStateDef,
      progress: progressList(db, row.id),
      updatedAt: row.updated_at,
    });
  });

  // Version-guarded definition update (optimistic concurrency).
  app.patch("/lists/:token", async (c) => {
    const token = c.req.param("token");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isFiniteNumber(body.baseVersion)) {
      return c.json({ error: "baseVersion required" }, 400);
    }
    const state = sanitizeState(body.state);
    const ts = now();
    const info = db
      .prepare(
        `UPDATE lists SET state = ?, version = version + 1, updated_at = ?
         WHERE share_token = ? AND version = ?`,
      )
      .run(JSON.stringify(state), ts, token, body.baseVersion);

    const row = findList.get(token) as ListRow | undefined;
    if (!row) return c.json({ error: "not found" }, 404);

    // changes === 0 with an existing row means the baseVersion was stale.
    if (info.changes === 0) {
      return c.json(
        { error: "version conflict", version: row.version, state: JSON.parse(row.state) },
        409,
      );
    }
    return c.json({ version: row.version, state: JSON.parse(row.state), updatedAt: row.updated_at });
  });

  // Atomic additive progress delta. Clamps the stored total at >= 0; the upper
  // bound is the engine's job (it caps owned at demand) so the client display
  // stays correct without the server needing to know `needed`.
  app.post("/lists/:token/progress", async (c) => {
    const token = c.req.param("token");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const itemId = body.itemId;
    const delta = body.delta;
    const handle = cleanHandle(body.handle);
    if (!isShortString(itemId, MAX_ID_LEN) || !isFiniteNumber(delta)) {
      return c.json({ error: "itemId and numeric delta required" }, 400);
    }
    const row = findList.get(token) as ListRow | undefined;
    if (!row) return c.json({ error: "not found" }, 404);
    const ts = now();
    const d = Math.trunc(delta);

    // Read-add-clamp-write in one transaction. better-sqlite3 is synchronous and
    // the process is the sole writer, so no other write interleaves the read and
    // the write — this is the atomic additive delta. Clamped at >= 0; the engine
    // caps the upper bound at demand.
    const applyDelta = db.transaction((listId: number, item: string) => {
      const cur = db
        .prepare(`SELECT qty FROM progress WHERE list_id = ? AND item_id = ?`)
        .get(listId, item) as { qty: number } | undefined;
      const next = Math.min(MAX_QTY, Math.max(0, (cur?.qty ?? 0) + d));
      db.prepare(
        `INSERT INTO progress (list_id, item_id, qty, by_handle, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(list_id, item_id) DO UPDATE SET
           qty = excluded.qty, by_handle = excluded.by_handle, updated_at = excluded.updated_at`,
      ).run(listId, item, next, handle, ts);
    });
    applyDelta(row.id, itemId);

    const updated = db
      .prepare(`SELECT qty, by_handle, updated_at FROM progress WHERE list_id = ? AND item_id = ?`)
      .get(row.id, itemId) as { qty: number; by_handle: string | null; updated_at: string };

    return c.json({ itemId, qty: updated.qty, byHandle: updated.by_handle, updatedAt: updated.updated_at });
  });

  return app;
}
