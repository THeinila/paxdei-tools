/** React hooks over the market client. All follow the same contract:
 * `data` is null while loading or on error, `error` carries the message.
 * Passing null as the input disables the fetch (for optional features). */
import { useEffect, useMemo, useState } from "react";
import {
  getMarketStatus,
  getWorldPrices,
  getZonePrices,
  getZoneTree,
  loadZoneSelection,
  saveZoneSelection,
  type MarketStatus,
  type WorldPrices,
  type ZonePrices,
  type ZoneSelection,
  type ZoneTree,
} from "./client.ts";

interface Remote<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

function useRemote<T>(key: string | null, fetcher: () => Promise<T>): Remote<T> {
  const [state, setState] = useState<Remote<T>>({ data: null, error: null, loading: key !== null });
  useEffect(() => {
    if (key === null) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState({ data: null, error: null, loading: true });
    fetcher().then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (e) =>
        !cancelled &&
        setState({ data: null, error: e instanceof Error ? e.message : "request failed", loading: false }),
    );
    return () => {
      cancelled = true;
    };
    // The key encodes every input; the fetcher identity is irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** Market availability. `enabled: false` (or a fetch error, e.g. the offline
 * build with no backend) means: render no market UI at all. */
export function useMarketStatus(): { enabled: boolean; mode: MarketStatus["mode"] | null } {
  const { data } = useRemote("status", getMarketStatus);
  return { enabled: data?.enabled ?? false, mode: data?.mode ?? null };
}

export function useZoneTree(enabled: boolean): Remote<ZoneTree> {
  return useRemote(enabled ? "zones" : null, getZoneTree);
}

export function useZonePrices(sel: ZoneSelection | null): Remote<ZonePrices> {
  const key = sel ? `prices:${sel.world}/${sel.domain}/${sel.zone}` : null;
  return useRemote(key, () => getZonePrices(sel!));
}

export function useWorldPrices(world: string | null): Remote<WorldPrices> {
  return useRemote(world ? `world:${world}` : null, () => getWorldPrices(world!));
}

/** The user's home market zone, shared across tools and persisted locally
 * (never part of shared list state — collaborators shop in different places). */
export function useZoneSelection(): [ZoneSelection | null, (sel: ZoneSelection | null) => void] {
  const [sel, setSel] = useState<ZoneSelection | null>(() => loadZoneSelection());
  const set = useMemo(
    () => (next: ZoneSelection | null) => {
      saveZoneSelection(next);
      setSel(next);
    },
    [],
  );
  return [sel, set];
}
