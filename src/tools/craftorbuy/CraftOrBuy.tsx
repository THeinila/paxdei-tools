/** Craft or Buy: for any item, is it cheaper to buy it off a market stall or
 * craft it from parts (each part acquired the cheapest way)? Explorer shows
 * the per-item decision tree; Profit ranks what's worth crafting to sell.
 * All numbers come from the shared cost engine + the selected zone's prices. */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataset, itemName, searchItems } from "../planner/lib/data.ts";
import { createLocal, saveContent, updateEntry } from "../planner/lib/directory.ts";
import { ItemLabel } from "../planner/components/RecipeTooltip.tsx";
import { pickVariant } from "../planner/engine/planner.ts";
import { unitCosts, type UnitCost } from "../planner/engine/cost.ts";
import { MarketBar } from "../../market/MarketBar.tsx";
import { useMarketStatus, useZonePrices, useZoneSelection } from "../../market/hooks.ts";
import { formatGold } from "../../market/format.ts";
import type { ItemStats } from "../../market/client.ts";

export default function CraftOrBuy() {
  const market = useMarketStatus();
  const [zone, setZone] = useZoneSelection();
  const zonePrices = useZonePrices(market.enabled ? zone : null);
  const [tab, setTab] = useState<"explore" | "profit">("explore");

  const costs = useMemo(
    () => (zonePrices.data ? unitCosts(dataset, zonePrices.data.prices) : null),
    [zonePrices.data],
  );

  if (!market.enabled) {
    return (
      <>
        <h1>Craft or Buy</h1>
        <p className="hint">Market data isn't enabled on this server, so prices can't be compared yet.</p>
      </>
    );
  }

  return (
    <>
      <h1>Craft or Buy</h1>
      <p className="hint">
        Cheapest way to get an item at current prices: buy it whole, or craft it from parts (each
        part again the cheapest way). Gathered materials count as free unless listed.
      </p>

      <MarketBar value={zone} onChange={setZone} prices={zonePrices} />

      {!zone && <p className="hint">Pick your server and zone above to load prices.</p>}
      {zone && costs && (
        <>
          <div className="market-filters">
            <button
              className={tab === "explore" ? "tab-btn active" : "tab-btn"}
              onClick={() => setTab("explore")}
            >
              Explorer
            </button>
            <button
              className={tab === "profit" ? "tab-btn active" : "tab-btn"}
              onClick={() => setTab("profit")}
            >
              Profit
            </button>
          </div>
          {tab === "explore" ? (
            <Explorer costs={costs} />
          ) : (
            <Profit costs={costs} prices={zonePrices.data!.prices} stats={zonePrices.data!.stats} />
          )}
        </>
      )}

      <p className="tool-note">Market data from the public gaming.tools market API · updated hourly</p>
    </>
  );
}

// ---- Explorer -------------------------------------------------------------------

/** Items in the item's cheapest acquisition plan that should be bought: walk
 * the craft path, stop at buy decisions. Cycle-guarded. */
function collectBuys(costs: Map<string, UnitCost>, rootId: string): string[] {
  const buys = new Set<string>();
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const cost = costs.get(id);
    if (cost?.strategy === "buy") {
      buys.add(id);
      return;
    }
    if (cost?.strategy !== "craft") return;
    const variant = pickVariant(dataset, id, {});
    for (const ing of variant?.ingredients ?? []) walk(ing.itemId);
  };
  walk(rootId);
  return [...buys];
}

