/** Trade Routes: cross-zone arbitrage table for one world (server). Buy where
 * it's cheap, haul it, undercut where it's dear. Numbers are estimates from
 * listed sell prices — the market API exposes no demand data. */
import { useMemo, useState } from "react";
import { computeRoutes, type Route } from "./engine/arbitrage.ts";
import { dataset, itemName } from "../planner/lib/data.ts";
import { ItemLabel } from "../planner/components/RecipeTooltip.tsx";
import { useMarketStatus, useWorldPrices, useZoneTree } from "../../market/hooks.ts";
import { loadZoneSelection } from "../../market/client.ts";
import { formatGold } from "../../market/format.ts";

type SortKey = "name" | "buy" | "sell" | "spread" | "spreadPct" | "perStack" | "qty";

const SORTS: Record<SortKey, (a: Route, b: Route) => number> = {
  name: (a, b) => itemName(a.itemId).localeCompare(itemName(b.itemId)),
  buy: (a, b) => a.buy.min - b.buy.min,
  sell: (a, b) => a.sell.min - b.sell.min,
  spread: (a, b) => b.spread - a.spread,
  spreadPct: (a, b) => b.spreadPct - a.spreadPct,
  perStack: (a, b) => b.perStack - a.perStack,
  qty: (a, b) => b.buy.qtyAtMin - a.buy.qtyAtMin,
};

export default function TradeRoutes() {
  const market = useMarketStatus();
  const { data: tree } = useZoneTree(market.enabled);
  const [world, setWorld] = useState<string | null>(() => loadZoneSelection()?.world ?? null);
  const prices = useWorldPrices(market.enabled ? world : null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [minSpreadPct, setMinSpreadPct] = useState(10);
  const [minQty, setMinQty] = useState(1);
  const [sort, setSort] = useState<SortKey>("perStack");
  const [expanded, setExpanded] = useState<string | null>(null);

  const routes = useMemo(() => {
    if (!prices.data) return [];
    const stacks: Record<string, number | null> = {};
    for (const [id, item] of Object.entries(dataset.items)) stacks[id] = item.maxStackSize;
    return computeRoutes(prices.data, stacks);
  }, [prices.data]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const r of routes) {
      const c = dataset.items[r.itemId]?.mainCategoryId;
      if (c) cats.add(c);
    }
    return [...cats].sort();
  }, [routes]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = routes.filter((r) => {
      if (q && !itemName(r.itemId).toLowerCase().includes(q)) return false;
      if (category && dataset.items[r.itemId]?.mainCategoryId !== category) return false;
      if (r.spreadPct * 100 < minSpreadPct) return false;
      if (r.buy.qtyAtMin < minQty) return false;
      return true;
    });
    return [...list].sort(SORTS[sort]);
  }, [routes, query, category, minSpreadPct, minQty, sort]);

  if (!market.enabled) {
    return (
      <>
        <h1>Trade Routes</h1>
        <p className="hint">
          Market data isn't enabled on this server, so there's nothing to compare yet.
        </p>
      </>
    );
  }

  const worlds = Object.keys(tree?.worlds ?? {}).sort();
  const staleCount = prices.data?.zones.filter((z) => z.stale).length ?? 0;

  const Th = ({ k, children, num }: { k: SortKey; children: React.ReactNode; num?: boolean }) => (
    <th className={`${sort === k ? "sorted" : ""} ${num ? "num" : ""}`} onClick={() => setSort(k)}>
      {children}
    </th>
  );

  return (
    <>
      <h1>Trade Routes</h1>
      <p className="hint">
        Price gaps between zones on one server: buy cheap, haul, undercut the dear zone's cheapest
        listing. Estimates from listed prices — nothing guarantees a sale.
      </p>

      <div className="market-bar">
        <span className="zone-picker">
          <span className="zone-picker-label">Server:</span>
          <select value={world ?? ""} onChange={(e) => setWorld(e.target.value || null)}>
            <option value="">choose…</option>
            {worlds.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </span>
        {prices.loading && <span className="market-fresh">fetching zone markets…</span>}
        {staleCount > 0 && <span className="market-fresh stale">⚠ {staleCount} zones outdated</span>}
        {prices.data && prices.data.missing.length > 0 && (
          <span className="market-fresh">({prices.data.missing.length} zones unavailable)</span>
        )}
        {prices.error && <span className="market-error">{prices.error}</span>}
      </div>

      {world && prices.data && (
        <>
          <div className="market-filters">
            <input
              type="text"
              placeholder="filter items…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">all categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label>
              min spread %
              <input
                type="number"
                min={0}
                value={minSpreadPct}
                onChange={(e) => setMinSpreadPct(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label>
              min qty
              <input
                type="number"
                min={0}
                value={minQty}
                onChange={(e) => setMinQty(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <span className="summary-hint">
              {shown.length} of {routes.length} routes
            </span>
          </div>

          <table className="market-table">
            <thead>
              <tr>
                <Th k="name">Item</Th>
                <Th k="buy" num>Buy at</Th>
                <Th k="sell" num>Sell at</Th>
                <Th k="spread" num>Spread</Th>
                <Th k="spreadPct" num>%</Th>
                <Th k="qty" num>Buyable</Th>
                <Th k="perStack" num>Per trip</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <RouteRow
                  key={r.itemId}
                  route={r}
                  expanded={expanded === r.itemId}
                  onToggle={() => setExpanded(expanded === r.itemId ? null : r.itemId)}
                />
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="hint">No routes match the filters.</p>}
        </>
      )}

      <p className="tool-note">Market data from the public gaming.tools market API · updated hourly</p>
    </>
  );
}

function RouteRow({
  route: r,
  expanded,
  onToggle,
}: {
  route: Route;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td>
          <span className="item-cell">
            <ItemLabel itemId={r.itemId} />
          </span>
        </td>
        <td className="num" title={`${r.buy.domain}/${r.buy.zone}`}>
          {formatGold(r.buy.min)} · {r.buy.zone}
        </td>
        <td className="num" title={`${r.sell.domain}/${r.sell.zone}`}>
          {formatGold(r.sell.min)} · {r.sell.zone}
        </td>
        <td className="num">{formatGold(r.spread)}</td>
        <td className="num">
          {Number.isFinite(r.spreadPct) ? `${Math.round(r.spreadPct * 100)}%` : "∞"}
        </td>
        <td className="num">{r.buy.qtyAtMin}</td>
        <td className="num">
          <b>{formatGold(r.perStack)}</b>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7}>
            <span className="meta">
              {r.zones
                .map((z) => `${z.zone} (${z.domain}) ${formatGold(z.min)} ×${z.qtyAtMin}`)
                .join(" · ")}
            </span>
          </td>
        </tr>
      )}
    </>
  );
}
