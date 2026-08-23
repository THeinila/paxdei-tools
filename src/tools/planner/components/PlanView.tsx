import { useMemo, useState } from "react";
import { getDataset, getItem, itemName, sourceUrl } from "../lib/data.ts";
import type { Plan } from "../engine/planner.ts";
import { planToMarkdown } from "../engine/markdown.ts";
import {
  PRESETS,
  PRESET_LABELS,
  buildPlanView,
  formatStacks,
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
  /** List name and link, for the Markdown export header/footer. */
  listName: string;
  shareUrl: string;
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
 * leaves, which profession does it, and how many inventory stacks it comes to. */
function CraftMeta({ row }: { row: PlanRow }) {
  if (row.satisfied) return <span className="meta">have enough</span>;
  return (
    <span className="meta">
      {row.crafts} craft{row.crafts !== 1 ? "s" : ""}
      {row.produced !== row.qty ? ` → makes ${row.produced}` : ""}
      {row.profession ? ` · ${row.profession}` : ""}
      {row.stacks ? ` · ${formatStacks(row.stacks)}` : ""}
    </span>
  );
}

/** How many inventory stacks an amount comes to — only shown when it's more
 * than one, so short rows stay uncluttered. */
function Stacks({ row }: { row: PlanRow }) {
  if (!row.stacks) return null;
  return <span className="meta">{formatStacks(row.stacks)}</span>;
}

/** Nothing unfinished in the plan blocks this craft — do it now. */
function ReadyBadge({ row }: { row: PlanRow }) {
  if (!row.ready) return null;
  return (
    <span className="badge-ready" title="No unfinished sub-crafts — nothing in the plan blocks this">
      ready
    </span>
  );
}

/** A collapsible section heading. The caret and aria-expanded both reflect the
 * stored collapse state; clicking anywhere on the heading toggles it. */
function SectionHead({
  section,
  label,
  onToggle,
  as: Tag,
  className,
}: {
  section: PlanSection;
  label: string;
  onToggle: () => void;
  as: "h2" | "h3";
  className?: string;
}) {
  return (
    <Tag className={className}>
      <button className="head-toggle" aria-expanded={!section.collapsed} onClick={onToggle}>
        <span className="head-caret">{section.collapsed ? "▸" : "▾"}</span>
        {label}
      </button>
    </Tag>
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
  listName,
  shareUrl,
  setOwned,
  setPathChoice,
}: Props) {
  const [copied, setCopied] = useState(false);
  // The 3s poll re-renders this component with a stable `result`, so memoizing
  // keeps the whole section/row tree from being rebuilt on every tick.
  const vm = useMemo(() => buildPlanView(result, getDataset().items, prefs), [result, prefs]);

  async function copyMarkdown() {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(planToMarkdown(vm, { listName, url: shareUrl }));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked */
    }
  }

  const empty = result.crafts.length === 0 && result.gather.length === 0;
  if (empty) {
    return <p className="hint">Add items above to see what to gather and craft.</p>;
  }

  const gatherSections = vm.sections.filter((s) => s.kind === "gather");
  const craftSections = vm.sections.filter((s) => s.kind === "craft");
  const flatSection = craftSections.find((s) => s.key === "craft:all");

  const gatherRow = (row: PlanRow) => {
    const item = getItem(row.itemId);
    return (
      <Row key={row.itemId} itemId={row.itemId} qty={row.qty} satisfied={row.satisfied}>
        <Stacks row={row} />
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
    const variants = getDataset().recipes[row.itemId]?.variants ?? [];
    return (
      <Row key={row.itemId} itemId={row.itemId} qty={row.qty} satisfied={row.satisfied}>
        <CraftMeta row={row} />
        <ReadyBadge row={row} />
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

  const toggle = (section: PlanSection) => () =>
    onPrefsChange({
      collapsed: section.collapsed
        ? prefs.collapsed.filter((k) => k !== section.key)
        : [...prefs.collapsed, section.key],
    });

  const rowsOf = (section: PlanSection, render: (row: PlanRow) => JSX.Element) =>
    section.collapsed ? null : (
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
        {vm.totals.hiddenCount > 0 && <span className="muted-note">{vm.totals.hiddenCount} hidden</span>}
        <button className="link-btn toolbar-spacer" onClick={copyMarkdown}>
          {copied ? "Copied!" : "Copy as Markdown"}
        </button>
      </div>

      <section className="panel">
        {gatherSections.map((s) => (
          <SectionHead
            key={s.key}
            as="h2"
            section={s}
            label={`Gather (${vm.totals.gatherLeft})`}
            onToggle={toggle(s)}
          />
        ))}
        {gatherSections.length === 0 && (
          <>
            <h2>Gather (0)</h2>
            <p className="hint">Nothing to gather.</p>
          </>
        )}
        {gatherSections.map((s) => rowsOf(s, gatherRow))}
      </section>

      <section className="panel">
        {/* Under the flat preset the one section has no heading of its own — it
            would only repeat the panel title — so the panel heading collapses it. */}
        {flatSection ? (
          <SectionHead
            as="h2"
            section={flatSection}
            label={`Craft (${vm.totals.craftsLeft})`}
            onToggle={toggle(flatSection)}
          />
        ) : (
          <h2>Craft ({vm.totals.craftsLeft})</h2>
        )}
        <p className="hint">{CRAFT_HINTS[vm.preset]}</p>
        {craftSections.length === 0 && <p className="hint">Nothing left to craft.</p>}
        {craftSections.map((s) =>
          s === flatSection ? (
            rowsOf(s, craftRow)
          ) : (
            <div key={s.key} className="prof-group">
              <SectionHead
                as="h3"
                className="prof-head"
                section={s}
                label={s.heading}
                onToggle={toggle(s)}
              />
              {rowsOf(s, craftRow)}
            </div>
          ),
        )}
      </section>
    </div>
  );
}
