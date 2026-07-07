import { useMemo } from "react";
import { dataset, getItem, itemName, sourceUrl } from "../lib/data.ts";
import type { Plan } from "../engine/planner.ts";
import { unitCosts, type UnitCost } from "../engine/cost.ts";
import type { ProgressMap } from "../lib/useList.ts";
import type { ZonePrices } from "../../../market/client.ts";
import { formatGold } from "../../../market/format.ts";
import { Row } from "./Row.tsx";

interface Props {
  result: Plan;
  owned: Record<string, number>;
  pathChoices: Record<string, string>;
  /** Collaborative "have" entries keyed by item id (shared lists only); empty in
   * local mode. Used purely to attribute who last touched a row. */
  progress: ProgressMap;
  /** Market prices for the user's selected zone; null hides all market UI. */
  prices: ZonePrices | null;
  setOwned: (itemId: string, qty: number) => void;
  setPathChoice: (itemId: string, recipeId: string) => void;
  toggleBuy: (itemId: string) => void;
  addBuys: (itemIds: string[]) => void;
}

/** "· Alice" attribution shown on a row whose have-amount someone has set. */
function By({ progress, itemId }: { progress: ProgressMap; itemId: string }) {
  const entry = progress[itemId];
  if (!entry || !entry.byHandle || entry.qty <= 0) return null;
  return (
    <span className="by-handle" title={`updated ${new Date(entry.updatedAt).toLocaleString()}`}>
      · {entry.byHandle}
    </span>
  );
}

function OwnedInput({
  itemId,
  owned,
  setOwned,
}: {
  itemId: string;
  owned: Record<string, number>;
  setOwned: (itemId: string, qty: number) => void;
}) {
  return (
    <label className="owned">
      have
      <input
        type="number"
        min={0}
        value={owned[itemId] ?? ""}
        placeholder="0"
        onChange={(e) => setOwned(itemId, Math.max(0, Number(e.target.value) || 0))}
      />
    </label>
  );
}

/** The market's cheapest unit price for an item, e.g. "3g ea". */
function PriceChip({ prices, itemId }: { prices: ZonePrices | null; itemId: string }) {
  const p = prices?.prices[itemId];
  if (!p) return null;
  return (
    <span className="price-chip" title={`cheapest listing · ${p.qtyAtMin} available at ~this price`}>
      {formatGold(p.min)} ea
    </span>
  );
}

