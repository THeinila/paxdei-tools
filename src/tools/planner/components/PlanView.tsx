import { useMemo } from "react";
import { dataset, getItem, itemName, sourceUrl } from "../lib/data.ts";
import type { Plan } from "../engine/planner.ts";
import {
  PRESETS,
  PRESET_LABELS,
  buildPlanView,
  type PlanRow,
  type PlanSection,
  type ViewPrefs,
} from "../engine/view.ts";
import type { ProgressMap } from "../lib/useList.ts";
import { Row } from "./Row.tsx";

interface Props {
  result: Plan;
  owned: Record<string, number>;
  pathChoices: Record<string, string>;
  /** Collaborative "have" entries keyed by item id (shared lists only); empty in
   * local mode. Used purely to attribute who last touched a row. */
  progress: ProgressMap;
  prefs: ViewPrefs;
  onPrefsChange: (patch: Partial<ViewPrefs>) => void;
  setOwned: (itemId: string, qty: number) => void;
  setPathChoice: (itemId: string, recipeId: string) => void;
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

/** The craft-row summary: how many bench runs, the surplus a yield>1 recipe
 * leaves, and which profession does it. */
function CraftMeta({ row }: { row: PlanRow }) {
  if (row.satisfied) return <span className="meta">have enough</span>;
  return (
    <span className="meta">
      {row.crafts} craft{row.crafts !== 1 ? "s" : ""}
      {row.produced !== row.qty ? ` → makes ${row.produced}` : ""}
      {row.profession ? ` · ${row.profession}` : ""}
    </span>
  );
}

const CRAFT_HINTS: Record<ViewPrefs["preset"], string> = {
  tiered: "By tier — craft top to bottom; final products are last.",
  flat: "In dependency order — craft top to bottom.",
  profession: "Grouped by profession, so work can be split by station.",
};

export function PlanView({
  result,
  owned,
  pathChoices,
  progress,
  prefs,
  onPrefsChange,
  setOwned,
  setPathChoice,
}: Props) {
  // The 3s poll re-renders this component with a stable `result`, so memoizing
  // keeps the whole section/row tree from being rebuilt on every tick.
  const vm = useMemo(() => buildPlanView(result, dataset.items, prefs), [result, prefs]);

  const empty = result.crafts.length === 0 && result.gather.length === 0;
  if (empty) {
    return <p className="hint">Add items above to see what to gather and craft.</p>;
  }

  const gatherSections = vm.sections.filter((s) => s.kind === "gather");
  const craftSections = vm.sections.filter((s) => s.kind === "craft");

  const gatherRow = (row: PlanRow) => {
    const item = getItem(row.itemId);
    return (
      <Row key={row.itemId} itemId={row.itemId} qty={row.qty} satisfied={row.satisfied}>
        <OwnedInput itemId={row.itemId} owned={owned} setOwned={setOwned} />
        <By progress={progress} itemId={row.itemId} />
        {sourceUrl(item) && (
          <a className="map-link" href={sourceUrl(item)!} target="_blank" rel="noreferrer">
            where?
          </a>
        )}
      </Row>
    );
  };

  const craftRow = (row: PlanRow) => {
    const variants = dataset.recipes[row.itemId]?.variants ?? [];
    return (
      <Row key={row.itemId} itemId={row.itemId} qty={row.qty} satisfied={row.satisfied}>
        <CraftMeta row={row} />
        {variants.length > 1 && (
          <select
            className="path-select"
            value={pathChoices[row.itemId] ?? row.recipeId ?? ""}
            onChange={(e) => setPathChoice(row.itemId, e.target.value)}
          >
            {variants.map((v) => (
              <option key={v.recipeId} value={v.recipeId}>
                {v.ingredients.map((i) => `${itemName(i.itemId)}×${i.count}`).join(" + ")}
              </option>
            ))}
          </select>
        )}
        <OwnedInput itemId={row.itemId} owned={owned} setOwned={setOwned} />
        <By progress={progress} itemId={row.itemId} />
      </Row>
    );
  };

  const rowsOf = (section: PlanSection, render: (row: PlanRow) => JSX.Element) => (
    <ul key={section.key} className="rows">
      {section.rows.map(render)}
    </ul>
  );

  return (
    <div className="plan">
      {vm.warnings.map((w) => (
        <div key={w} className="warning">
          ⚠ {w}
        </div>
      ))}

      <div className="summary">
        <span>
          <b>{vm.totals.gatherLeft}</b> to gather
        </span>
        <span>
          <b>{vm.totals.totalCrafts}</b> craft{vm.totals.totalCrafts !== 1 ? "s" : ""} in{" "}
          <b>{vm.totals.tierCount}</b> tier{vm.totals.tierCount !== 1 ? "s" : ""}
        </span>
        <span className="summary-hint">amounts already exclude what you have</span>
      </div>

      <div className="view-toolbar">
        <div className="seg" role="group" aria-label="Plan layout">
          {PRESETS.map((id) => (
            <button
              key={id}
              className="seg-btn"
              aria-pressed={prefs.preset === id}
              onClick={() => onPrefsChange({ preset: id })}
            >
              {PRESET_LABELS[id]}
            </button>
          ))}
        </div>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={prefs.hideCompleted}
            onChange={(e) => onPrefsChange({ hideCompleted: e.target.checked })}
          />
          Hide completed
        </label>
        {vm.totals.hiddenCount > 0 && (
          <span className="summary-hint">{vm.totals.hiddenCount} hidden</span>
        )}
      </div>

      <section className="panel">
        <h2>Gather ({vm.totals.gatherLeft})</h2>
        {gatherSections.length === 0 && <p className="hint">Nothing to gather.</p>}
        {gatherSections.map((s) => rowsOf(s, gatherRow))}
      </section>

      <section className="panel">
        <h2>Craft ({vm.totals.craftsLeft})</h2>
        <p className="hint">{CRAFT_HINTS[vm.preset]}</p>
        {craftSections.length === 0 && <p className="hint">Nothing left to craft.</p>}
        {craftSections.map((s) =>
          // A single unnamed "Craft" section under the flat preset would just
          // repeat the panel heading, so it renders bare.
          s.key === "craft:all" ? (
            rowsOf(s, craftRow)
          ) : (
            <div key={s.key} className="prof-group">
              <h3 className="prof-head">{s.heading}</h3>
              {rowsOf(s, craftRow)}
            </div>
          ),
        )}
      </section>
    </div>
  );
}
