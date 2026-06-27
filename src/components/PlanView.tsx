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

  // Group crafts by profession in first-appearance order; within a group the
  // dependency order from the engine is preserved. Lets a group split the work
  // by station ("you take Tailoring, I'll do Carpentry").
  const groups: { profession: string; steps: typeof crafts }[] = [];
  const groupIdx = new Map<string, number>();
  for (const c of crafts) {
    const key = c.profession ?? "Other";
    if (!groupIdx.has(key)) {
      groupIdx.set(key, groups.length);
      groups.push({ profession: key, steps: [] });
    }
    groups[groupIdx.get(key)!]!.steps.push(c);
  }
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
          <b>{totalCrafts}</b> craft{totalCrafts !== 1 ? "s" : ""} across <b>{groups.length}</b>{" "}
          profession{groups.length !== 1 ? "s" : ""}
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
        <p className="hint">Grouped by profession · within each, dependencies come first.</p>
        {groups.map((group) => (
          <div key={group.profession} className="prof-group">
            <h3 className="prof-head">{group.profession}</h3>
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
