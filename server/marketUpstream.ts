/** The ONLY module that knows the shape of the upstream market data (the
 * gaming.tools public market API — unofficial but dev-approved, hourly
 * updates, no auth). If the upstream schema ever changes, this file is the
 * whole blast radius: everything else consumes the rolled-up PriceRollup.
 *
 * Modes (env MARKET_UPSTREAM, default "off"):
 *   off      — no upstream at all; /api/market data endpoints return 503.
 *   fixtures — read server/fixtures/market/*.json (same schema as live).
 *   live     — fetch data-cdn.gaming.tools. Only enable after the API
 *              developer has been informed (their stated condition of use).
 *
 * Schema verified against one real zone file on 2026-07-07 (saved in the dev
 * scratchpad): a zone file is a flat array of listing objects. */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { MarketMode, PriceRollup } from "../shared/marketTypes.ts";

const INDEX_URL = "https://data-cdn.gaming.tools/paxdei/market/index.json";
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "market");

/** One market-stall listing as upstream serves it. Fields we don't use
 * (id, avatar_hash, stall_hash, creation_date, lifetime, durability,
 * last_seen, world/domain/zone) are omitted from the type but present in the
 * payload. */
export interface UpstreamListing {
  item_id: string;
  quantity: number;
  price: number;
  /** 1 on mastercrafted (higher-quality) listings; absent otherwise. */
  mastercraft?: number;
}

export interface ZoneRef {
  world: string;
  domain: string;
  zone: string;
  url: string;
}

export interface Upstream {
  fetchIndex(): Promise<ZoneRef[]>;
  fetchZoneListings(ref: ZoneRef): Promise<UpstreamListing[]>;
}

export function marketMode(): MarketMode {
  const v = process.env.MARKET_UPSTREAM;
  if (v === "fixtures" || v === "live") return v;
  return "off";
}

/** Zone-file URLs follow .../paxdei/market/{world}/{domain}/{zone}.json. */
const URL_RE = /\/paxdei\/market\/([^/]+)\/([^/]+)\/([^/]+)\.json$/;

export function parseZoneUrl(url: string): ZoneRef | null {
  const m = URL_RE.exec(url);
  if (!m) return null;
  return { world: m[1]!, domain: m[2]!, zone: m[3]!, url };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
  return res.json();
}

function parseIndex(raw: unknown): ZoneRef[] {
  if (!Array.isArray(raw)) throw new Error("upstream index is not an array");
  const refs: ZoneRef[] = [];
  for (const u of raw) {
    if (typeof u !== "string") continue;
    const ref = parseZoneUrl(u);
    if (ref) refs.push(ref);
  }
  return refs;
}

function parseListings(raw: unknown): UpstreamListing[] {
  if (!Array.isArray(raw)) throw new Error("upstream zone payload is not an array");
  return raw as UpstreamListing[];
}

export function createUpstream(mode: "fixtures" | "live"): Upstream {
  if (mode === "live") {
    return {
      fetchIndex: async () => parseIndex(await fetchJson(INDEX_URL)),
      fetchZoneListings: async (ref) => parseListings(await fetchJson(ref.url)),
    };
  }
  // Fixtures mirror the live contract: the index carries URLs in the real
  // pattern (on a .invalid host) and zone payloads use the real field names.
  const readFixture = async (name: string) =>
    JSON.parse(await readFile(join(FIXTURES_DIR, name), "utf8")) as unknown;
  return {
    fetchIndex: async () => parseIndex(await readFixture("index.json")),
    fetchZoneListings: async (ref) =>
      parseListings(await readFixture(`${ref.world}--${ref.domain}--${ref.zone}.json`)),
  };
}

/** Listings priced within this factor of the zone minimum count as "available
 * at ~min" (the realistically buyable volume for arbitrage/craft-or-buy). */
const NEAR_MIN = 1.1;

/** Collapse a zone's listings into per-item price rollups.
 *
 * ASSUMPTION (to confirm with the API developer): `price` is the TOTAL price
 * for the whole listing, so unit price = price / quantity. Evidence from the
 * verified real zone file: "100 Sand @ price 2" and "200 Iron Studs @ price 5"
 * only make economic sense as totals. If this turns out wrong, fix `unit`
 * below and nothing else.
 *
 * Mastercrafted listings are excluded: they're a different quality tier and
 * would pollute the min price of the ordinary item. */
export function rollup(listings: UpstreamListing[]): Record<string, PriceRollup> {
  const byItem = new Map<string, { unit: number; qty: number }[]>();
  for (const l of listings) {
    if (l.mastercraft) continue;
    if (typeof l.item_id !== "string" || l.item_id.length === 0) continue;
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) continue;
    if (!Number.isFinite(l.price) || l.price < 0) continue;
    const unit = l.price / l.quantity;
    const arr = byItem.get(l.item_id) ?? [];
    arr.push({ unit, qty: l.quantity });
    byItem.set(l.item_id, arr);
  }

  const out: Record<string, PriceRollup> = {};
  for (const [itemId, rows] of byItem) {
    const units = rows.map((r) => r.unit).sort((a, b) => a - b);
    const min = units[0]!;
    const mid = Math.floor(units.length / 2);
    const median = units.length % 2 ? units[mid]! : (units[mid - 1]! + units[mid]!) / 2;
    const qtyAtMin = rows.filter((r) => r.unit <= min * NEAR_MIN).reduce((n, r) => n + r.qty, 0);
    const totalQty = rows.reduce((n, r) => n + r.qty, 0);
    out[itemId] = { min, median, qtyAtMin, totalQty, listings: rows.length };
  }
  return out;
}
