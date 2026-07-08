/** Trade Routes: cross-zone arbitrage table for one world (server). Buy where
 * it's cheap, haul it, undercut where it's dear. Prices come from the current
 * hourly snapshot; the server's self-accumulated history adds reality checks:
 * anomaly badges when a price is far from its 7-day norm, volatility flags,
 * estimated sales per day (from delisted stock), and a profit-per-day figure
 * capped by what the destination market actually absorbs. */
import { useMemo, useState } from "react";
import { computeRoutes, type Route } from "./engine/arbitrage.ts";
import { dataset, itemName } from "../planner/lib/data.ts";
import { ItemLabel } from "../planner/components/RecipeTooltip.tsx";
import {
  useItemHistory,
  useMarketStatus,
  useWorldPrices,
  useWorldStats,
  useZoneTree,
} from "../../market/hooks.ts";
import { loadZoneSelection } from "../../market/client.ts";
import { formatGold } from "../../market/format.ts";
import { Sparkline } from "../../market/Sparkline.tsx";

type SortKey = "name" | "buy" | "sell" | "spread" | "spreadPct" | "qty" | "soldDay" | "perStack" | "profitDay";

const SORTS: Record<SortKey, (a: Route, b: Route) => number> = {
  name: (a, b) => itemName(a.itemId).localeCompare(itemName(b.itemId)),
  buy: (a, b) => a.buy.min - b.buy.min,
  sell: (a, b) => a.sell.min - b.sell.min,
  spread: (a, b) => b.spread - a.spread,
  spreadPct: (a, b) => b.spreadPct - a.spreadPct,
  qty: (a, b) => b.buy.qtyAtMin - a.buy.qtyAtMin,
  soldDay: (a, b) => (b.soldPerDay ?? -1) - (a.soldPerDay ?? -1),
  perStack: (a, b) => b.perStack - a.perStack,
  profitDay: (a, b) => (b.profitPerDay ?? -1) - (a.profitPerDay ?? -1),
};

/** Estimated-sale staleness: no sale in the last N days of history → dead market. */
const STALE_SALE_DAYS = 3;

function daysSince(isoDay: string): number {
  return Math.floor((Date.now() - Date.parse(isoDay)) / (24 * 60 * 60 * 1000));
}

function RouteBadges({ r }: { r: Route }) {
  const deadMarket =
    r.soldPerDay !== null &&
    (r.soldPerDay === 0 || (r.lastSaleAt !== null && daysSince(r.lastSaleAt) >= STALE_SALE_DAYS));
  return (
    <>
      {r.buyAnomaly && (
        <span className="stat-badge anomaly" title="the cheap source listing is far below its 7-day norm — it may be gone before you get there">
          ⚠ buy anomaly
        </span>
      )}
      {r.sellAnomaly && (
        <span className="stat-badge anomaly" title="the destination price is far above its 7-day norm — expect it to drop back; profit uses the 7-day median instead">
          ⚠ sell anomaly
        </span>
      )}
      {r.volatile && (
        <span className="stat-badge volatile" title="this item's price swings hard day-to-day at one end of the route">
          〜 volatile
        </span>
      )}
      {deadMarket && (
        <span className="stat-badge stale-sales" title={`no estimated sales recently at the destination${r.lastSaleAt ? ` (last: ${r.lastSaleAt})` : ""}`}>
          ∅ not selling
        </span>
      )}
      {r.noHistory && (
        <span className="stat-badge nohistory" title="no price history collected yet for this item on this route">
          no history yet
        </span>
      )}
    </>
  );
}

