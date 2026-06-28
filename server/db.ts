/** SQLite setup for the sharing backend. One synchronous better-sqlite3
 * connection per process; WAL mode lets pollers read without blocking the
 * single writer, which is what makes the concurrency model (atomic additive
 * progress deltas + version-guarded list edits) safe. */
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type DB = Database.Database;

/** Open a connection, apply pragmas, and run idempotent migrations.
 * Pass ":memory:" (the default for tests) or an absolute file path. */
export function openDb(file?: string): DB {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = file ?? join(here, "data.sqlite");
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
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
  `);
}