function Explorer({ costs }: { costs: Map<string, UnitCost> }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const navigate = useNavigate();
  const results = useMemo(() => searchItems(query, 12), [query]);

  function sendToPlanner() {
    if (!picked) return;
    const name = `${itemName(picked)} ×${qty}`;
    const entry = createLocal(name);
    saveContent(entry.id, {
      name,
      targets: [{ itemId: picked, quantity: qty }],
      owned: {},
      pathChoices: {},
      buys: collectBuys(costs, picked),
    });
    updateEntry(entry.id, { targetCount: 1 });
    navigate(`/planner/${entry.id}`);
  }

  return (
    <>
      <div className="market-filters">
        <input
          type="text"
          placeholder="search an item…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {picked && (
          <>
            <label>
              qty
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              />
            </label>
            <button className="link-btn buy-recommend-all" onClick={sendToPlanner}>
              send to planner (buys pre-set)
            </button>
          </>
        )}
      </div>
      {query && !picked && (
        <ul className="rows">
          {results.map((item) => (
            <li key={item.id} className="row" style={{ cursor: "pointer" }} onClick={() => { setPicked(item.id); setQuery(""); }}>
              <ItemLabel itemId={item.id} />
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <section className="panel">
          <ul className="cost-tree">
            <CostNode costs={costs} itemId={picked} count={qty} ancestors={new Set()} />
          </ul>
        </section>
      )}
    </>
  );
}

function CostNode({
  costs,
  itemId,
  count,
  ancestors,
}: {
  costs: Map<string, UnitCost>;
  itemId: string;
  /** Units of this item the parent needs (fractional below yield boundaries). */
  count: number;
  ancestors: Set<string>;
}) {
  const cost = costs.get(itemId);
  const variant = pickVariant(dataset, itemId, {});
  const strategy = cost?.strategy ?? "gather";
  const showChildren = strategy === "craft" && variant && !ancestors.has(itemId);
  const amount = Math.round(count * 100) / 100;

  return (
    <li>
      <div className="cost-node">
        <ItemLabel itemId={itemId} />
        <span className="qty">×{amount}</span>
        <span className={`strategy ${strategy}`}>{strategy}</span>
        {cost && cost.best > 0 && (
          <span className="price-chip">
            {formatGold(cost.best)} ea · {formatGold(cost.best * count)}
          </span>
        )}
        {cost && strategy === "buy" && cost.craft !== null && (
          <span className="meta">crafting would be ≈{formatGold(cost.craft)} ea</span>
        )}
        {cost && strategy === "craft" && cost.buy !== null && (
          <span className="meta">buying would be {formatGold(cost.buy)} ea</span>
        )}
        {cost && !cost.pricedFully && (
          <span className="meta" title="some materials have no listing and count as free gathering">
            ≈ partial
          </span>
        )}
      </div>
      {showChildren && (
        <ul>
          {variant.ingredients.map((ing) => (
            <CostNode
              key={ing.itemId}
              costs={costs}
              itemId={ing.itemId}
              count={(ing.count / variant.yield) * count}
              ancestors={new Set([...ancestors, itemId])}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---- Profit ---------------------------------------------------------------------

interface ProfitRow {
  itemId: string;
  profession: string | null;
  craft: number;
  sell: number;
  /** Margin against the SUSTAINABLE sell price: min(current, 7-day median). */
  margin: number;
  marginPct: number;
  /** Margin against the current listing only (tooltip). */
  marginNow: number;
  soldPerDay: number | null;
  sellAnomaly: boolean;
  noHistory: boolean;
  demandQty: number;
  pricedFully: boolean;
}

type ProfitSort = "name" | "craft" | "sell" | "soldDay" | "margin" | "marginPct";

const PROFIT_SORTS: Record<ProfitSort, (a: ProfitRow, b: ProfitRow) => number> = {
  name: (a, b) => itemName(a.itemId).localeCompare(itemName(b.itemId)),
  craft: (a, b) => a.craft - b.craft,
  sell: (a, b) => b.sell - a.sell,
  soldDay: (a, b) => (b.soldPerDay ?? -1) - (a.soldPerDay ?? -1),
  margin: (a, b) => b.margin - a.margin,
  marginPct: (a, b) => b.marginPct - a.marginPct,
};

/** Current sell price this far above its 7-day median → margin likely a mirage. */
const SELL_ANOMALY_RATIO = 1.5;

function Profit({
  costs,
  prices,
  stats,
}: {
  costs: Map<string, UnitCost>;
  prices: Record<string, { min: number; qtyAtMin: number }>;
  stats?: Record<string, ItemStats>;
}) {
  const [query, setQuery] = useState("");
  const [profession, setProfession] = useState("");
  const [onlyProfitable, setOnlyProfitable] = useState(true);
  const [onlyFullyPriced, setOnlyFullyPriced] = useState(false);
  const [minSoldPerDay, setMinSoldPerDay] = useState(0);
  const [sort, setSort] = useState<ProfitSort>("margin");

  const rows = useMemo(() => {
    const out: ProfitRow[] = [];
    for (const id of Object.keys(dataset.recipes)) {
      const cost = costs.get(id);
      const listing = prices[id];
      if (!cost || cost.craft === null || !listing) continue;
      const s = stats?.[id];
      // Sell at the sustainable price: a listing far above the weekly norm
      // will be undercut back down before your crafts sell through.
      const sellEff = Math.min(listing.min, s?.medianMin7d ?? listing.min);
      const margin = sellEff - cost.craft;
      out.push({
        itemId: id,
        profession: pickVariant(dataset, id, {})?.profession ?? null,
        craft: cost.craft,
        sell: listing.min,
        margin,
        marginPct: cost.craft > 0 ? margin / cost.craft : Number.POSITIVE_INFINITY,
        marginNow: listing.min - cost.craft,
        soldPerDay: s ? s.soldPerDay : null,
        sellAnomaly: s?.medianMin7d != null && listing.min > SELL_ANOMALY_RATIO * s.medianMin7d,
        noHistory: !s,
        demandQty: listing.qtyAtMin,
        pricedFully: cost.pricedFully,
      });
    }
    return out;
  }, [costs, prices, stats]);

  const professions = useMemo(
    () => [...new Set(rows.map((r) => r.profession).filter((p): p is string => !!p))].sort(),
    [rows],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (q && !itemName(r.itemId).toLowerCase().includes(q)) return false;
        if (profession && r.profession !== profession) return false;
        if (onlyProfitable && r.margin <= 0) return false;
        if (onlyFullyPriced && !r.pricedFully) return false;
        if (minSoldPerDay > 0 && (r.soldPerDay ?? 0) < minSoldPerDay) return false;
        return true;
      })
      .sort(PROFIT_SORTS[sort]);
  }, [rows, query, profession, onlyProfitable, onlyFullyPriced, minSoldPerDay, sort]);

  const Th = ({ k, children, num }: { k: ProfitSort; children: React.ReactNode; num?: boolean }) => (
    <th className={`${sort === k ? "sorted" : ""} ${num ? "num" : ""}`} onClick={() => setSort(k)}>
      {children}
    </th>
  );

  return (
    <>
      <div className="market-filters">
        <input type="text" placeholder="filter items…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={profession} onChange={(e) => setProfession(e.target.value)}>
          <option value="">all professions</option>
          {professions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={onlyProfitable} onChange={(e) => setOnlyProfitable(e.target.checked)} />
          profitable only
        </label>
        <label>
          <input
            type="checkbox"
            checked={onlyFullyPriced}
            onChange={(e) => setOnlyFullyPriced(e.target.checked)}
            title="hide items whose craft cost includes unpriced (gathered-free) materials"
          />
          fully priced only
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
        <span className="summary-hint">{shown.length} items</span>
      </div>

      <table className="market-table">
        <thead>
          <tr>
            <Th k="name">Item</Th>
            <th>Profession</th>
            <Th k="craft" num>Craft cost</Th>
            <Th k="sell" num>Sells at</Th>
            <Th k="soldDay" num>Sold/day</Th>
            <Th k="margin" num>Margin</Th>
            <Th k="marginPct" num>%</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.itemId}>
              <td>
                <span className="item-cell">
                  <ItemLabel itemId={r.itemId} />
                  {r.sellAnomaly && (
                    <span className="stat-badge anomaly" title="the current listing is far above the item's 7-day norm — the margin uses the sustainable price instead">
                      ⚠ price spike
                    </span>
                  )}
                  {r.soldPerDay === 0 && (
                    <span className="stat-badge stale-sales" title="no estimated sales observed for this item here — a great margin nobody pays">
                      ∅ not selling
                    </span>
                  )}
                  {r.noHistory && (
                    <span className="stat-badge nohistory" title="no price history collected yet for this item here">
                      no history yet
                    </span>
                  )}
                </span>
              </td>
              <td className="meta">{r.profession ?? "—"}</td>
              <td className="num">
                {r.pricedFully ? "" : "≈"}
                {formatGold(r.craft)}
              </td>
              <td className="num" title={`${r.demandQty} listed near this price`}>
                {formatGold(r.sell)}
              </td>
              <td className="num" title="estimated units sold per day in this zone (from delisted stock)">
                {r.soldPerDay === null ? "—" : Math.round(r.soldPerDay * 10) / 10}
              </td>
              <td
                className="num"
                title={
                  r.marginNow !== r.margin
                    ? `at the current listing it would be ${formatGold(r.marginNow)}, but that price is above the weekly norm`
                    : undefined
                }
              >
                <b>{formatGold(r.margin)}</b>
              </td>
              <td className="num">{Number.isFinite(r.marginPct) ? `${Math.round(r.marginPct * 100)}%` : "∞"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="hint">Nothing matches the filters.</p>}
    </>
  );
}
