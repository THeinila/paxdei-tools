/** SQLite setup for the sharing backend. One synchronous better-sqlite3
 * connection per process; WAL mode lets pollers read without blocking the
 * single writer, which is what makes the concurrency model (atomic additive
 * progress deltas + version-guarded list edits) safe. */
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type DB = Database.Database;

/** Open a connection, apply pragmas, and run idempotent migrations.
 * Pass ":memory:" (the default for tests) or an absolute file path. When no
 * argument is given, honor DB_PATH so a deployment can keep the database on a
 * persistent volume outside the code checkout; otherwise fall back to a file
 * next to the server. */
export function openDb(file?: string): DB {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = file ?? process.env.DB_PATH ?? join(here, "data.sqlite");
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

    -- Market data cache (server/market.ts). The upstream refreshes hourly, so
    -- snapshots live in SQLite (not memory) to survive restarts without
    -- refetching. market_zones mirrors the upstream index; freshness is
    -- tracked in market_zone_fetches (a zone can legitimately roll up to zero
    -- price rows); market_prices holds per-item rollups for the latest
    -- snapshot only (no history).
    CREATE TABLE IF NOT EXISTS market_zones (
      world   TEXT NOT NULL,
      domain  TEXT NOT NULL,
      zone    TEXT NOT NULL,
      url     TEXT NOT NULL,
      PRIMARY KEY (world, domain, zone)
    );

    CREATE TABLE IF NOT EXISTS market_zone_fetches (
      world       TEXT NOT NULL,
      domain      TEXT NOT NULL,
      zone        TEXT NOT NULL,
      fetched_at  TEXT NOT NULL,
      PRIMARY KEY (world, domain, zone)
    );

    CREATE TABLE IF NOT EXISTS market_prices (
      world          TEXT NOT NULL,
      domain         TEXT NOT NULL,
      zone           TEXT NOT NULL,
      item_id        TEXT NOT NULL,
      min_price      REAL NOT NULL,
      median_price   REAL NOT NULL,
      qty_at_min     INTEGER NOT NULL,
      total_qty      INTEGER NOT NULL,
      listing_count  INTEGER NOT NULL,
      PRIMARY KEY (world, domain, zone, item_id)
    );

    -- Market history (server/market.ts snapshot processing). The upstream has
    -- no history or demand endpoints, so both are accumulated here: hourly
    -- price points (pruned after 72 h) feed sparklines and anomaly detection;
    -- daily aggregates (pruned after 60 d) feed 7-day medians, volatility,
    -- and estimated sales. Sales are INFERRED: a listing (stable upstream id)
    -- that disappears before its lifetime ran out counts as sold — see
    -- EXPIRY_EPSILON in server/marketUpstream.ts.
    CREATE TABLE IF NOT EXISTS market_listings (
      id             TEXT PRIMARY KEY,
      world          TEXT NOT NULL,
      domain         TEXT NOT NULL,
      zone           TEXT NOT NULL,
      item_id        TEXT NOT NULL,
      quantity       INTEGER NOT NULL,
      unit_price     REAL NOT NULL,
      mastercraft    INTEGER NOT NULL DEFAULT 0,
      first_seen     TEXT NOT NULL,
      last_seen      TEXT NOT NULL,
      lifetime_last  REAL
    );
    CREATE INDEX IF NOT EXISTS market_listings_zone
      ON market_listings (world, domain, zone);

    CREATE TABLE IF NOT EXISTS market_history_hourly (
      world          TEXT NOT NULL,
      domain         TEXT NOT NULL,
      zone           TEXT NOT NULL,
      item_id        TEXT NOT NULL,
      snapshot_at    TEXT NOT NULL,
      min_price      REAL NOT NULL,
      median_price   REAL NOT NULL,
      total_qty      INTEGER NOT NULL,
      listing_count  INTEGER NOT NULL,
      PRIMARY KEY (world, domain, zone, item_id, snapshot_at)
    );
    CREATE INDEX IF NOT EXISTS market_history_hourly_at
      ON market_history_hourly (snapshot_at);

    CREATE TABLE IF NOT EXISTS market_history_daily (
      world        TEXT NOT NULL,
      domain       TEXT NOT NULL,
      zone         TEXT NOT NULL,
      item_id      TEXT NOT NULL,
      day          TEXT NOT NULL,
      min_min      REAL NOT NULL,
      median_min   REAL NOT NULL,
      snapshots    INTEGER NOT NULL,
      sold_qty     INTEGER NOT NULL DEFAULT 0,
      sold_value   REAL NOT NULL DEFAULT 0,
      expired_qty  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (world, domain, zone, item_id, day)
    );
    CREATE INDEX IF NOT EXISTS market_history_daily_day
      ON market_history_daily (day);
  `);
}
