/** Typed fetch wrappers for /api/market/* with a small in-memory cache.
 *
 * The underlying data refreshes hourly upstream and the server caches it in
 * SQLite for 60 minutes, so the client never needs to poll: responses are
 * memoized here for 5 minutes (matching the server's Cache-Control) purely to
 * dedupe fetches across component mounts and route changes. */
import type {
  MarketStatus,
  WorldPrices,
  ZonePrices,
  ZoneTree,
} from "../../shared/marketTypes.ts";

export type { MarketStatus, PriceRollup, WorldPrices, ZonePrices, ZoneTree } from "../../shared/marketTypes.ts";

/** A world/domain/zone triple identifying one market. */
export interface ZoneSelection {
  world: string;
  domain: string;
  zone: string;
}

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; promise: Promise<unknown> }>();

function cached<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise as Promise<T>;
  const promise = (async () => {
    const res = await fetch(url);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `market request failed: ${res.status}`);
    }
    return (await res.json()) as T;
  })();
  // Drop failed fetches from the cache so the next call retries.
  promise.catch(() => cache.delete(url));
  cache.set(url, { at: Date.now(), promise });
  return promise;
}

export function getMarketStatus(): Promise<MarketStatus> {
  return cached<MarketStatus>("/api/market/status");
}

export function getZoneTree(): Promise<ZoneTree> {
  return cached<ZoneTree>("/api/market/zones");
}

export function getZonePrices(sel: ZoneSelection): Promise<ZonePrices> {
  const p = [sel.world, sel.domain, sel.zone].map(encodeURIComponent).join("/");
  return cached<ZonePrices>(`/api/market/prices/${p}`);
}

export function getWorldPrices(world: string): Promise<WorldPrices> {
  return cached<WorldPrices>(`/api/market/world/${encodeURIComponent(world)}`);
}

// ---- Persisted zone selection --------------------------------------------------

const ZONE_KEY = "market:zone:v1";

export function loadZoneSelection(): ZoneSelection | null {
  try {
    const raw = localStorage.getItem(ZONE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as ZoneSelection;
    if (typeof v.world === "string" && typeof v.domain === "string" && typeof v.zone === "string") {
      return v;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function saveZoneSelection(sel: ZoneSelection | null): void {
  try {
    if (sel) localStorage.setItem(ZONE_KEY, JSON.stringify(sel));
    else localStorage.removeItem(ZONE_KEY);
  } catch {
    /* storage may be unavailable */
  }
}