export function PlanView({
  result,
  owned,
  pathChoices,
  progress,
  prices,
  setOwned,
  setPathChoice,
  toggleBuy,
  addBuys,
}: Props) {
  const { crafts, gather, buys, warnings } = result;

  // Buy-vs-craft costs for the selected zone. PriceRollup is a superset of the
  // cost engine's PriceMap, so the zone payload feeds it directly.
  const costs = useMemo(
    () => (prices ? unitCosts(dataset, prices.prices, pathChoices) : null),
    [prices, pathChoices],
  );

  if (crafts.length === 0 && gather.length === 0 && buys.length === 0) {
    return <p className="hint">Add items above to see what to gather and craft.</p>;
  }

  // Craft steps where buying outright beats crafting from parts, at current
  // zone prices (the "apply recommendations" set).
  const recommended = costs
    ? crafts.filter((c) => !c.satisfied && costs.get(c.itemId)?.strategy === "buy")
    : [];

  // Gold needed for the Buy list, when every bought item has a listing.
  const buyLines = buys.map((b) => {
    const min = prices?.prices[b.itemId]?.min ?? null;
    return { ...b, unit: min, cost: min !== null ? min * b.needed : null };
  });
  const buyTotal = buyLines.reduce((n, l) => n + (l.satisfied ? 0 : (l.cost ?? 0)), 0);
  const buyUnpriced = buyLines.some((l) => !l.satisfied && l.cost === null);

  // Group crafts into tiers by dependency depth: final products at the bottom,
  // their ingredients above, sub-materials above those, etc. An item used at
  // several depths sits in its deepest (topmost) tier only. Within a tier,
  // steps are sorted by profession so work can be split by station.
  const byTier = new Map<number, typeof crafts>();
  for (const c of crafts) {
    const arr = byTier.get(c.tier) ?? [];
    arr.push(c);
    byTier.set(c.tier, arr);
  }
  const tiers = [...byTier.entries()]
    .sort((a, b) => b[0] - a[0]) // deepest tier first (topmost on the page)
    .map(([tier, steps]) => ({
      tier,
      steps: [...steps].sort(
        (a, b) =>
          (a.profession ?? "").localeCompare(b.profession ?? "") ||
          itemName(a.itemId).localeCompare(itemName(b.itemId)),
      ),
    }));
  const totalCrafts = crafts.reduce((n, c) => n + c.crafts, 0);
  const gatherLeft = gather.filter((g) => !g.satisfied).length;
  const craftsLeft = crafts.filter((c) => !c.satisfied).length;
  const buysLeft = buyLines.filter((b) => !b.satisfied).length;

  /** "buy" / "craft instead" — moves an item between the plan and the Buy list. */
  const BuyToggle = ({ itemId, bought }: { itemId: string; bought: boolean }) => (
    <button
      className="link-btn buy-toggle"
      title={bought ? "put it back into the plan" : "buy it instead of making it"}
      onClick={() => toggleBuy(itemId)}
    >
      {bought ? "craft instead" : "buy"}
    </button>
  );

  return (
    <div className="plan">
      {warnings.map((w) => (
        <div key={w} className="warning">
          ⚠ {w}
        </div>
      ))}

      <div className="summary">
        <span>
          <b>{gatherLeft}</b> to gather
        </span>
        <span>
          <b>{totalCrafts}</b> craft{totalCrafts !== 1 ? "s" : ""} in <b>{tiers.length}</b>{" "}
          tier{tiers.length !== 1 ? "s" : ""}
        </span>
        {buysLeft > 0 && (
          <span>
            <b>{buysLeft}</b> to buy{buyTotal > 0 ? <> · ~<b>{formatGold(buyTotal)}</b>{buyUnpriced ? " + unpriced items" : ""}</> : null}
          </span>
        )}
        {recommended.length > 0 && (
          <button
            className="link-btn buy-recommend-all"
            title="mark every craft that's cheaper to buy at current prices"
            onClick={() => addBuys(recommended.map((c) => c.itemId))}
          >
            apply {recommended.length} buy recommendation{recommended.length !== 1 ? "s" : ""}
          </button>
        )}
        <span className="summary-hint">amounts already exclude what you have</span>
      </div>

      {buys.length > 0 && (
        <section className="panel">
          <h2>Buy ({buysLeft})</h2>
          <ul className="rows">
            {buyLines.map((b) => (
              <Row key={b.itemId} itemId={b.itemId} qty={b.needed} satisfied={b.satisfied}>
                <span className="meta">
                  {b.satisfied
                    ? "have enough"
                    : b.cost !== null
                      ? `${formatGold(b.unit!)} ea · ~${formatGold(b.cost)}`
                      : prices
                        ? "no listing in this zone"
                        : ""}
                </span>
                <OwnedInput itemId={b.itemId} owned={owned} setOwned={setOwned} />
                <By progress={progress} itemId={b.itemId} />
                <BuyToggle itemId={b.itemId} bought />
              </Row>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>Gather ({gatherLeft})</h2>
        {gather.length === 0 && <p className="hint">Nothing to gather.</p>}
        <ul className="rows">
          {gather.map((g) => {
            const item = getItem(g.itemId);
            return (
              <Row key={g.itemId} itemId={g.itemId} qty={g.needed} satisfied={g.satisfied}>
                <PriceChip prices={prices} itemId={g.itemId} />
                <OwnedInput itemId={g.itemId} owned={owned} setOwned={setOwned} />
                <By progress={progress} itemId={g.itemId} />
                {prices?.prices[g.itemId] && <BuyToggle itemId={g.itemId} bought={false} />}
                {sourceUrl(item) && (
                  <a className="map-link" href={sourceUrl(item)!} target="_blank" rel="noreferrer">
                    where?
                  </a>
                )}
              </Row>
            );
          })}
        </ul>
      </section>

      <section className="panel">
        <h2>Craft ({craftsLeft})</h2>
        <p className="hint">By tier — craft top to bottom; final products are last.</p>
        {tiers.map((group) => (
          <div key={group.tier} className="prof-group">
            <h3 className="prof-head">
              {group.tier === 0 ? "Final products" : `Components · Tier ${group.tier}`}
            </h3>
            <ul className="rows">
              {group.steps.map((c) => {
                const variants = dataset.recipes[c.itemId]?.variants ?? [];
                const cost: UnitCost | undefined = costs?.get(c.itemId);
                const recommendBuy = !c.satisfied && cost?.strategy === "buy";
                return (
                  <Row key={c.itemId} itemId={c.itemId} qty={c.needed} satisfied={c.satisfied}>
                    <span className="meta">
                      {c.satisfied ? (
                        "have enough"
                      ) : (
                        <>
                          {c.crafts} craft{c.crafts !== 1 ? "s" : ""}
                          {c.produced !== c.needed ? ` → makes ${c.produced}` : ""}
                          {c.profession ? ` · ${c.profession}` : ""}
                        </>
                      )}
                    </span>
                    {!recommendBuy && <PriceChip prices={prices} itemId={c.itemId} />}
                    {recommendBuy && cost && (
                      <span
                        className="buy-hint"
                        title={`buying costs ${formatGold(cost.buy!)}/ea; crafting the parts ${
                          cost.craft !== null ? `≈ ${formatGold(cost.craft)}/ea` : "can't be priced"
                        }${cost.craft !== null && !cost.craftPricedFully ? " (some parts unpriced, counted free)" : ""}`}
                      >
                        cheaper to buy: {formatGold(cost.buy!)}
                        {cost.craft !== null ? ` vs ${formatGold(cost.craft)}` : ""}
                      </span>
                    )}
                    {variants.length > 1 && (
                      <select
                        className="path-select"
                        value={pathChoices[c.itemId] ?? c.recipeId}
                        onChange={(e) => setPathChoice(c.itemId, e.target.value)}
                      >
                        {variants.map((v) => (
                          <option key={v.recipeId} value={v.recipeId}>
                            {v.ingredients.map((i) => `${itemName(i.itemId)}×${i.count}`).join(" + ")}
                          </option>
                        ))}
                      </select>
                    )}
                    <OwnedInput itemId={c.itemId} owned={owned} setOwned={setOwned} />
                    <By progress={progress} itemId={c.itemId} />
                    {/* Buying works without market data too — it's "someone else
                        makes this", not just a price play. */}
                    <BuyToggle itemId={c.itemId} bought={false} />
                  </Row>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
