import { dataset, getItem, itemName, sourceUrl } from "../lib/data.ts";
import type { Plan } from "../engine/planner.ts";
import { Icon } from "./Search.tsx";

interface Props {
  result: Plan;
  owned: Record<string, number>;
  pathChoices: Record<string, string>;
  setOwned: (itemId: string, qty: number) => void;
  setPathChoice: (itemId: string, recipeId: string) => void;
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

export function PlanView({ result, owned, pathChoices, setOwned, setPathChoice }: Props) {
  const { crafts, gather, warnings } = result;
  if (crafts.length === 0 && gather.length === 0) {
    return <p className="hint">Add items above to see what to gather and craft.</p>;
  }

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

  return (
    <div className="plan">
      {warnings.map((w) => (
        <div key={w} className="warning">
          ⚠ {w}
        </div>
      ))}

      <div className="summary">
        <span>
          <b>{gather.length}</b> to gather
        </span>
        <span>
          <b>{totalCrafts}</b> craft{totalCrafts !== 1 ? "s" : ""} in <b>{tiers.length}</b>{" "}
          tier{tiers.length !== 1 ? "s" : ""}
        </span>
        <span className="summary-hint">amounts already exclude what you have</span>
      </div>

      <section className="panel">
        <h2>Gather ({gather.length})</h2>
        {gather.length === 0 && <p className="hint">Nothing to gather.</p>}
        <ul className="rows">
          {gather.map((g) => {
            const item = getItem(g.itemId);
            return (
              <li key={g.itemId} className="row">
                <Icon item={item} />
                <span className="row-name">{itemName(g.itemId)}</span>
                <span className="qty">×{g.needed}</span>
                <OwnedInput itemId={g.itemId} owned={owned} setOwned={setOwned} />
                {sourceUrl(item) && (
                  <a className="map-link" href={sourceUrl(item)!} target="_blank" rel="noreferrer">
                    where?
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel">
        <h2>Craft ({crafts.length})</h2>
        <p className="hint">By tier — craft top to bottom; final products are last.</p>
        {tiers.map((group) => (
          <div key={group.tier} className="prof-group">
            <h3 className="prof-head">
              {group.tier === 0 ? "Final products" : `Components · tier ${group.tier}`}
            </h3>
            <ul className="rows">
              {group.steps.map((c) => {
                const item = getItem(c.itemId);
                const variants = dataset.recipes[c.itemId]?.variants ?? [];
                return (
                  <li key={c.itemId} className="row">
                    <Icon item={item} />
                    <span className="row-name">{itemName(c.itemId)}</span>
                    <span className="qty">×{c.needed}</span>
                    <span className="meta">
                      {c.crafts} craft{c.crafts !== 1 ? "s" : ""}
                      {c.produced !== c.needed ? ` → makes ${c.produced}` : ""}
                      {c.profession ? ` · ${c.profession}` : ""}
                    </span>
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
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