export default function TradeRoutes() {
  const market = useMarketStatus();
  const { data: tree } = useZoneTree(market.enabled);
  const [world, setWorld] = useState<string | null>(() => loadZoneSelection()?.world ?? null);
  const prices = useWorldPrices(market.enabled ? world : null);
  const stats = useWorldStats(market.enabled ? world : null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [minSpreadPct, setMinSpreadPct] = useState(10);
  const [minQty, setMinQty] = useState(1);
  const [minSoldPerDay, setMinSoldPerDay] = useState(0);
  const [hideAnomalies, setHideAnomalies] = useState(false);
  const [sort, setSort] = useState<SortKey>("profitDay");
  const [expanded, setExpanded] = useState<string | null>(null);

  const routes = useMemo(() => {
    if (!prices.data) return [];
    const stacks: Record<string, number | null> = {};
    for (const [id, item] of Object.entries(dataset.items)) stacks[id] = item.maxStackSize;
    return computeRoutes(prices.data, stacks, stats.data);
  }, [prices.data, stats.data]);

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
      if (minSoldPerDay > 0 && (r.soldPerDay ?? 0) < minSoldPerDay) return false;
      if (hideAnomalies && (r.buyAnomaly || r.sellAnomaly)) return false;
      return true;
    });
    return [...list].sort(SORTS[sort]);
  }, [routes, query, category, minSpreadPct, minQty, minSoldPerDay, hideAnomalies, sort]);

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
  const haveHistory = routes.some((r) => !r.noHistory);

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
        listing. Profit/day is sanity-checked against the last week of prices and estimated sales
        (from delisted stock) — nothing guarantees a sale.
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
        {(prices.loading || stats.loading) && <span className="market-fresh">fetching zone markets…</span>}
        {staleCount > 0 && <span className="market-fresh stale">⚠ {staleCount} zones outdated</span>}
        {prices.data && prices.data.missing.length > 0 && (
          <span className="market-fresh">({prices.data.missing.length} zones unavailable)</span>
        )}
        {world && prices.data && !haveHistory && (
          <span className="market-fresh">no price history collected yet — anomaly & sales checks appear once the server has watched the market for a while</span>
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
            <label>
              min sold/day
              <input
                type="number"
                min={0}
                value={minSoldPerDay}
                onChange={(e) => setMinSoldPerDay(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label title="hide routes whose buy or sell price is far off its 7-day norm">
              <input
                type="checkbox"
                checked={hideAnomalies}
                onChange={(e) => setHideAnomalies(e.target.checked)}
              />
              hide anomalies
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
                <Th k="soldDay" num>Sold/day</Th>
                <Th k="perStack" num>Per trip</Th>
                <Th k="profitDay" num>Profit/day</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <RouteRow
                  key={r.itemId}
                  route={r}
                  world={world}
                  expanded={expanded === r.itemId}
                  onToggle={() => setExpanded(expanded === r.itemId ? null : r.itemId)}
                />
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="hint">No routes match the filters.</p>}
        </>
      )}

      <p className="tool-note">
        Market data from the public gaming.tools market API · updated hourly · sales estimated from
        delisted stock
      </p>
    </>
  );
}

function RouteRow({
  route: r,
  world,
  expanded,
  onToggle,
}: {
  route: Route;
  world: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td>
          <span className="item-cell">
            <ItemLabel itemId={r.itemId} />
            <RouteBadges r={r} />
          </span>
        </td>
        <td className="num" title={`${r.buy.domain}/${r.buy.zone}`}>
          {formatGold(r.buy.min)} · {r.buy.zone}
        </td>
        <td
          className="num"
          title={`${r.sell.domain}/${r.sell.zone}${
            r.sellEff < r.sell.min ? ` — 7-day median ${formatGold(r.sellEff)} used for profit` : ""
          }`}
        >
          {formatGold(r.sell.min)} · {r.sell.zone}
        </td>
        <td className="num" title={r.spreadEff !== r.spread ? `sustainable: ${formatGold(r.spreadEff)}` : undefined}>
          {formatGold(r.spread)}
        </td>
        <td className="num">
          {Number.isFinite(r.spreadPct) ? `${Math.round(r.spreadPct * 100)}%` : "∞"}
        </td>
        <td className="num">{r.buy.qtyAtMin}</td>
        <td className="num" title="estimated units sold per day at the destination (from delisted stock)">
          {r.soldPerDay === null ? "—" : Math.round(r.soldPerDay * 10) / 10}
        </td>
        <td className="num">{formatGold(r.perStack)}</td>
        <td className="num" title="sustainable spread × what the destination absorbs per day">
          <b>{r.profitPerDay === null ? "—" : formatGold(r.profitPerDay)}</b>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9}>
            <RouteDetail route={r} world={world} />
          </td>
        </tr>
      )}
    </>
  );
}

function RouteDetail({ route: r, world }: { route: Route; world: string }) {
  const buyHist = useItemHistory({ world, domain: r.buy.domain, zone: r.buy.zone }, r.itemId);
  const sellHist = useItemHistory({ world, domain: r.sell.domain, zone: r.sell.zone }, r.itemId);
  return (
    <>
      <div className="route-detail">
        {buyHist.data && buyHist.data.hourly.length > 1 && (
          <span>
            <span className="spark-label">buy · {r.buy.zone} (48 h)</span>
            <Sparkline
              points={buyHist.data.hourly.map((h) => h.min)}
              title={`min price, last ${buyHist.data.hourly.length} snapshots`}
            />
          </span>
        )}
        {sellHist.data && sellHist.data.hourly.length > 1 && (
          <span>
            <span className="spark-label">sell · {r.sell.zone} (48 h)</span>
            <Sparkline
              points={sellHist.data.hourly.map((h) => h.min)}
              title={`min price, last ${sellHist.data.hourly.length} snapshots`}
            />
          </span>
        )}
        {r.lastSaleAt && <span className="meta">last est. sale at destination: {r.lastSaleAt}</span>}
      </div>
      <span className="meta">
        {r.zones
          .map((z) => `${z.zone} (${z.domain}) ${formatGold(z.min)} ×${z.qtyAtMin}`)
          .join(" · ")}
      </span>
    </>
  );
}
