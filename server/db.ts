/** SQLite setup for the sharing backend. One synchronous better-sqlite3
 * connection per process; WAL mode lets pollers read without blocking the
 * single writer, which is what makes the concurrency model (atomic additive
 * progress deltas + version-guarded list edits) safe. */
import Database from "better-sqlite3";
import { resolve } from "node:path";

export type DB = Database.Database;

/** Where the database lives when neither an explicit path nor DB_PATH is given.
 *
 * Anchored to the working directory, NOT to this module's own location. The
 * server runs from source under tsx in dev (`server/index.ts`) and from a bundle
 * in production (`dist-server/index.js`), so a path relative to the module would
 * silently point at two different files — `npm start` would quietly open an
 * empty database instead of the one `npm run server` had been using. npm scripts
 * and the systemd unit (WorkingDirectory=) both run from the repo root, so cwd
 * is the stable anchor. Production sets DB_PATH explicitly regardless. */
function defaultDbPath(): string {
  return resolve(process.cwd(), "server", "data.sqlite");
}

/** The path openDb() would use. Exported so callers that need to reason about
 * the database's location (e.g. the disk-space guard) resolve it identically. */
export function dbPathFor(file?: string): string {
  return file ?? process.env.DB_PATH ?? defaultDbPath();
}

/** Open a connection, apply pragmas, and run idempotent migrations.
 * Pass ":memory:" (the default for tests) or an absolute file path. When no
 * argument is given, honor DB_PATH so a deployment can keep the database on a
 * persistent volume outside the code checkout; otherwise fall back to
 * defaultDbPath(). */
export function openDb(file?: string): DB {
  const path = dbPathFor(file);
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** True when `table` already has a column called `column`. SQLite has no
 * "ADD COLUMN IF NOT EXISTS", and migrate() runs on every boot. */
function hasColumn(db: DB, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

/** Idempotent schema migration. Exported so tests can run it against a
 * legacy-shaped database and assert the backfill. */
export function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lists (
      id           INTEGER PRIMARY KEY,
      share_token  TEXT NOT NULL UNIQUE,
      version      INTEGER NOT NULL DEFAULT 0,
      state        TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS progress (
      list_id     INTEGER NOT NULL,
      item_id     TEXT NOT NULL,
      qty         INTEGER NOT NULL,
      by_handle   TEXT,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (list_id, item_id),
      FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
    );

    -- Server-generated secrets and other one-off settings (e.g. the visitor
    -- pepper used by server/metrics.ts).
    CREATE TABLE IF NOT EXISTS meta (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );

    -- Daily event counters (e.g. list_created). Aggregates only — a row says
    -- "N of this event happened on this day", never who did it.
    CREATE TABLE IF NOT EXISTS metrics (
      day     TEXT NOT NULL,
      metric  TEXT NOT NULL,
      count   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, metric)
    );

    -- Unique-visitor tracking. hash is HMAC-SHA256(pepper, client IP) — the
    -- raw IP is never stored and there is no cookie or client-side ID.
    CREATE TABLE IF NOT EXISTS visitors (
      hash        TEXT PRIMARY KEY,
      first_seen  TEXT NOT NULL,
      last_seen   TEXT NOT NULL
    );

    -- /api/stats groups visitors by these; without indexes both are full scans
    -- that block the single writer once the table is large.
    CREATE INDEX IF NOT EXISTS idx_visitors_first_seen ON visitors(first_seen);
    CREATE INDEX IF NOT EXISTS idx_visitors_last_seen  ON visitors(last_seen);
  `);

  // Retention. `updated_at` tracks the DEFINITION (it moves with `version`), so
  // it is the wrong clock for "is anyone still using this list" — a group that
  // has settled on its targets and is only ticking items off would look
  // untouched and get swept while actively in use. `last_activity_at` is bumped
  // by every write, definition or progress alike.
  if (!hasColumn(db, "lists", "last_activity_at")) {
    db.exec(`ALTER TABLE lists ADD COLUMN last_activity_at TEXT`);
    // Backfill from the best evidence we have for existing rows: the latest of
    // the definition's own timestamp and any progress written against it.
    db.exec(`
      UPDATE lists SET last_activity_at = MAX(
        updated_at,
        COALESCE((SELECT MAX(updated_at) FROM progress WHERE progress.list_id = lists.id), updated_at)
      )
    `);
  }
  // Safety net for rows inserted before the column existed, or by a client that
  // somehow skipped it — a NULL here would be invisible to the sweep's
  // comparison and the row would live forever.
  db.exec(`UPDATE lists SET last_activity_at = updated_at WHERE last_activity_at IS NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lists_last_activity ON lists(last_activity_at)`);
}
